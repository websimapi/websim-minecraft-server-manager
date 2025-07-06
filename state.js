let state = {
    isConnected: false,
    serverStatus: 'offline',
    autoScroll: true,
    players: [],
    reconnectAttempts: 0,
    /* @tweakable Default setting for auto-reconnecting the WebSocket on first visit. */
    autoReconnect: false,
};

/* @tweakable The key used for storing client settings in localStorage. */
const SETTINGS_STORAGE_KEY = 'mcManagerClientSettings';

export function get() {
    return state;
}

export function set(newState) {
    state = { ...state, ...newState };
}

export function setConnected(status) {
    state.isConnected = status;
}

export function setServerStatus(status) {
    state.serverStatus = status;
}

export function setPlayers(players) {
    state.players = players;
}

export function toggleAutoScroll() {
    state.autoScroll = !state.autoScroll;
    return state.autoScroll;
}

export function resetReconnectAttempts() {
    state.reconnectAttempts = 0;
}

export function incrementReconnectAttempts() {
    state.reconnectAttempts++;
}

export function setAutoReconnect(enabled) {
    state.autoReconnect = enabled;
    saveClientSettings();
}

export function saveClientSettings() {
    const settingsToSave = {
        autoReconnect: state.autoReconnect,
    };
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settingsToSave));
    } catch (e) {
        console.error("Failed to save client settings to localStorage", e);
    }
}

export function loadClientSettings() {
    try {
        const savedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (savedSettings) {
            const parsed = JSON.parse(savedSettings);
            state.autoReconnect = parsed.autoReconnect ?? state.autoReconnect;
        }
    } catch (e) {
        console.error("Failed to load client settings from localStorage", e);
    }
}