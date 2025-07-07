const { serverConfig, downloadConfig, backupCompressionLevel, geyserServerType, disablePaperPluginRemapper } = require('./config.js');
const processManagement = require('./adapter/process-management.js');
const parser           = require('./adapter/parser.js');
const downloader       = require('./adapter/downloader.js');
const backupManager    = require('./adapter/backup.js');
const preparer         = require('./adapter/preparation.js');
const settingsManager  = require('./adapter/settings.js');

class MinecraftAdapter {
    constructor(broadcastCallback) {
        this.broadcast       = broadcastCallback;
        this.config          = serverConfig;
        this.downloadConfig  = downloadConfig;
        this.minecraftProcess= null;
        this.serverStatus    = 'offline';
        this.players         = [];
        this.stats           = {
            players: 0,
            uptime:  '00:00:00',
            ram:     '0 MB',
            tps:     '20.0',
            version: 'Unknown'
        };
        this.startTime       = null;
        this.parseAndSetServerVersion();
    }

    parseAndSetServerVersion() {
        const jarName = this.config.serverJar;
        if (!jarName || jarName === 'server.jar') {
            this.stats.version = 'Unknown';
            return;
        }

        let version = 'Unknown';
        // e.g., vanilla-1.20.4.jar
        let match = jarName.match(/vanilla-([\d\.]+)\.jar/i);
        if (match) {
            version = match[1];
        }

        // e.g., paper-1.20.4-550.jar
        if (!match) {
            match = jarName.match(/paper-([\d\.]+)/i);
            if (match) version = match[1];
        }

        // more generic server jar version parsing
        if (version === 'Unknown') {
            match = jarName.match(/(\d+\.\d+(\.\d+)?)/);
            if (match) version = match[1];
        }

        this.stats.version = version;
    }
}

Object.assign(
    MinecraftAdapter.prototype,
    processManagement,
    parser,
    downloader,
    backupManager,
    preparer,
    settingsManager
);

module.exports = MinecraftAdapter;