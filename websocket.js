import { wsUrl, reconnectInterval, maxReconnectAttempts } from './config.js';
import * as state from './state.js';
import * as ui from './ui.js';

let socket = null;
let messageHandler = () => {};

/* @tweakable [Number of reconnection attempts before stopping] */
const initialConnectAttempts = 3;
/* @tweakable [Delay in ms between initial connection attempts] */
const initialConnectInterval = 2000;

export function sendWebSocketMessage(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
    } else {
        if (message.type !== 'ping') { // Don't show toast for background pings on a disconnected client
            ui.showToast('Not connected to server', 'error');
        }
    }
}

function attemptReconnect() {
    if (state.get().reconnectAttempts < maxReconnectAttempts) {
        state.incrementReconnectAttempts();
        console.log(`Connection lost. Attempting to reconnect... (${state.get().reconnectAttempts}/${maxReconnectAttempts})`);
        setTimeout(() => connectWebSocket(messageHandler, true), reconnectInterval);
    } else {
        ui.showToast('Lost connection to server. Please reconnect manually.', 'error');
        ui.updateConnectionStatus('error');
        console.error('Max reconnection attempts reached.');
    }
}

function attemptInitialConnection(attempt = 1) {
    if (attempt > initialConnectAttempts) {
        ui.showToast('Failed to connect to the server bridge.', 'error');
        ui.updateConnectionStatus('error');
        console.error('Initial connection failed after multiple attempts.');
        return;
    }
    console.log(`Attempting to connect... (${attempt}/${initialConnectAttempts})`);
    connectWebSocket(messageHandler, false, (success) => {
        if (!success && attempt >= initialConnectAttempts) {
            // This is the final failure after all retries
            ui.updateConnectionStatus('error');
        } else if (!success) {
            // Retry logic
            setTimeout(() => attemptInitialConnection(attempt + 1), initialConnectInterval);
        }
    });
}

export function connect(handler) {
    messageHandler = handler;
    ui.updateConnectionStatus('connecting');
    attemptInitialConnection();
}

export function connectWebSocket(handler, isReconnect = false, callback) {
    messageHandler = handler;
    try {
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log('WebSocket connected');
            state.setConnected(true);
            state.resetReconnectAttempts();
            ui.showToast('Connected to server bridge', 'success');
            // Flash orange, then turn green
            ui.updateConnectionStatus('success-flash');
            if (callback) callback(true);
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
            const wasConnected = state.get().isConnected;
            state.setConnected(false);
            
            if (wasConnected) { // Only show error and attempt reconnect if connection was previously established
                ui.updateConnectionStatus('error');
                attemptReconnect();
            } else if (callback) { // For initial connection failures
                callback(false);
            }
        };

        socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            if (!isReconnect) {
                 // Don't show toast on initial connect error, onclose will trigger retry or failure message.
            } else {
                ui.showToast('Connection error', 'error');
            }
            // onclose will be called next
        };
    } catch (error) {
        console.error('Failed to create WebSocket:', error);
        if (callback) callback(false);

        if (isReconnect) {
            attemptReconnect();
        }
    }
}