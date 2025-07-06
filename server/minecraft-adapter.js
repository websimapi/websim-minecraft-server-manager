const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
const archiver = require('archiver');
const fetch = require('node-fetch');
const { serverConfig, downloadConfig, backupCompressionLevel, geyserServerType, disablePaperPluginRemapper } = require('./config.js');
const { prepareJavaServer } = require('./downloader.js');
const { createBackup } = require('./backup-manager.js');

class MinecraftAdapter {
    constructor(broadcastCallback) {
        this.broadcast = broadcastCallback;
        this.config = { ...serverConfig, backupCompressionLevel };
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

        let serverExecutablePath;
        let javaArgs = [];

        try {
            if (this.config.serverType === 'java') {
                await prepareJavaServer(this.config, this.broadcast);
                serverExecutablePath = path.join(this.config.minecraftDir, this.config.serverJar);
                if (!fs.existsSync(serverExecutablePath)) {
                    throw new Error(`Server JAR (${this.config.serverJar}) not found! Please check settings.`);
                }
                javaArgs = [`-Xmx${this.config.maxRam}`, `-Xms${this.config.maxRam}`];
                if (this.config.serverType === 'java' && this.config.serverJar.toLowerCase().includes('paper') && disablePaperPluginRemapper) {
                    javaArgs.push('-Dpaper.use-legacy-plugin-loading=true');
                }
                javaArgs.push('-jar', this.config.serverJar, 'nogui');
            } else if (this.config.serverType === 'bedrock') {
                await prepareJavaServer(this.config, this.broadcast);
                serverExecutablePath = path.join(this.config.minecraftDir, this.config.bedrockServerExecutable);
                if (!fs.existsSync(serverExecutablePath)) {
                    throw new Error('Bedrock server executable not found.');
                }
            } else {
                throw new Error(`Unsupported server type: ${this.config.serverType}`);
            }
        } catch (error) {
            this.broadcast({ type: 'error', message: `Could not prepare server: ${error.message}` });
            return;
        }

        console.log('Starting Minecraft server...');
        this.minecraftProcess = spawn(
            this.config.serverType === 'java' ? this.config.javaPath : serverExecutablePath,
            this.config.serverType === 'java' ? javaArgs : [],
            { cwd: this.config.minecraftDir, stdio: ['pipe', 'pipe', 'pipe'] }
        );

        this.setupProcessEventListeners();

        this.serverStatus = 'online';
        this.startTime = Date.now();
        this.broadcast({ type: 'status', online: true, stats: this.stats });
        this.broadcast({ type: 'notification', message: 'Server started successfully', level: 'success' });

        // After starting, configure Geyser if needed
        if (this.config.enableGeyser) {
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
    
    async createBackup() {
        return createBackup(this.config, this.broadcast);
    }

    updateSettings(settings) {
        // Update the adapter's config immediately
        this.config = { ...this.config, ...settings };
        
        // Persist the settings to config.json
        const configToSave = { ...serverConfig, ...settings };
        fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(configToSave, null, 2));

        if (settings.port || settings.maxPlayers) this.updateServerProperties(settings);
        this.broadcast({ type: 'notification', message: 'Settings updated successfully. A restart is required for some changes to take effect.', level: 'success' });
    }

    updateServerProperties(settings) {
        const serverPropsPath = path.join(this.config.minecraftDir, 'server.properties');
        if (fs.existsSync(serverPropsPath)) {
            let content = fs.readFileSync(serverPropsPath, 'utf8');
            if (settings.port) content = content.replace(/server-port=\d*/, `server-port=${settings.port}`);
            if (settings.maxPlayers) content = content.replace(/max-players=\d*/, `max-players=${settings.maxPlayers}`);
            fs.writeFileSync(serverPropsPath, content);
        }
    }
    
    /**
     * @description Automatically configures Geyser's config.yml to use Floodgate.
     * This is called after the server has started to ensure the config file exists.
     */
    configureGeyser() {
        if (!this.config.enableGeyser || !this.config.enableFloodgate) return;

        const geyserConfigPath = path.join(this.config.minecraftDir, 'plugins', 'Geyser-Spigot', 'config.yml');

        if (!fs.existsSync(geyserConfigPath)) {
            this.broadcast({
                type: 'notification',
                message: 'Geyser config not found. Waiting for it to be generated.',
                level: 'warning'
            });
            return;
        }

        try {
            let configContent = fs.readFileSync(geyserConfigPath, 'utf8');

            /* @tweakable The auth type to set in Geyser's config. Should be 'floodgate' for Bedrock account support. */
            const targetAuthType = 'floodgate';
            const authTypeRegex = /auth-type:\s*\w+/;

            if (configContent.match(/auth-type:\s*floodgate/)) {
                // Already configured
                return;
            }

            if (authTypeRegex.test(configContent)) {
                configContent = configContent.replace(authTypeRegex, `auth-type: ${targetAuthType}`);
            } else {
                this.broadcast({
                    type: 'error',
                    message: 'Could not find "auth-type" in Geyser config.'
                });
                return;
            }

            fs.writeFileSync(geyserConfigPath, configContent, 'utf8');
            this.broadcast({
                type: 'notification',
                message: 'Geyser config updated for Floodgate. A server restart is recommended.',
                level: 'success'
            });

        } catch (error) {
            console.error(`Failed to configure Geyser: ${error}`);
            this.broadcast({
                type: 'error',
                message: `Failed to auto-configure Geyser: ${error.message}`
            });
        }
    }
}

module.exports = MinecraftAdapter;