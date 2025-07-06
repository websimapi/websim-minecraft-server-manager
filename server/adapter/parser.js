module.exports.parseServerOutput = function(output) {
    const lines = output.split('\n');
    lines.forEach(line => {
        if (line.includes('joined the game')) {
            const playerName = line.match(/(\w+) joined the game/)?.[1];
            if (playerName && !this.players.find(p => p.name === playerName)) {
                this.players.push({ name: playerName, status: 'Online' });
                this.updatePlayersList();
            }
        } else if (line.includes('left the game')) {
            const playerName = line.match(/(\w+) left the game/)?.[1];
            if (playerName) {
                this.players = this.players.filter(p => p.name !== playerName);
                this.updatePlayersList();
            }
        }
        if (line.includes('Done') && line.includes('For help, type "help"')) {
            this.broadcast({ type: 'notification', message: 'Server fully loaded and ready', level: 'success' });
        }
        // Parse TPS metrics if present in console output
        if (line.includes('TPS from last')) {
            const match = line.match(/TPS from last 1m, 5m, 15m: ([\d\.]+)/);
            if (match) {
                this.stats.tps = match[1];
            }
        }
    });
    this.stats.players = this.players.length;
    if (this.startTime) {
        const uptime = Date.now() - this.startTime;
        this.stats.uptime = this.formatUptime(uptime);
    }
};

module.exports.updatePlayersList = function() {
    this.broadcast({ type: 'players', players: this.players });
};

module.exports.formatUptime = function(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours   = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
    const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
};