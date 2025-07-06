const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
const archiver = require('archiver');
const fetch = require('node-fetch');
const { serverConfig, downloadConfig, backupCompressionLevel, geyserServerType, disablePaperPluginRemapper } = require('./config.js');

class MinecraftAdapter {
    constructor(broadcastCallback) {
        this.broadcast = broadcastCallback;
        this.config = serverConfig;
        this.downloadConfig = downloadConfig;
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
        
        /* @tweakable maximum number of download retry attempts */
        this.maxRetries = 3;
        /* @tweakable delay between download retry attempts in milliseconds */
        this.retryDelay = 2000;
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
                await this.prepareJavaServer();
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
                serverExecutablePath = path.join(this.config.minecraftDir, this.config.bedrockServerExecutable);
                if (!fs.existsSync(serverExecutablePath)) {
                    await this.downloadBedrockServer();
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
        return new Promise((resolve, reject) => {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFilename = `backup-${timestamp}.zip`;
            const backupPath = path.join(this.config.backupsDir, backupFilename);
            if (!fs.existsSync(this.config.backupsDir)) {
                fs.mkdirSync(this.config.backupsDir, { recursive: true });
            }
            const output = fs.createWriteStream(backupPath);
            const archive = archiver('zip', { zlib: { level: backupCompressionLevel } });
            output.on('close', () => {
                this.broadcast({ type: 'notification', message: `Backup created: ${backupFilename}`, level: 'success' });
                resolve(backupFilename);
            });
            archive.on('error', (err) => {
                this.broadcast({ type: 'error', message: `Backup failed: ${err.message}` });
                reject(err);
            });
            archive.pipe(output);
            // Exclude node_modules from backup to save space and time
            archive.glob('**', {
                cwd: this.config.minecraftDir,
                ignore: ['node_modules/**']
            });
            archive.finalize();
        });
    }

    async prepareJavaServer() {
        const serverJarPath = path.join(this.config.minecraftDir, this.config.serverJar);
        if (this.config.enableGeyser) {
            this.broadcast({ type: 'notification', message: `Geyser requires a plugin-compatible server. Preparing ${geyserServerType}...`, level: 'info' });
            if (!fs.existsSync(serverJarPath) || !this.config.serverJar.toLowerCase().includes(geyserServerType.toLowerCase())) {
                if (geyserServerType === 'paper') {
                    await this.downloadPaperServer();
                } else {
                    // Placeholder for other server types like Spigot if ever needed
                    await this.downloadVanillaServer(); // Fallback
                }
            }
            await this.preparePlugins();
        } else {
            this.broadcast({ type: 'notification', message: 'Preparing vanilla server...', level: 'info' });
            if (!fs.existsSync(serverJarPath) || this.config.serverJar.toLowerCase().includes('paper')) {
                await this.downloadVanillaServer();
            }
        }
    }

    async preparePlugins() {
        const pluginsDir = path.join(this.config.minecraftDir, 'plugins');
        if (!fs.existsSync(pluginsDir)) {
            fs.mkdirSync(pluginsDir, { recursive: true });
        }

        if (this.config.enableGeyser) {
            await this.downloadGeyserPlugin();
            if (this.config.enableFloodgate) {
                await this.downloadFloodgatePlugin();
            }
        }
    }

    updateSettings(settings) {
        this.config = { ...this.config, ...settings };
        fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(this.config, null, 2));
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
    
    async downloadFileWithRetry(url, dest, retryCount = 0) {
        try {
            await this.downloadFile(url, dest);
        } catch (error) {
            if (retryCount < this.maxRetries) {
                this.broadcast({ 
                    type: 'notification', 
                    message: `Download failed, retrying... (${retryCount + 1}/${this.maxRetries})`, 
                    level: 'warning' 
                });
                await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                return this.downloadFileWithRetry(url, dest, retryCount + 1);
            } else {
                throw error;
            }
        }
    }

    async downloadFile(url, dest) {
        this.broadcast({ type: 'notification', message: `Downloading ${path.basename(dest)}...`, level: 'info' });
        try {
            const response = await fetch(url, { 
                redirect: 'follow',
                /* @tweakable HTTP timeout for file downloads in milliseconds */
                timeout: 30000
            });
            if (!response.ok) {
                throw new Error(`Failed to download file: Status Code ${response.status} ${response.statusText}`);
            }
            const fileStream = fs.createWriteStream(dest);
            const streamPipeline = promisify(pipeline);
            await streamPipeline(response.body, fileStream);
            this.broadcast({ type: 'notification', message: `Successfully downloaded ${path.basename(dest)}.`, level: 'success' });
            return dest;
        } catch (error) {
            this.broadcast({ type: 'error', message: `Download failed for ${path.basename(dest)}: ${error.message}` });
            if (fs.existsSync(dest)) {
                fs.unlinkSync(dest); // Clean up partial file
            }
            throw error;
        }
    }

    async downloadVanillaServer() {
        try {
            this.broadcast({ type: 'notification', message: 'Downloading latest Vanilla Java server...', level: 'info' });
            const manifestResponse = await fetch(this.downloadConfig.java.versionManifestUrl);
            const manifest = await manifestResponse.json();
            const latestVersionId = manifest.latest[this.downloadConfig.java.latestVersionType];
            const versionData = manifest.versions.find(v => v.id === latestVersionId);
            if (!versionData) throw new Error(`Could not find version data for ${latestVersionId}`);
            const versionResponse = await fetch(versionData.url);
            const versionDetails = await versionResponse.json();
            const serverDownloadUrl = versionDetails.downloads.server.url;
            if (!serverDownloadUrl) throw new Error('Could not find server download URL in version details.');
            
            this.config.serverJar = `vanilla-${latestVersionId}.jar`;
            const serverJarPath = path.join(this.config.minecraftDir, this.config.serverJar);

            await this.downloadFileWithRetry(serverDownloadUrl, serverJarPath);
            this.broadcast({ type: 'notification', message: `Downloaded ${this.config.serverJar} successfully.`, level: 'success' });
            return serverJarPath;
        } catch (error) {
            console.error('Failed to download Vanilla Java server:', error);
            this.broadcast({ type: 'error', message: `Failed to download Vanilla Java server: ${error.message}` });
            throw error;
        }
    }

    async downloadPaperServer() {
        try {
            this.broadcast({ type: 'notification', message: 'Downloading latest PaperMC server...', level: 'info' });
            const projectUrl = this.downloadConfig.paper.apiUrl;
            const versionsResponse = await fetch(projectUrl);
            const versionsData = await versionsResponse.json();
            const latestVersion = versionsData.versions[versionsData.versions.length - 1];

            const buildsResponse = await fetch(`${projectUrl}/versions/${latestVersion}`);
            const buildsData = await buildsResponse.json();
            const latestBuild = buildsData.builds[buildsData.builds.length - 1];

            const jarName = `paper-${latestVersion}-${latestBuild}.jar`;
            const downloadUrl = `${projectUrl}/versions/${latestVersion}/builds/${latestBuild}/downloads/${jarName}`;
            
            this.config.serverJar = jarName; // Update serverJar to the new Paper jar name
            const serverJarPath = path.join(this.config.minecraftDir, this.config.serverJar);
            
            await this.downloadFileWithRetry(downloadUrl, serverJarPath);
            return serverJarPath;
        } catch (error) {
            console.error('Failed to download PaperMC server:', error);
            this.broadcast({ type: 'error', message: `Failed to download PaperMC server: ${error.message}` });
            throw error;
        }
    }

    async downloadGeyserPlugin() {
        const pluginsDir = path.join(this.config.minecraftDir, 'plugins');
        const geyserJarPath = path.join(pluginsDir, this.downloadConfig.geyser.filename);
        if (fs.existsSync(geyserJarPath)) {
            return;
        }
        try {
            await this.downloadFileWithRetry(this.downloadConfig.geyser.downloadUrl, geyserJarPath);
        } catch (error) {
            console.error('Failed to download Geyser plugin:', error);
            this.broadcast({ type: 'error', message: `Failed to download Geyser: ${error.message}` });
        }
    }

    async downloadFloodgatePlugin() {
        const pluginsDir = path.join(this.config.minecraftDir, 'plugins');
        const floodgateJarPath = path.join(pluginsDir, this.downloadConfig.floodgate.filename);
        if (fs.existsSync(floodgateJarPath)) {
            return;
        }
        try {
            await this.downloadFileWithRetry(this.downloadConfig.floodgate.downloadUrl, floodgateJarPath);
        } catch (error) {
            console.error('Failed to download Floodgate plugin:', error);
            this.broadcast({ type: 'error', message: `Failed to download Floodgate: ${error.message}` });
        }
    }

    async downloadBedrockServer() {
        this.broadcast({ type: 'notification', message: 'Bedrock server download is not implemented yet.', level: 'warning' });
        throw new Error('Bedrock server download is not implemented.');
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