const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { pipeline } = require('stream');
const archiver = require('archiver');
const { serverConfig, downloadConfig, backupCompressionLevel } = require('./config.js');

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
                serverExecutablePath = path.join(this.config.minecraftDir, this.config.serverJar);
                if (!fs.existsSync(serverExecutablePath)) {
                    await this.downloadJavaServer();
                }
                javaArgs = [`-Xmx${this.config.maxRam}`, `-Xms${this.config.maxRam}`, '-jar', this.config.serverJar, 'nogui'];
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
            archive.directory(this.config.minecraftDir, false);
            archive.finalize();
        });
    }

    updateSettings(settings) {
        this.config = { ...this.config, ...settings };
        if (settings.port || settings.maxPlayers) this.updateServerProperties(settings);
        this.broadcast({ type: 'notification', message: 'Settings updated successfully', level: 'success' });
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
    
    async downloadFile(url, dest) {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(dest);
            https.get(url, (response) => {
                if (response.statusCode >= 400) return reject(new Error(`Failed to download file: ${response.statusCode}`));
                if (response.statusCode >= 300 && response.headers.location) {
                    return this.downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                }
                pipeline(response, file, (err) => {
                    if (err) reject(err); else resolve(dest);
                });
            }).on('error', (err) => {
                fs.unlink(dest, () => reject(err));
            });
        });
    }

    async downloadJavaServer() {
        try {
            this.broadcast({ type: 'notification', message: 'Downloading latest Java server...', level: 'info' });
            const manifestResponse = await fetch(this.downloadConfig.java.versionManifestUrl);
            const manifest = await manifestResponse.json();
            const latestVersionId = manifest.latest[this.downloadConfig.java.latestVersionType];
            const versionData = manifest.versions.find(v => v.id === latestVersionId);
            if (!versionData) throw new Error(`Could not find version data for ${latestVersionId}`);
            const versionResponse = await fetch(versionData.url);
            const versionDetails = await versionResponse.json();
            const serverDownloadUrl = versionDetails.downloads.server.url;
            if (!serverDownloadUrl) throw new Error('Could not find server download URL in version details.');
            const serverJarPath = path.join(this.config.minecraftDir, this.config.serverJar);
            await this.downloadFile(serverDownloadUrl, serverJarPath);
            this.broadcast({ type: 'notification', message: `Downloaded ${this.config.serverJar} successfully.`, level: 'success' });
            return serverJarPath;
        } catch (error) {
            console.error('Failed to download Java server:', error);
            this.broadcast({ type: 'error', message: `Failed to download Java server: ${error.message}` });
            throw error;
        }
    }

    async downloadBedrockServer() {
        this.broadcast({ type: 'notification', message: 'Bedrock server download is not implemented yet.', level: 'warning' });
        throw new Error('Bedrock server download is not implemented.');
    }
}

module.exports = MinecraftAdapter;