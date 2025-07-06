let state = {
    isConnected: false,
    serverStatus: 'offline',
    autoScroll: true,
    players: [],
    reconnectAttempts: 0,
};

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

