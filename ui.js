import * as state from './state.js';

let apiHandler = {};

function switchSection(sectionId) {
    document.querySelectorAll('.section').forEach(section => {
        section.classList.add('hidden');
    });
    document.getElementById(sectionId).classList.remove('hidden');

    const pageTitle = document.querySelector('.page-title');
    if (pageTitle) {
        pageTitle.textContent = sectionId.charAt(0).toUpperCase() + sectionId.slice(1);
    }
}

function bindEventListeners() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            switchSection(item.dataset.section);
        });
    });

    document.getElementById('startStopBtn').addEventListener('click', () => apiHandler.toggleServer());
    document.getElementById('restartBtn').addEventListener('click', () => apiHandler.restartServer());
    document.getElementById('saveWorldBtn').addEventListener('click', () => apiHandler.saveWorld());
    document.getElementById('backupBtn').addEventListener('click', () => apiHandler.createBackup());

    document.getElementById('commandInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') apiHandler.sendCommand();
    });
    document.getElementById('sendCommandBtn').addEventListener('click', () => apiHandler.sendCommand());
    document.getElementById('clearConsoleBtn').addEventListener('click', clearConsole);
    document.getElementById('scrollToggleBtn').addEventListener('click', toggleAutoScroll);

    document.getElementById('kickPlayerBtn').addEventListener('click', () => apiHandler.kickPlayer());
    document.getElementById('banPlayerBtn').addEventListener('click', () => apiHandler.banPlayer());
    document.getElementById('opPlayerBtn').addEventListener('click', () => apiHandler.opPlayer());

    document.getElementById('createBackupBtn').addEventListener('click', () => apiHandler.createBackup());
    document.getElementById('uploadFileBtn').addEventListener('click', () => document.getElementById('fileUpload').click());
    document.getElementById('fileUpload').addEventListener('change', (e) => apiHandler.uploadFile(e.target.files[0]));

    document.getElementById('saveSettingsBtn').addEventListener('click', () => apiHandler.saveSettings());
    document.getElementById('downloadBridgeBtn').addEventListener('click', () => apiHandler.downloadBridge());

    const geyserCheck = document.getElementById('enableGeyserCheck');
    const floodgateGroup = document.getElementById('floodgateGroup');
    const floodgateCheck = document.getElementById('enableFloodgateCheck');
    
    const toggleFloodgate = () => {
        if (geyserCheck.checked) {
            floodgateGroup.style.display = 'flex';
        } else {
            floodgateGroup.style.display = 'none';
            floodgateCheck.checked = false;
        }
    };

    geyserCheck.addEventListener('change', toggleFloodgate);
    // Initial state
    toggleFloodgate();
}

export function initialize(api) {
    apiHandler = api;
    bindEventListeners();
}

export function updateBridgeStatus(connected) {
    const statusIndicator = document.getElementById('bridgeStatusIndicator');
    const statusText = document.getElementById('bridgeStatusText');

    if (connected) {
        statusIndicator.className = 'status-indicator online';
        statusText.textContent = 'Bridge Online';
    } else {
        statusIndicator.className = 'status-indicator offline';
        statusText.textContent = 'Bridge Offline';
    }
}

export function updateServerStatus(online, stats = {}) {
    const statusIndicator = document.getElementById('serverStatusIndicator');
    const statusText = document.getElementById('serverStatusText');
    const startStopBtn = document.getElementById('startStopBtn');

    if (online) {
        statusIndicator.className = 'status-indicator online';
        statusText.textContent = 'Server Online';
        startStopBtn.innerHTML = '<i class="fas fa-stop"></i> Stop Server';
        startStopBtn.className = 'btn btn-secondary';
    } else {
        statusIndicator.className = 'status-indicator offline';
        statusText.textContent = 'Server Offline';
        startStopBtn.innerHTML = '<i class="fas fa-play"></i> Start Server';
        startStopBtn.className = 'btn btn-primary';
    }

    document.getElementById('playerCount').textContent = stats.players ?? '0';
    document.getElementById('uptime').textContent = stats.uptime ?? '00:00:00';
    document.getElementById('ramUsage').textContent = stats.ram ?? '0 MB';
    document.getElementById('tps').textContent = stats.tps ?? '20.0';
}

export function updatePlayersList(players) {
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

export function appendConsoleOutput(message, type = 'info') {
    const consoleOutput = document.getElementById('consoleOutput');
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry log-${type}`;
    let formattedMessage = `[${timestamp}] ${message}`;

    if (type === 'command') formattedMessage = `<span style="color: #60a5fa;">${formattedMessage}</span>`;
    else if (message.includes('ERROR')) formattedMessage = `<span style="color: #ef4444;">${formattedMessage}</span>`;
    else if (message.includes('WARN')) formattedMessage = `<span style="color: #f59e0b;">${formattedMessage}</span>`;

    logEntry.innerHTML = formattedMessage;
    consoleOutput.appendChild(logEntry);

    if (state.get().autoScroll) {
        consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }

    const maxLines = 1000;
    while (consoleOutput.children.length > maxLines) {
        consoleOutput.removeChild(consoleOutput.firstChild);
    }
}

export function clearConsole() {
    document.getElementById('consoleOutput').innerHTML = '';
}

export function toggleAutoScroll() {
    const isAutoScroll = state.toggleAutoScroll();
    const btn = document.getElementById('scrollToggleBtn');
    btn.innerHTML = isAutoScroll ?
        '<i class="fas fa-arrows-alt-v"></i> Auto-scroll' :
        '<i class="fas fa-arrows-alt-v"></i> Manual';
}

export function showLoading() {
    document.getElementById('loadingOverlay').classList.add('active');
}

export function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('active');
}

export function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = {
        success: 'fas fa-check-circle',
        error: 'fas fa-exclamation-circle',
        warning: 'fas fa-exclamation-triangle',
        info: 'fas fa-info-circle'
    } [type] || 'fas fa-info-circle';
    toast.innerHTML = `<i class="${icon}"></i><span>${message}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}