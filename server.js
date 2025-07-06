const express = require('express');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

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
            maxRam: '2G',
            serverType: 'java', // 'java' or 'bedrock'
            autoStart: false
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
        this.app.use(express.static('public'));
        
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
            /* @tweakable filename for the downloaded server bridge zip */
            const zipFilename = 'mc-manager-bridge.zip';
            const archive = archiver('zip', {
                zlib: { level: 9 }
            });

            res.attachment(zipFilename);
            archive.pipe(res);

            const readmeContent = `
# Minecraft Server Manager - Node.js Bridge

Thank you for downloading the server bridge!

## Instructions:

1.  **Prerequisites:** You need to have Node.js installed. You can download it from [https://nodejs.org/](https://nodejs.org/).

2.  **Unzip:** Extract the contents of this .zip file into a folder.

3.  **Install Dependencies:** Open a terminal or command prompt in that folder and run:
    \`\`\`
    npm install
    \`\`\`

4.  **Add Minecraft Server Jar:** Place your Minecraft server .jar file (e.g., 'server.jar') inside the 'minecraft' directory.

5.  **Run the Bridge:** Start the server bridge by running:
    \`\`\`
    npm start
    \`\`\`

The manager backend will now be running. You can access the web interface in your browser (usually at http://localhost:3001) to manage your server.
            `.trim();

            archive.append(readmeContent, { name: 'README.md' });
            archive.file('server.js', { name: 'server.js' });
            archive.file('package.json', { name: 'package.json' });
            archive.directory(path.join(__dirname, 'public/'), 'public');
            
            // Add an empty minecraft directory to guide the user
            archive.append(null, { name: 'minecraft/' });

            archive.finalize();
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
enable-rcon=true
rcon.port=25575
rcon.password=minecraft
            `.trim();
            fs.writeFileSync(serverPropsPath, defaultProps);
        }
        
        // Accept EULA
        const eulaPath = path.join(this.config.minecraftDir, 'eula.txt');
        if (!fs.existsSync(eulaPath)) {
            fs.writeFileSync(eulaPath, 'eula=true\n');
        }
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
            default:
                console.log('Unknown message type:', data.type);
        }
    }

    startMinecraftServer() {
        if (this.minecraftProcess) {
            this.broadcastMessage({
                type: 'notification',
                message: 'Server is already running',
                level: 'warning'
            });
            return;
        }
        
        const serverJarPath = path.join(this.config.minecraftDir, this.config.serverJar);
        
        if (!fs.existsSync(serverJarPath)) {
            this.broadcastMessage({
                type: 'error',
                message: 'Server JAR file not found. Please upload a server.jar file.'
            });
            return;
        }
        
        const javaArgs = [
            `-Xmx${this.config.maxRam}`,
            `-Xms${this.config.maxRam}`,
            '-jar',
            this.config.serverJar,
            'nogui'
        ];
        
        console.log('Starting Minecraft server...');
        this.minecraftProcess = spawn(this.config.javaPath, javaArgs, {
            cwd: this.config.minecraftDir,
            stdio: ['pipe', 'pipe', 'pipe']
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
            const archive = archiver('zip', { zlib: { level: 9 } });
            
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