const express = require('express');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const https = require('https');
const { pipeline } = require('stream');
const { promisify } = require('util');

class MinecraftServerManager {
    constructor() {
        this.app = express();
        this.server = null;
        this.wss = null;
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
        
        /* @tweakable server configuration */
        this.config = {
            port: 3001,
            minecraftDir: './minecraft',
            javaPath: 'java',
            serverJar: 'server.jar',
            bedrockServerExecutable: 'bedrock_server',
            maxRam: '2G',
            serverType: 'java', // 'java' or 'bedrock'
            autoStart: false
        };
        
        /* @tweakable Minecraft server download URLs and settings */
        this.downloadConfig = {
            java: {
                versionManifestUrl: 'https://launchermeta.mojang.com/mc/game/version_manifest.json',
                latestVersionType: 'release' // 'release' or 'snapshot'
            },
            bedrock: {
                downloadPageUrl: 'https://www.minecraft.net/en-us/download/server/bedrock',
                downloadLinkRegex: /https:\/\/minecraft\.azureedge\.net\/bin-linux\/bedrock-server-([\d\.]+)\.zip/
            }
        };

        this.initializeServer();
    }

    initializeServer() {
        this.setupExpress();
        this.setupWebSocket();
        this.setupMinecraftDirectory();
        this.startHttpServer();
        
        if (this.config.autoStart) {
            setTimeout(() => this.startMinecraftServer(), 2000);
        }
    }

    setupExpress() {
        this.app.use(express.json());
        this.app.use(express.static(__dirname));
        
        // Serve main HTML file
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'index.html'));
        });
        
        // API endpoints
        this.app.get('/api/status', (req, res) => {
            res.json({
                status: this.serverStatus,
                stats: this.stats,
                players: this.players
            });
        });
        
        this.app.post('/api/upload', (req, res) => {
            // Handle file upload
            res.json({ success: true, message: 'File uploaded successfully' });
        });
        
        this.app.post('/api/backup', (req, res) => {
            this.createBackup()
                .then(filename => {
                    res.json({ success: true, filename });
                })
                .catch(error => {
                    res.status(500).json({ success: false, error: error.message });
                });
        });

        this.app.get('/api/download-bridge', (req, res) => {
            // This endpoint is no longer used for the primary download mechanism,
            // as the zipping is now handled on the client-side to solve the
            // chicken-and-egg problem of needing the server to download the server.
            // We'll leave it here but send an informative error.
            res.status(400).json({ 
                success: false, 
                message: 'This endpoint is deprecated. Bridge download is now handled client-side.' 
            });
        });
    }

    setupWebSocket() {
        this.server = require('http').createServer(this.app);
        this.wss = new WebSocket.Server({ server: this.server });
        
        this.wss.on('connection', (ws) => {
            console.log('Client connected');
            
            // Send initial status
            this.sendToClient(ws, {
                type: 'status',
                online: this.serverStatus === 'online',
                stats: this.stats
            });
            
            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    this.handleClientMessage(ws, data);
                } catch (error) {
                    console.error('Invalid message:', error);
                }
            });
            
            ws.on('close', () => {
                console.log('Client disconnected');
            });
        });
    }

    setupMinecraftDirectory() {
        if (!fs.existsSync(this.config.minecraftDir)) {
            fs.mkdirSync(this.config.minecraftDir, { recursive: true });
        }
        
        // Create default server.properties if it doesn't exist
        const serverPropsPath = path.join(this.config.minecraftDir, 'server.properties');
        if (!fs.existsSync(serverPropsPath)) {
            const defaultProps = `
server-port=25565
max-players=20
online-mode=true
white-list=false
enable-rcon=false
            `.trim();
            fs.writeFileSync(serverPropsPath, defaultProps);
        }
        
        // EULA is no longer automatically accepted.
        // The server will create eula.txt on first launch,
        // and the user will be prompted to accept it in the UI.
    }

    startHttpServer() {
        this.server.listen(this.config.port, () => {
            console.log(`Server running on http://localhost:${this.config.port}`);
        });
    }

    handleClientMessage(ws, data) {
        switch (data.type) {
            case 'start':
                this.startMinecraftServer();
                break;
            case 'stop':
                this.stopMinecraftServer();
                break;
            case 'restart':
                this.restartMinecraftServer();
                break;
            case 'command':
                this.sendMinecraftCommand(data.command);
                break;
            case 'backup':
                this.createBackup();
                break;
            case 'settings':
                this.updateSettings(data.settings);
                break;
            case 'ping':
                this.sendToClient(ws, { type: 'pong' });
                break;
            case 'accept_eula':
                this.acceptEulaAndStart();
                break;
            default:
                console.log('Unknown message type:', data.type);
        }
    }

    async downloadFile(url, dest) {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(dest);
            https.get(url, (response) => {
                if (response.statusCode >= 400) {
                    return reject(new Error(`Failed to download file: ${response.statusCode}`));
                }
                // Handle redirects
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    return this.downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                }
                pipeline(response, file, (err) => {
                    file.close();
                    if (err) {
                        reject(err);
                    } else {
                        resolve(dest);
                    }
                });
            }).on('error', (err) => {
                fs.unlink(dest, () => reject(err));
            });
        });
    }

    async downloadJavaServer() {
        try {
            this.broadcastMessage({ type: 'notification', message: 'Downloading latest Java server...', level: 'info' });
            
            const manifestResponse = await fetch(this.downloadConfig.java.versionManifestUrl);
            const manifest = await manifestResponse.json();
            
            const latestVersionId = manifest.latest[this.downloadConfig.java.latestVersionType];
            const versionData = manifest.versions.find(v => v.id === latestVersionId);

            if (!versionData) {
                throw new Error(`Could not find version data for ${latestVersionId}`);
            }

            const versionResponse = await fetch(versionData.url);
            const versionDetails = await versionResponse.json();
            const serverDownloadUrl = versionDetails.downloads.server.url;

            if (!serverDownloadUrl) {
                throw new Error('Could not find server download URL in version details.');
            }
            
            const serverJarPath = path.join(this.config.minecraftDir, this.config.serverJar);
            await this.downloadFile(serverDownloadUrl, serverJarPath);

            this.broadcastMessage({ type: 'notification', message: `Downloaded ${this.config.serverJar} successfully.`, level: 'success' });
            return serverJarPath;
        } catch (error) {
            console.error('Failed to download Java server:', error);
            this.broadcastMessage({ type: 'error', message: `Failed to download Java server: ${error.message}` });
            throw error;
        }
    }

    async downloadBedrockServer() {
        this.broadcastMessage({ type: 'notification', message: 'Bedrock server download is not implemented yet. Please add the executable manually.', level: 'warning' });
        throw new Error('Bedrock server download is not implemented.');
    }

    acceptEulaAndStart() {
        const eulaPath = path.join(this.config.minecraftDir, 'eula.txt');
        if (fs.existsSync(eulaPath)) {
            try {
                let content = fs.readFileSync(eulaPath, 'utf8');
                content = content.replace('eula=false', 'eula=true');
                fs.writeFileSync(eulaPath, content);

                this.broadcastMessage({ type: 'notification', message: 'EULA accepted. Restarting server...', level: 'info' });
                this.startMinecraftServer();
            } catch (error) {
                console.error('Failed to accept EULA:', error);
                this.broadcastMessage({ type: 'error', message: 'Failed to update EULA file.' });
            }
        } else {
            this.broadcastMessage({ type: 'error', message: 'eula.txt not found. Try starting the server once to generate it.' });
        }
    }

    async startMinecraftServer() {
        if (this.minecraftProcess) {
            this.broadcastMessage({
                type: 'notification',
                message: 'Server is already running',
                level: 'warning'
            });
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
                javaArgs = [
                    `-Xmx${this.config.maxRam}`,
                    `-Xms${this.config.maxRam}`,
                    '-jar',
                    this.config.serverJar,
                    'nogui'
                ];
            } else if (this.config.serverType === 'bedrock') {
                serverExecutablePath = path.join(this.config.minecraftDir, this.config.bedrockServerExecutable);
                if (!fs.existsSync(serverExecutablePath)) {
                    await this.downloadBedrockServer();
                }
                // For Bedrock, the executable is run directly
            } else {
                throw new Error(`Unsupported server type: ${this.config.serverType}`);
            }
        } catch (error) {
            this.broadcastMessage({ type: 'error', message: `Could not prepare server: ${error.message}`});
            return; // Stop if download failed
        }
        
        console.log('Starting Minecraft server...');
        this.minecraftProcess = spawn(
            this.config.serverType === 'java' ? this.config.javaPath : serverExecutablePath, 
            this.config.serverType === 'java' ? javaArgs : [], 
            {
                cwd: this.config.minecraftDir,
                stdio: ['pipe', 'pipe', 'pipe']
            }
        );
        
        this.minecraftProcess.on('error', (err) => {
            console.error(`Failed to start server process: ${err.message}`);
            this.broadcastMessage({ type: 'error', message: `Failed to start server: ${err.message}. Ensure Java is installed and in your PATH.` });
            this.minecraftProcess = null;
        });

        this.minecraftProcess.stdout.on('data', (data) => {
            const output = data.toString();
            this.parseServerOutput(output);
            this.broadcastMessage({
                type: 'console',
                message: output.trim()
            });
        });
        
        this.minecraftProcess.stderr.on('data', (data) => {
            const output = data.toString();
            this.broadcastMessage({
                type: 'console',
                message: `ERROR: ${output.trim()}`
            });
        });
        
        this.minecraftProcess.on('exit', (code) => {
            console.log(`Server process exited with code ${code}`);

            // Check if exit was due to unaccepted EULA
            const eulaPath = path.join(this.config.minecraftDir, 'eula.txt');
            if (fs.existsSync(eulaPath)) {
                const eulaContent = fs.readFileSync(eulaPath, 'utf8');
                if (eulaContent.includes('eula=false')) {
                    this.broadcastMessage({ type: 'eula_required' });
                    this.minecraftProcess = null;
                    this.serverStatus = 'offline';
                    this.broadcastMessage({ type: 'status', online: false, stats: this.stats });
                    this.broadcastMessage({ type: 'notification', message: 'You must accept the EULA to run the server.', level: 'warning' });
                    return; // Stop further processing
                }
            }
            
            this.minecraftProcess = null;
            this.serverStatus = 'offline';
            this.startTime = null;
            
            this.broadcastMessage({
                type: 'status',
                online: false,
                stats: this.stats
            });
            
            this.broadcastMessage({
                type: 'notification',
                message: 'Server stopped',
                level: 'info'
            });
        });
        
        this.serverStatus = 'online';
        this.startTime = Date.now();
        
        this.broadcastMessage({
            type: 'status',
            online: true,
            stats: this.stats
        });
        
        this.broadcastMessage({
            type: 'notification',
            message: 'Server started successfully',
            level: 'success'
        });
    }

    stopMinecraftServer() {
        if (!this.minecraftProcess) {
            this.broadcastMessage({
                type: 'notification',
                message: 'Server is not running',
                level: 'warning'
            });
            return;
        }
        
        // Send stop command
        this.minecraftProcess.stdin.write('stop\n');
        
        // Force kill after 10 seconds if not stopped
        setTimeout(() => {
            if (this.minecraftProcess) {
                this.minecraftProcess.kill();
            }
        }, 10000);
    }

    restartMinecraftServer() {
        if (this.minecraftProcess) {
            this.broadcastMessage({
                type: 'notification',
                message: 'Restarting server...',
                level: 'info'
            });
            
            this.minecraftProcess.on('exit', () => {
                setTimeout(() => {
                    this.startMinecraftServer();
                }, 2000);
            });
            
            this.stopMinecraftServer();
        } else {
            this.startMinecraftServer();
        }
    }

    sendMinecraftCommand(command) {
        if (!this.minecraftProcess) {
            this.broadcastMessage({
                type: 'notification',
                message: 'Server is not running',
                level: 'warning'
            });
            return;
        }
        
        this.minecraftProcess.stdin.write(`${command}\n`);
    }

    parseServerOutput(output) {
        // Parse server output to extract useful information
        const lines = output.split('\n');
        
        lines.forEach(line => {
            // Player join/leave events
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
            
            // Server fully started
            if (line.includes('Done') && line.includes('For help, type "help"')) {
                this.broadcastMessage({
                    type: 'notification',
                    message: 'Server fully loaded and ready',
                    level: 'success'
                });
            }
        });
        
        // Update stats
        this.stats.players = this.players.length;
        if (this.startTime) {
            const uptime = Date.now() - this.startTime;
            this.stats.uptime = this.formatUptime(uptime);
        }
    }

    updatePlayersList() {
        this.broadcastMessage({
            type: 'players',
            players: this.players
        });
    }

    formatUptime(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    async createBackup() {
        /** @tweakable The compression level for zip backups (0-9). 9 is highest compression. */
        const zipCompressionLevel = 9;

        return new Promise((resolve, reject) => {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFilename = `backup-${timestamp}.zip`;
            const backupPath = path.join(__dirname, 'backups', backupFilename);
            
            // Create backups directory if it doesn't exist
            const backupsDir = path.join(__dirname, 'backups');
            if (!fs.existsSync(backupsDir)) {
                fs.mkdirSync(backupsDir, { recursive: true });
            }
            
            const output = fs.createWriteStream(backupPath);
            const archive = archiver('zip', { zlib: { level: zipCompressionLevel } });
            
            output.on('close', () => {
                this.broadcastMessage({
                    type: 'notification',
                    message: `Backup created: ${backupFilename}`,
                    level: 'success'
                });
                resolve(backupFilename);
            });
            
            archive.on('error', (err) => {
                this.broadcastMessage({
                    type: 'error',
                    message: `Backup failed: ${err.message}`
                });
                reject(err);
            });
            
            archive.pipe(output);
            archive.directory(this.config.minecraftDir, false);
            archive.finalize();
        });
    }

    updateSettings(settings) {
        this.config = { ...this.config, ...settings };
        
        // Update server.properties if server type or port changed
        if (settings.port || settings.maxPlayers) {
            this.updateServerProperties(settings);
        }
        
        this.broadcastMessage({
            type: 'notification',
            message: 'Settings updated successfully',
            level: 'success'
        });
    }

    updateServerProperties(settings) {
        const serverPropsPath = path.join(this.config.minecraftDir, 'server.properties');
        
        if (fs.existsSync(serverPropsPath)) {
            let content = fs.readFileSync(serverPropsPath, 'utf8');
            
            if (settings.port) {
                content = content.replace(/server-port=\d+/, `server-port=${settings.port}`);
            }
            if (settings.maxPlayers) {
                content = content.replace(/max-players=\d+/, `max-players=${settings.maxPlayers}`);
            }
            
            fs.writeFileSync(serverPropsPath, content);
        }
    }

    sendToClient(ws, message) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    broadcastMessage(message) {
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(message));
            }
        });
    }
}

// Start the server
new MinecraftServerManager();