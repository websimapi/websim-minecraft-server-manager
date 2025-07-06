const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { pipeline } = require('stream');
const { promisify } = require('util');
const archiver = require('archiver');
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
        }
        if (this.config.enableFloodgate) {
            await this.downloadFloodgatePlugin();
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
    
    async downloadFile(url, dest, redirectCount = 0) {
        if (redirectCount > 10) {
            throw new Error('Too many redirects');
        }

        return new Promise((resolve, reject) => {
            https.get(url, (response) => {
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    // Handle redirect
                    this.downloadFile(response.headers.location, dest, redirectCount + 1)
                        .then(resolve)
                        .catch(reject);
                    return;
                }

                if (response.statusCode !== 200) {
                    // Clean up failed download
                    response.resume(); // Consume response data to free up memory
                    fs.unlink(dest, () => reject(new Error(`Failed to download file: Status Code ${response.statusCode}`)));
                    return;
                }

                const file = fs.createWriteStream(dest);
                pipeline(response, file, (err) => {
                    file.close();
                    if (err) {
                        fs.unlink(dest, () => reject(err)); // Clean up on error
                    } else {
                        resolve(dest);
                    }
                });
            }).on('error', (err) => {
                fs.unlink(dest, () => reject(err)); // Clean up on error
            });
        });
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

            await this.downloadFile(serverDownloadUrl, serverJarPath);
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
            
            await this.downloadFile(downloadUrl, serverJarPath);
            this.broadcast({ type: 'notification', message: `Downloaded ${this.config.serverJar} successfully.`, level: 'success' });
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
            this.broadcast({ type: 'notification', message: 'Geyser already downloaded.', level: 'info' });
            return;
        }
        try {
            this.broadcast({ type: 'notification', message: 'Downloading Geyser plugin...', level: 'info' });
            await this.downloadFile(this.downloadConfig.geyser.downloadUrl, geyserJarPath);
            this.broadcast({ type: 'notification', message: 'Geyser downloaded successfully.', level: 'success' });
        } catch (error) {
            console.error('Failed to download Geyser plugin:', error);
            this.broadcast({ type: 'error', message: `Failed to download Geyser: ${error.message}` });
        }
    }

    async downloadFloodgatePlugin() {
        const pluginsDir = path.join(this.config.minecraftDir, 'plugins');
        const floodgateJarPath = path.join(pluginsDir, this.downloadConfig.floodgate.filename);
        if (fs.existsSync(floodgateJarPath)) {
            this.broadcast({ type: 'notification', message: 'Floodgate already downloaded.', level: 'info' });
            return;
        }
        try {
            this.broadcast({ type: 'notification', message: 'Downloading Floodgate plugin...', level: 'info' });
            await this.downloadFile(this.downloadConfig.floodgate.downloadUrl, floodgateJarPath);
            this.broadcast({ type: 'notification', message: 'Floodgate downloaded successfully.', level: 'success' });
        } catch (error) {
            console.error('Failed to download Floodgate plugin:', error);
            this.broadcast({ type: 'error', message: `Failed to download Floodgate: ${error.message}` });
        }
    }

    async downloadBedrockServer() {
        this.broadcast({ type: 'notification', message: 'Bedrock server download is not implemented yet.', level: 'warning' });
        throw new Error('Bedrock server download is not implemented.');
    }
}

module.exports = MinecraftAdapter;