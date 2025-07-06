const fs   = require('fs');
const path = require('path');

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
        // trigger TPS file‐based analysis when profiling stops
        if (line.includes('Debug profiling stopped')) {
            this.analyzeTPS();
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

/**
 * Read debug-profiling.txt and estimate TPS from average ms-per-tick.
 */
module.exports.analyzeTPS = function() {
    const profilePath = path.join(this.config.minecraftDir, 'debug-profiling.txt');
    if (!fs.existsSync(profilePath)) {
        this.broadcast({ type: 'notification', message: 'No debug-profiling.txt found for TPS analysis.', level: 'warning' });
        return;
    }
    try {
        const content = fs.readFileSync(profilePath, 'utf8');
        const msMatches = content.match(/([\d.]+)\s*ms/g);
        if (!msMatches || !msMatches.length) {
            this.broadcast({ type: 'notification', message: 'No timing data found in debug-profiling.txt.', level: 'error' });
            return;
        }
        const values = msMatches.map(m => parseFloat(m));
        const avgMs  = values.reduce((a,b) => a + b, 0) / values.length;
        const tps    = (1000 / avgMs).toFixed(2);
        this.stats.tps = tps;
        this.broadcast({ type: 'status', online: this.serverStatus === 'online', stats: this.stats });
        this.broadcast({ type: 'notification', message: `TPS analysis complete: ${tps}`, level: 'success' });
    } catch (err) {
        this.broadcast({ type: 'notification', message: `Failed to analyze TPS: ${err.message}`, level: 'error' });
    }
};