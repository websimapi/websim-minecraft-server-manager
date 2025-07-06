import { wsUrl, reconnectInterval, maxReconnectAttempts } from './config.js';
import * as state from './state.js';
import * as ui from './ui.js';

let socket = null;
let reconnectTimer = null;

export function sendWebSocketMessage(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
    } else {
        ui.showToast('Not connected to bridge', 'error');
    }
}

function attemptReconnect(handler) {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
    }
    
    if (state.get().reconnectAttempts < maxReconnectAttempts) {
        state.incrementReconnectAttempts();
        console.log(`Attempting to reconnect... (${state.get().reconnectAttempts}/${maxReconnectAttempts})`);
        /* @tweakable Delay before a reconnection attempt is made, in milliseconds */
        const reconnectDelay = reconnectInterval;
        reconnectTimer = setTimeout(() => connectWebSocket(handler), reconnectDelay);
    } else {
        ui.showToast('Failed to connect to bridge after multiple attempts.', 'error');
        console.error('Max reconnection attempts reached.');
        ui.updateBridgeStatus('disconnected');
    }
}

export function connectWebSocket(handler) {
    if (typeof handler !== 'function') {
        console.error('connectWebSocket called without a valid handler.');
        return;
    }

    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        console.log("WebSocket connection already open or in progress.");
        return;
    }

    ui.updateBridgeStatus('connecting');
    
    try {
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log('WebSocket connected');
            state.setConnected(true);
            state.resetReconnectAttempts();
            ui.showToast('Connected to server bridge', 'success');
            ui.updateBridgeStatus('connected');
            if (reconnectTimer) clearTimeout(reconnectTimer);
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handler(data);
            } catch (e) {
                console.error("Failed to parse WebSocket message:", e, event.data);
            }
        };

        socket.onclose = () => {
            console.log('WebSocket disconnected');
            socket = null; // Clear the socket object
            state.setConnected(false);
            ui.updateMinecraftServerStatus(false); // Visually indicate server is offline if bridge disconnects
            ui.updateBridgeStatus('disconnected');
            if (state.get().autoReconnect) {
                attemptReconnect(handler);
            }
        };

        socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            ui.showToast('Connection error', 'error');
            // onclose will be called next, triggering reconnect logic if enabled.
        };
    } catch (error) {
        console.error('Failed to create WebSocket:', error);
        ui.updateBridgeStatus('disconnected');
        if (state.get().autoReconnect) {
            attemptReconnect(handler);
        }
    }
}