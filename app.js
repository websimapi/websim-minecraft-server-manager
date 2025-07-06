import { connectWebSocket, sendWebSocketMessage } from './websocket.js';
import * as api from './api.js';
import * as ui from './ui.js';
import * as state from './state.js';
import { updateInterval } from './config.js';

// Helpers for uptime conversion
function parseHmsToSec(hms) {
    const [h, m, s] = hms.split(':').map(Number);
    return h * 3600 + m * 60 + s;
}
function secToHms(sec) {
    const h = String(Math.floor(sec / 3600)).padStart(2, '0');
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

let uptimeTicker;

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'console':
            ui.appendConsoleOutput(data.message);
            break;
        case 'status':
            const online = data.online;
            const stats = data.stats;
            // update server status & reset client-side uptime counter
            state.setServerStatus(online ? 'online' : 'offline');
            if (stats.uptime) {
                const secs = parseHmsToSec(stats.uptime);
                state.set({ uptimeSec: secs });
            } else {
                state.set({ uptimeSec: 0 });
            }
            ui.updateServerStatus(online, stats);
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
            api.ping();
        }
    }, updateInterval);
}

function initialize() {
    ui.initialize(api);
    ui.updateBridgeStatus(false);
    ui.updateServerStatus(false);
    connectWebSocket(handleWebSocketMessage);
    startPeriodicUpdates();
    
    // start a client-side ticker to increment uptime every second
    if (uptimeTicker) clearInterval(uptimeTicker);
    uptimeTicker = setInterval(() => {
        if (state.get().serverStatus === 'online') {
            const cur = state.get().uptimeSec || 0;
            const next = cur + 1;
            state.set({ uptimeSec: next });
            const fmt = secToHms(next);
            const el = document.getElementById('uptime');
            if (el) el.textContent = fmt;
        }
    }, 1000);
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