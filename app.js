import { connectWebSocket, sendWebSocketMessage } from './websocket.js';
import * as api from './api.js';
import * as ui from './ui.js';
import * as state from './state.js';
import { updateInterval } from './config.js';

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'console':
            ui.appendConsoleOutput(data.message);
            break;
        case 'status':
            state.setServerStatus(data.online ? 'online' : 'offline');
            ui.updateMinecraftServerStatus(data.online, data.stats);
            ui.hideLoading();
            break;
        case 'players':
            state.setPlayers(data.players);
            ui.updatePlayersList(data.players);
            break;
        case 'notification':
            ui.showToast(data.message, data.level || 'info');
            if (data.message.includes('Backup created')) {
                ui.hideLoading();
            }
            break;
        case 'error':
            ui.showToast(data.message, 'error');
            ui.hideLoading();
            break;
        default:
            console.log('Unknown message type:', data.type);
    }
}

function startPeriodicUpdates() {
    setInterval(() => {
        if (state.get().isConnected) {
            sendWebSocketMessage({ type: 'ping' });
        }
    }, updateInterval);
}

function connect() {
    connectWebSocket(handleWebSocketMessage);
}

function initialize() {
    ui.initialize(api, connect);
    state.loadClientSettings(); // Load settings from localStorage
    ui.applyClientSettings(); // Update UI with loaded settings
    ui.updateMinecraftServerStatus(false);
    if (state.get().autoReconnect) {
        connect();
    } else {
        ui.updateBridgeStatus('disconnected');
    }
    startPeriodicUpdates();
}

document.addEventListener('DOMContentLoaded', initialize);

// Handle mobile responsiveness
window.addEventListener('resize', () => {
    if (window.innerWidth <= 768) {
        document.body.classList.add('mobile');
    } else {
        document.body.classList.remove('mobile');
    }
});