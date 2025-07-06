import { connectWebSocket, sendWebSocketMessage } from './websocket.js';
import * as ui from './ui.js';
import * as state from './state.js';
import { zipFilename } from './config.js';

export function toggleServer() {
    if (state.get().serverStatus === 'online') {
        stopServer();
    } else {
        startServer();
    }
}

export function startServer() {
    ui.showLoading();
    sendWebSocketMessage({ type: 'start' });
    ui.showToast('Starting server...', 'info');
}

export function stopServer() {
    ui.showLoading();
    sendWebSocketMessage({ type: 'stop' });
    ui.showToast('Stopping server...', 'info');
}

export function restartServer() {
    ui.showLoading();
    sendWebSocketMessage({ type: 'restart' });
    ui.showToast('Restarting server...', 'info');
}

export function saveWorld() {
    sendWebSocketMessage({ type: 'command', command: 'save-all' });
    ui.showToast('Saving world...', 'info');
}

export function createBackup() {
    ui.showLoading();
    sendWebSocketMessage({ type: 'backup' });
    ui.showToast('Creating backup...', 'info');
}

export function sendCommand() {
    const input = document.getElementById('commandInput');
    const command = input.value.trim();

    if (command) {
        sendWebSocketMessage({ type: 'command', command });
        ui.appendConsoleOutput(`> ${command}`, 'command');
        input.value = '';
    }
}

function playerAction(command) {
    const playerName = document.getElementById('playerActionInput').value.trim();
    if (playerName) {
        sendWebSocketMessage({
            type: 'command',
            command: `${command} ${playerName}`
        });
        const actionText = command.charAt(0).toUpperCase() + command.slice(1);
        ui.showToast(`${actionText} player: ${playerName}`, 'info');
        document.getElementById('playerActionInput').value = '';
    }
}

export function kickPlayer() {
    playerAction('kick');
}

export function banPlayer() {
    playerAction('ban');
}

export function opPlayer() {
    playerAction('op');
}

export function uploadFile(file) {
    if (!file) return;

    ui.showLoading();
    const formData = new FormData();
    formData.append('file', file);

    fetch('/api/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        ui.hideLoading();
        if (data.success) {
            ui.showToast('File uploaded successfully', 'success');
        } else {
            ui.showToast(data.message || 'Failed to upload file', 'error');
        }
    })
    .catch(error => {
        ui.hideLoading();
        ui.showToast('Upload error', 'error');
        console.error('Upload error:', error);
    });
}

export function saveSettings() {
    const serverSettings = {
        serverType: document.getElementById('serverTypeSelect').value,
        maxPlayers: parseInt(document.getElementById('maxPlayersInput').value, 10),
        port: parseInt(document.getElementById('portInput').value, 10),
        ram: parseInt(document.getElementById('ramInput').value, 10),
        autoStart: document.getElementById('autoStartCheck').checked,
        enableGeyser: document.getElementById('enableGeyserCheck').checked,
        enableFloodgate: document.getElementById('enableFloodgateCheck').checked
    };

    // Save client-side settings
    const autoReconnect = document.getElementById('autoReconnectCheck').checked;
    state.setAutoReconnect(autoReconnect);

    // Send server-side settings to the bridge
    sendWebSocketMessage({ type: 'settings', settings: serverSettings });
    ui.showToast('Settings saved. A server restart may be required for some changes to take effect.', 'info');
}

export function downloadBridge() {
    ui.showLoading();
    ui.showToast('Preparing download...', 'info');

    const zip = new JSZip();

    const readmeContent = `
# Minecraft Server Manager - Node.js Bridge
Thank you for downloading the server bridge! This Node.js application is the backend that allows the web interface to manage your Minecraft server.
## Instructions:
1.  **Prerequisites:** You need Node.js installed. Download from [https://nodejs.org/](https://nodejs.org/).
2.  **Unzip:** Extract this .zip file.
3.  **Install Dependencies:** Open a terminal or command prompt in the extracted folder and run: \`npm install\`
4.  **Add Server Jar:** Create a 'minecraft' folder and place your server .jar file inside. If you don't have one, the bridge will attempt to download the latest version for you on first start. You may need to run it once manually to accept the EULA if issues arise.
5.  **Run Bridge:** Start the server with: \`npm start\`
The manager backend will run on port 3001. Use the web UI to connect.
    `.trim().replace(/    /g, '');

    zip.file('README.md', readmeContent);
    zip.folder('minecraft'); // Create empty minecraft directory for user

    /* @tweakable The list of server-side files to include in the downloadable bridge .zip file. */
    const filesToFetch = [
        'server.js',
        'package.json',
        'server/config.js',
        'server/http.js',
        'server/minecraft-adapter.js',
        'server/minecraft-server.js',
        'server/websocket.js'
    ];

    const fetchPromises = filesToFetch.map(file =>
        fetch(file)
        .then(res => {
            if (!res.ok) throw new Error(`Failed to fetch ${file}: ${res.statusText}`);
            return res.text();
        })
        .then(text => zip.file(file, text))
    );

    Promise.all(fetchPromises)
        .then(() => zip.generateAsync({ type: 'blob' }))
        .then(content => {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = zipFilename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
            ui.hideLoading();
            ui.showToast('Download complete!', 'success');
        })
        .catch(error => {
            console.error('Failed to create bridge zip:', error);
            ui.showToast('Failed to create download package.', 'error');
            ui.hideLoading();
        });
}

export function ping() {
    sendWebSocketMessage({ type: 'ping' });
}

export function connectManually() {
    if (!state.get().isConnected) {
        ui.showToast('Attempting to connect to bridge...', 'info');
        connectWebSocket(window.handleWebSocketMessage); // Use global handler
    } else {
        ui.showToast('Already connected.', 'info');
    }
}