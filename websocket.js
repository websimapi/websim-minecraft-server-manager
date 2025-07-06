import { wsUrl, reconnectInterval, maxReconnectAttempts } from './config.js';
import * as state from './state.js';
import * as ui from './ui.js';

let socket = null;
let messageHandler = () => {};

export function sendWebSocketMessage(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
    } else {
        ui.showToast('Not connected to server', 'error');
    }
}

function attemptReconnect() {
    if (state.get().reconnectAttempts < maxReconnectAttempts) {
        state.incrementReconnectAttempts();
        console.log(`Attempting to reconnect... (${state.get().reconnectAttempts}/${maxReconnectAttempts})`);
        /* @tweakable Delay before a reconnection attempt is made, in milliseconds */
        const reconnectDelay = reconnectInterval;
        setTimeout(() => connectWebSocket(messageHandler), reconnectDelay);
    } else {
        ui.showToast('Failed to connect to server after multiple attempts.', 'error');
        console.error('Max reconnection attempts reached.');
    }
}

export function connectWebSocket(handler) {
    messageHandler = handler;
    try {
        if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
            console.log("WebSocket connection already open or in progress.");
            return;
        }

        ui.updateConnectionStatus(false, true); // Set to connecting state
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log('WebSocket connected');
            state.setConnected(true);
            state.resetReconnectAttempts();
            ui.showToast('Connected to server bridge', 'success');
            ui.updateConnectionStatus(true);
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                messageHandler(data);
            } catch (e) {
                console.error("Failed to parse WebSocket message:", e);
            }
        };

        socket.onclose = () => {
            console.log('WebSocket disconnected');
            state.setConnected(false);
            ui.updateServerStatus(false); // Visually indicate disconnection
            ui.updateConnectionStatus(false);
            if (state.get().autoReconnect) {
                attemptReconnect();
            }
        };

        socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            ui.showToast('Connection error', 'error');
            ui.updateConnectionStatus(false);
            // onclose will be called next, triggering reconnect logic
        };
    } catch (error) {
        console.error('Failed to create WebSocket:', error);
        ui.updateConnectionStatus(false);
        if (state.get().autoReconnect) {
            attemptReconnect();
        }
    }
}