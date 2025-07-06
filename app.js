class MinecraftServerManager {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.serverStatus = 'offline';
        this.autoScroll = true;
        this.players = [];
        
        /* @tweakable WebSocket connection URL */
        this.wsUrl = 'ws://localhost:3001';
        
        /* @tweakable reconnection settings */
        this.reconnectInterval = 5000;
        this.maxReconnectAttempts = 10;
        this.reconnectAttempts = 0;
        
        this.initializeUI();
        this.connectWebSocket();
        this.startPeriodicUpdates();
    }

    initializeUI() {
        this.bindEventListeners();
        this.updateServerStatus(false);
    }

    bindEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                
                // Set active class on nav item
                document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
                item.classList.add('active');

                this.switchSection(item.dataset.section);
            });
        });

        // Server control buttons
        document.getElementById('startStopBtn').addEventListener('click', () => {
            this.toggleServer();
        });

        document.getElementById('restartBtn').addEventListener('click', () => {
            this.restartServer();
        });

        document.getElementById('saveWorldBtn').addEventListener('click', () => {
            this.saveWorld();
        });

        document.getElementById('backupBtn').addEventListener('click', () => {
            this.createBackup();
        });

        // Console
        document.getElementById('commandInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendCommand();
            }
        });

        document.getElementById('sendCommandBtn').addEventListener('click', () => {
            this.sendCommand();
        });

        document.getElementById('clearConsoleBtn').addEventListener('click', () => {
            this.clearConsole();
        });

        document.getElementById('scrollToggleBtn').addEventListener('click', () => {
            this.toggleAutoScroll();
        });

        // Player actions
        document.getElementById('kickPlayerBtn').addEventListener('click', () => {
            this.kickPlayer();
        });

        document.getElementById('banPlayerBtn').addEventListener('click', () => {
            this.banPlayer();
        });

        document.getElementById('opPlayerBtn').addEventListener('click', () => {
            this.opPlayer();
        });

        // File operations
        document.getElementById('createBackupBtn').addEventListener('click', () => {
            this.createBackup();
        });

        document.getElementById('uploadFileBtn').addEventListener('click', () => {
            document.getElementById('fileUpload').click();
        });

        document.getElementById('fileUpload').addEventListener('change', (e) => {
            this.uploadFile(e.target.files[0]);
        });

        // Settings
        document.getElementById('saveSettingsBtn').addEventListener('click', () => {
            this.saveSettings();
        });

        // Downloads
        document.getElementById('downloadBridgeBtn').addEventListener('click', () => {
            this.downloadBridge();
        });
    }

    switchSection(sectionId) {
        // Hide all sections
        document.querySelectorAll('.section').forEach(section => {
            section.classList.add('hidden');
        });

        // Show selected section
        document.getElementById(sectionId).classList.remove('hidden');
        
        // Update page title
        const pageTitle = document.querySelector('.page-title');
        if (pageTitle) {
            pageTitle.textContent = sectionId.charAt(0).toUpperCase() + sectionId.slice(1);
        }
    }

    connectWebSocket() {
        try {
            this.socket = new WebSocket(this.wsUrl);
            
            this.socket.onopen = () => {
                console.log('WebSocket connected');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.showToast('Connected to server', 'success');
            };

            this.socket.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.handleWebSocketMessage(data);
            };

            this.socket.onclose = () => {
                console.log('WebSocket disconnected');
                this.isConnected = false;
                this.attemptReconnect();
            };

            this.socket.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.showToast('Connection error', 'error');
            };
        } catch (error) {
            console.error('Failed to connect WebSocket:', error);
            this.attemptReconnect();
        }
    }

    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            
            setTimeout(() => {
                this.connectWebSocket();
            }, this.reconnectInterval);
        } else {
            this.showToast('Failed to connect to server', 'error');
        }
    }

    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'console':
                this.appendConsoleOutput(data.message);
                break;
            case 'status':
                this.updateServerStatus(data.online, data.stats);
                break;
            case 'players':
                this.updatePlayersList(data.players);
                break;
            case 'notification':
                this.showToast(data.message, data.level || 'info');
                break;
            case 'error':
                this.showToast(data.message, 'error');
                break;
            default:
                console.log('Unknown message type:', data.type);
        }
    }

    sendWebSocketMessage(message) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(message));
        } else {
            this.showToast('Not connected to server', 'error');
        }
    }

    toggleServer() {
        if (this.serverStatus === 'online') {
            this.stopServer();
        } else {
            this.startServer();
        }
    }

    startServer() {
        this.showLoading();
        this.sendWebSocketMessage({ type: 'start' });
        this.showToast('Starting server...', 'info');
    }

    stopServer() {
        this.showLoading();
        this.sendWebSocketMessage({ type: 'stop' });
        this.showToast('Stopping server...', 'info');
    }

    restartServer() {
        this.showLoading();
        this.sendWebSocketMessage({ type: 'restart' });
        this.showToast('Restarting server...', 'info');
    }

    saveWorld() {
        this.sendWebSocketMessage({ type: 'command', command: 'save-all' });
        this.showToast('Saving world...', 'info');
    }

    createBackup() {
        this.showLoading();
        this.sendWebSocketMessage({ type: 'backup' });
        this.showToast('Creating backup...', 'info');
    }

    sendCommand() {
        const input = document.getElementById('commandInput');
        const command = input.value.trim();
        
        if (command) {
            this.sendWebSocketMessage({ type: 'command', command });
            this.appendConsoleOutput(`> ${command}`, 'command');
            input.value = '';
        }
    }

    clearConsole() {
        document.getElementById('consoleOutput').innerHTML = '';
    }

    toggleAutoScroll() {
        this.autoScroll = !this.autoScroll;
        const btn = document.getElementById('scrollToggleBtn');
        btn.innerHTML = this.autoScroll ? 
            '<i class="fas fa-arrows-alt-v"></i> Auto-scroll' : 
            '<i class="fas fa-arrows-alt-v"></i> Manual';
    }

    appendConsoleOutput(message, type = 'info') {
        const consoleOutput = document.getElementById('consoleOutput');
        const timestamp = new Date().toLocaleTimeString();
        
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry log-${type}`;
        
        let formattedMessage = `[${timestamp}] ${message}`;
        
        // Color coding for different log types
        if (type === 'command') {
            formattedMessage = `<span style="color: #60a5fa;">${formattedMessage}</span>`;
        } else if (message.includes('ERROR')) {
            formattedMessage = `<span style="color: #ef4444;">${formattedMessage}</span>`;
        } else if (message.includes('WARN')) {
            formattedMessage = `<span style="color: #f59e0b;">${formattedMessage}</span>`;
        } else if (message.includes('INFO')) {
            formattedMessage = `<span style="color: #10b981;">${formattedMessage}</span>`;
        }
        
        logEntry.innerHTML = formattedMessage;
        consoleOutput.appendChild(logEntry);
        
        // Auto-scroll to bottom
        if (this.autoScroll) {
            consoleOutput.scrollTop = consoleOutput.scrollHeight;
        }
        
        // Limit console history
        const maxLines = 1000;
        while (consoleOutput.children.length > maxLines) {
            consoleOutput.removeChild(consoleOutput.firstChild);
        }
    }

    updateServerStatus(online, stats = {}) {
        this.serverStatus = online ? 'online' : 'offline';
        
        const statusIndicator = document.getElementById('statusIndicator');
        const statusText = document.getElementById('statusText');
        const startStopBtn = document.getElementById('startStopBtn');
        
        if (online) {
            statusIndicator.className = 'status-indicator online';
            statusText.textContent = 'Online';
            startStopBtn.innerHTML = '<i class="fas fa-stop"></i> Stop Server';
            startStopBtn.className = 'btn btn-secondary';
        } else {
            statusIndicator.className = 'status-indicator offline';
            statusText.textContent = 'Offline';
            startStopBtn.innerHTML = '<i class="fas fa-play"></i> Start Server';
            startStopBtn.className = 'btn btn-primary';
        }
        
        // Update stats
        if (stats.players !== undefined) {
            document.getElementById('playerCount').textContent = stats.players;
        }
        if (stats.uptime) {
            document.getElementById('uptime').textContent = stats.uptime;
        }
        if (stats.ram) {
            document.getElementById('ramUsage').textContent = stats.ram;
        }
        if (stats.tps) {
            document.getElementById('tps').textContent = stats.tps;
        }
        
        this.hideLoading();
    }

    updatePlayersList(players) {
        this.players = players;
        const playersList = document.getElementById('playersList');
        const playerCount = document.getElementById('onlinePlayerCount');
        
        playerCount.textContent = players.length;
        
        if (players.length === 0) {
            playersList.innerHTML = '<div class="no-players">No players online</div>';
        } else {
            playersList.innerHTML = players.map(player => `
                <div class="player-item">
                    <div class="player-avatar">${player.name.charAt(0).toUpperCase()}</div>
                    <div class="player-info">
                        <div class="player-name">${player.name}</div>
                        <div class="player-status">${player.status || 'Online'}</div>
                    </div>
                </div>
            `).join('');
        }
    }

    kickPlayer() {
        const playerName = document.getElementById('playerActionInput').value.trim();
        if (playerName) {
            this.sendWebSocketMessage({ 
                type: 'command', 
                command: `kick ${playerName}` 
            });
            this.showToast(`Kicked ${playerName}`, 'info');
            document.getElementById('playerActionInput').value = '';
        }
    }

    banPlayer() {
        const playerName = document.getElementById('playerActionInput').value.trim();
        if (playerName) {
            this.sendWebSocketMessage({ 
                type: 'command', 
                command: `ban ${playerName}` 
            });
            this.showToast(`Banned ${playerName}`, 'info');
            document.getElementById('playerActionInput').value = '';
        }
    }

    opPlayer() {
        const playerName = document.getElementById('playerActionInput').value.trim();
        if (playerName) {
            this.sendWebSocketMessage({ 
                type: 'command', 
                command: `op ${playerName}` 
            });
            this.showToast(`Gave OP to ${playerName}`, 'info');
            document.getElementById('playerActionInput').value = '';
        }
    }

    uploadFile(file) {
        if (!file) return;
        
        this.showLoading();
        // Create FormData and upload via fetch
        const formData = new FormData();
        formData.append('file', file);
        
        fetch('/api/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            this.hideLoading();
            if (data.success) {
                this.showToast('File uploaded successfully', 'success');
            } else {
                this.showToast('Failed to upload file', 'error');
            }
        })
        .catch(error => {
            this.hideLoading();
            this.showToast('Upload error', 'error');
        });
    }

    saveSettings() {
        const settings = {
            serverType: document.getElementById('serverTypeSelect').value,
            maxPlayers: parseInt(document.getElementById('maxPlayersInput').value),
            port: parseInt(document.getElementById('portInput').value),
            ram: parseInt(document.getElementById('ramInput').value),
            autoStart: document.getElementById('autoStartCheck').checked
        };
        
        this.sendWebSocketMessage({ type: 'settings', settings });
        this.showToast('Settings saved', 'success');
    }

    downloadBridge() {
        this.showLoading();
        this.showToast('Preparing download...', 'info');

        /* @tweakable Filename for the downloaded server bridge zip */
        const zipFilename = 'mc-manager-bridge.zip';
        
        // Use JSZip to create the archive in the browser
        const zip = new JSZip();

        // Add a helpful README file
        const readmeContent = `
# Minecraft Server Manager - Node.js Bridge

Thank you for downloading the server bridge! This Node.js application is the backend that allows the web interface to manage your Minecraft server.

## Instructions:

1.  **Prerequisites:** You need to have Node.js installed on the machine where you'll run your Minecraft server. You can download it from [https://nodejs.org/](https://nodejs.org/).

2.  **Unzip:** Extract the contents of this .zip file into a new folder.

3.  **Install Dependencies:** Open a terminal or command prompt inside the new folder and run the following command to install the required Node.js packages:
    \`\`\`bash
    npm install
    \`\`\`

4.  **Add Minecraft Server Jar:**
    -   Create a folder named 'minecraft' inside the main folder.
    -   Place your Minecraft server .jar file (e.g., 'server.jar', 'paper.jar') inside this new 'minecraft' directory.
    -   If you haven't run this server jar before, you may need to run it once to generate the 'eula.txt' file, then edit it to set 'eula=true'.

5.  **Run the Bridge:** Start the server bridge with this command:
    \`\`\`bash
    npm start
    \`\`\`

The manager backend will now be running on port 3001 by default. You can now use the web interface to connect to it (the default URL is ws://localhost:3001) and manage your server.
        `.trim();

        zip.file('README.md', readmeContent);

        // Fetch and add other crucial files to the zip
        const filesToFetch = [
            'server.js',
            'package.json',
        ];

        const fetchPromises = filesToFetch.map(file =>
            fetch(file)
                .then(res => {
                    if (!res.ok) {
                        throw new Error(`Failed to fetch ${file}: ${res.statusText}`);
                    }
                    return res.text();
                })
                .then(text => {
                    zip.file(file, text);
                })
        );

        Promise.all(fetchPromises)
            .then(() => {
                // Create the 'minecraft' directory in the zip
                zip.folder('minecraft');

                // Generate the zip file
                return zip.generateAsync({ type: 'blob' });
            })
            .then(content => {
                // Trigger the download
                const link = document.createElement('a');
                link.href = URL.createObjectURL(content);
                link.download = zipFilename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(link.href);
                this.hideLoading();
            })
            .catch(error => {
                console.error('Failed to create bridge zip:', error);
                this.showToast('Failed to create download package.', 'error');
                this.hideLoading();
            });
    }

    showLoading() {
        document.getElementById('loadingOverlay').classList.add('active');
    }

    hideLoading() {
        document.getElementById('loadingOverlay').classList.remove('active');
    }

    showToast(message, type = 'info') {
        const toastContainer = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const icon = {
            success: 'fas fa-check-circle',
            error: 'fas fa-exclamation-circle',
            warning: 'fas fa-exclamation-triangle',
            info: 'fas fa-info-circle'
        }[type] || 'fas fa-info-circle';
        
        toast.innerHTML = `
            <i class="${icon}"></i>
            <span>${message}</span>
        `;
        
        toastContainer.appendChild(toast);
        
        // Auto-remove toast after 5 seconds
        setTimeout(() => {
            toast.remove();
        }, 5000);
    }

    startPeriodicUpdates() {
        /* @tweakable update interval in milliseconds */
        const updateInterval = 5000;
        
        setInterval(() => {
            if (this.isConnected) {
                this.sendWebSocketMessage({ type: 'ping' });
            }
        }, updateInterval);
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new MinecraftServerManager();
});

// Handle mobile responsiveness
window.addEventListener('resize', () => {
    if (window.innerWidth <= 768) {
        document.body.classList.add('mobile');
    } else {
        document.body.classList.remove('mobile');
    }
});