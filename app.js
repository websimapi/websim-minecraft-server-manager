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
        this.showToast('Preparing download...', 'info');
        /* @tweakable URL to download the server bridge from */
        const downloadUrl = '/api/download-bridge';
        
        fetch(downloadUrl)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Network response was not ok: ${response.statusText}`);
                }
                const contentDisposition = response.headers.get('content-disposition');
                let filename = 'mc-manager-bridge.zip';
                if (contentDisposition) {
                    const filenameMatch = contentDisposition.match(/filename="?(.+?)"?$/);
                    if (filenameMatch && filenameMatch.length > 1) {
                        filename = filenameMatch[1];
                    }
                }
                return Promise.all([response.blob(), filename]);
            })
            .then(([blob, filename]) => {
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                a.remove();
                this.showToast('Download started!', 'success');
            })
            .catch(error => {
                console.error('Download failed:', error);
                this.showToast('Download failed. See console for details.', 'error');
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