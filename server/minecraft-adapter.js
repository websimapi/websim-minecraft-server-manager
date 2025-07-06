const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
const archiver = require('archiver');
const fetch = require('node-fetch');
const { serverConfig, downloadConfig, backupCompressionLevel, geyserServerType, disablePaperPluginRemapper } = require('./config.js');
const { prepareServer } = require('./server-preparer.js');
const { createBackup } = require('./backup-manager.js');
const { updateSettings } = require('./settings-manager.js');
const { configureGeyser } = require('./geyser-configurator.js');

class MinecraftAdapter {
    constructor(broadcastCallback) {
        this.broadcast = broadcastCallback;
        this.config = serverConfig;
        this.minecraftProcess = null;
        this.serverStatus = 'offline';
        this.players = [];
        this.stats = {
            players: 0,
            uptime: '00:00:00',
            ram: '0 MB',
            tps: '20.0'
        };
        this.startTime = null;
    }

    async start() {
        if (this.minecraftProcess) {
            this.broadcast({ type: 'notification', message: 'Server is already running', level: 'warning' });
            return;
        }

        try {
            const newJarName = await prepareServer(this.config, this.broadcast);
            if (this.config.serverType === 'java' && newJarName) {
                this.config.serverJar = newJarName;
            }

            const serverExecutablePath = this.config.serverType === 'java'
                ? path.join(this.config.minecraftDir, this.config.serverJar)
                : path.join(this.config.minecraftDir, this.config.bedrockServerExecutable);

            if (!fs.existsSync(serverExecutablePath)) {
                throw new Error(`Server executable (${path.basename(serverExecutablePath)}) not found! Please check settings.`);
            }

            let execArgs = [];
            let execCommand = '';

            if (this.config.serverType === 'java') {
                execCommand = this.config.javaPath;
                execArgs = [`-Xmx${this.config.maxRam}`, `-Xms${this.config.maxRam}`];
                if (this.config.serverJar.toLowerCase().includes('paper') && disablePaperPluginRemapper) {
                    execArgs.push('-Dpaper.use-legacy-plugin-loading=true');
                }
                execArgs.push('-jar', this.config.serverJar, 'nogui');
            } else { // bedrock
                execCommand = serverExecutablePath;
            }

            console.log(`Starting Minecraft server: ${execCommand} ${execArgs.join(' ')}`);
            this.minecraftProcess = spawn(execCommand, execArgs, {
                cwd: this.config.minecraftDir,
                stdio: ['pipe', 'pipe', 'pipe']
            });

        } catch (error) {
            this.broadcast({ type: 'error', message: `Could not start server: ${error.message}` });
            return;
        }

        this.setupProcessEventListeners();

        this.serverStatus = 'online';
        this.startTime = Date.now();
        this.broadcast({ type: 'status', online: true, stats: this.stats });
        this.broadcast({ type: 'notification', message: 'Server started successfully', level: 'success' });

        // After starting, configure Geyser if needed
        if (this.config.enableGeyser && this.config.enableFloodgate) {
            setTimeout(() => this.configureGeyser(), 5000); // Wait a bit for files to generate
        }
    }

    setupProcessEventListeners() {
        this.minecraftProcess.on('error', (err) => {
            console.error(`Failed to start server process: ${err.message}`);
            this.broadcast({ type: 'error', message: `Failed to start server: ${err.message}. Ensure Java is installed and in your PATH.` });
            this.minecraftProcess = null;
        });

        this.minecraftProcess.stdout.on('data', (data) => {
            const output = data.toString();
            this.parseServerOutput(output);
            this.broadcast({ type: 'console', message: output.trim() });
        });

        this.minecraftProcess.stderr.on('data', (data) => {
            const output = data.toString();
            this.broadcast({ type: 'console', message: `ERROR: ${output.trim()}` });
        });

        this.minecraftProcess.on('exit', (code) => {
            console.log(`Server process exited with code ${code}`);
            this.minecraftProcess = null;
            this.serverStatus = 'offline';
            this.startTime = null;
            this.players = [];
            this.updatePlayersList();
            this.broadcast({ type: 'status', online: false, stats: this.stats });
            this.broadcast({ type: 'notification', message: 'Server stopped', level: 'info' });
        });
    }

    stop() {
        if (!this.minecraftProcess) {
            this.broadcast({ type: 'notification', message: 'Server is not running', level: 'warning' });
            return;
        }
        this.sendCommand('stop');
        setTimeout(() => {
            if (this.minecraftProcess) this.minecraftProcess.kill('SIGKILL');
        }, 10000);
    }

    restart() {
        if (this.minecraftProcess) {
            this.broadcast({ type: 'notification', message: 'Restarting server...', level: 'info' });
            this.minecraftProcess.once('exit', () => {
                setTimeout(() => this.start(), 2000);
            });
            this.stop();
        } else {
            this.start();
        }
    }

    sendCommand(command) {
        if (!this.minecraftProcess) {
            this.broadcast({ type: 'notification', message: 'Server is not running', level: 'warning' });
            return;
        }
        this.minecraftProcess.stdin.write(`${command}\n`);
    }

    parseServerOutput(output) {
        const lines = output.split('\n');
        lines.forEach(line => {
            if (line.includes('joined the game')) {
                const playerName = line.match(/(\w+) joined the game/)?.[1];
                if (playerName && !this.players.find(p => p.name === playerName)) {
                    this.players.push({ name: playerName, status: 'Online' });
                    this.updatePlayersList();
                }
            } else if (line.includes('left the game')) {
                const playerName = line.match(/(\w+) left the game/)?.[1];
                if (playerName) {
                    this.players = this.players.filter(p => p.name !== playerName);
                    this.updatePlayersList();
                }
            }
            if (line.includes('Done') && line.includes('For help, type "help"')) {
                this.broadcast({ type: 'notification', message: 'Server fully loaded and ready', level: 'success' });
            }
        });
        this.stats.players = this.players.length;
        if (this.startTime) {
            const uptime = Date.now() - this.startTime;
            this.stats.uptime = this.formatUptime(uptime);
        }
    }
    
    updatePlayersList() {
        this.broadcast({ type: 'players', players: this.players });
    }

    formatUptime(milliseconds) {
        const totalSeconds = Math.floor(milliseconds / 1000);
        const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
        const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
        const seconds = (totalSeconds % 60).toString().padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
    }
    
    createBackup() {
        return createBackup(this.config, this.broadcast);
    }

    updateSettings(settings) {
        const updatedConfig = updateSettings(this.config, settings, this.broadcast);
        this.config = updatedConfig;
    }

    configureGeyser() {
        configureGeyser(this.config, this.broadcast);
    }
}

module.exports = MinecraftAdapter;