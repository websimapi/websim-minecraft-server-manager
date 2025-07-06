const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const Downloader = require('./downloader');
const BackupManager = require('./backup-manager');
const ConfigManager = require('./config-manager');
const ProcessHandler = require('./process-handler');
const { geyserServerType } = require('./config.js');

class MinecraftAdapter {
    constructor(broadcastCallback) {
        this.broadcast = broadcastCallback;
        this.config = require('./config.js').serverConfig; // Start with default config

        this.downloader = new Downloader(this.broadcast, this.config.downloadConfig);
        this.backupManager = new BackupManager(this.broadcast, this.config);
        this.configManager = new ConfigManager(this.broadcast, this.config);
        
        this.processHandler = null;
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
        if (this.processHandler && this.processHandler.isRunning()) {
            this.broadcast({ type: 'notification', message: 'Server is already running', level: 'warning' });
            return;
        }

        try {
            this.config = this.configManager.loadConfig(); // Reload config before start
            await this.prepareServerFiles();
        } catch (error) {
            this.broadcast({ type: 'error', message: `Could not prepare server: ${error.message}` });
            return;
        }

        console.log('Starting Minecraft server...');
        this.processHandler = new ProcessHandler(this.config, {
            onData: (data) => this.handleProcessData(data),
            onError: (data) => this.handleProcessError(data),
            onExit: (code) => this.handleProcessExit(code),
        });

        const started = this.processHandler.spawn();
        if (started) {
            this.serverStatus = 'online';
            this.startTime = Date.now();
            this.broadcast({ type: 'status', online: true, stats: this.stats });
            this.broadcast({ type: 'notification', message: 'Server started successfully', level: 'success' });
    
            // After starting, configure Geyser if needed
            if (this.config.enableGeyser && this.config.enableFloodgate) {
                setTimeout(() => this.configManager.configureGeyser(), 5000); // Wait a bit for files to generate
            }
        } else {
             this.broadcast({ type: 'error', message: `Failed to start server. Ensure Java is installed and check server settings.` });
        }
    }

    stop() {
        if (!this.processHandler || !this.processHandler.isRunning()) {
            this.broadcast({ type: 'notification', message: 'Server is not running', level: 'warning' });
            return;
        }
        this.processHandler.kill();
    }
    
    restart() {
        if (this.processHandler && this.processHandler.isRunning()) {
            this.broadcast({ type: 'notification', message: 'Restarting server...', level: 'info' });
            this.processHandler.onExitCallback = (code) => {
                this.handleProcessExit(code);
                setTimeout(() => this.start(), 2000);
            };
            this.stop();
        } else {
            this.start();
        }
    }

    sendCommand(command) {
        if (!this.processHandler || !this.processHandler.isRunning()) {
            this.broadcast({ type: 'notification', message: 'Server is not running', level: 'warning' });
            return;
        }
        this.processHandler.sendCommand(command);
    }
    
    updateSettings(settings) {
        this.config = this.configManager.updateSettings(settings);
        this.downloader.updateDownloadConfig(this.config.downloadConfig);
        this.backupManager.updateConfig(this.config);
    }

    createBackup() {
        return this.backupManager.createBackup();
    }

    // --- Process Event Handlers ---

    handleProcessData(data) {
        const output = data.toString();
        this.parseServerOutput(output);
        this.broadcast({ type: 'console', message: output.trim() });
    }
    
    handleProcessError(data) {
        const output = data.toString();
        this.broadcast({ type: 'console', message: `ERROR: ${output.trim()}` });
    }

    handleProcessExit(code) {
        console.log(`Server process exited with code ${code}`);
        this.processHandler = null;
        this.serverStatus = 'offline';
        this.startTime = null;
        this.players = [];
        this.updatePlayersList();
        this.broadcast({ type: 'status', online: false, stats: this.stats });
        this.broadcast({ type: 'notification', message: 'Server stopped', level: 'info' });
    }
    
    // --- Server State Management ---

    async prepareServerFiles() {
        if (this.config.serverType === 'bedrock') {
            await this.downloader.downloadBedrockServer();
            return;
        }

        // Java Server Preparation
        const serverJarPath = path.join(this.config.minecraftDir, this.config.serverJar);
        if (this.config.enableGeyser) {
            this.broadcast({ type: 'notification', message: `Geyser requires a plugin-compatible server. Preparing ${geyserServerType}...`, level: 'info' });
            if (!fs.existsSync(serverJarPath) || !this.config.serverJar.toLowerCase().includes(geyserServerType.toLowerCase())) {
                if (geyserServerType === 'paper') {
                    const newJar = await this.downloader.downloadPaperServer();
                    this.updateSettings({ serverJar: path.basename(newJar) });
                } else {
                    const newJar = await this.downloader.downloadVanillaServer(); // Fallback
                    this.updateSettings({ serverJar: path.basename(newJar) });
                }
            }
            await this.preparePlugins();
        } else {
            this.broadcast({ type: 'notification', message: 'Preparing vanilla server...', level: 'info' });
            if (!fs.existsSync(serverJarPath) || this.config.serverJar.toLowerCase().includes('paper')) {
                const newJar = await this.downloader.downloadVanillaServer();
                this.updateSettings({ serverJar: path.basename(newJar) });
            }
        }
    }

    async preparePlugins() {
        const pluginsDir = path.join(this.config.minecraftDir, 'plugins');
        if (!fs.existsSync(pluginsDir)) {
            fs.mkdirSync(pluginsDir, { recursive: true });
        }

        if (this.config.enableGeyser) {
            await this.downloader.downloadGeyserPlugin(pluginsDir);
            if (this.config.enableFloodgate) {
                await this.downloader.downloadFloodgatePlugin(pluginsDir);
            }
        }
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
}

module.exports = MinecraftAdapter;