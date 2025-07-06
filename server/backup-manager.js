const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { backupCompressionLevel } = require('./config.js');

/**
 * Creates a zip backup of the Minecraft server directory.
 * @param {object} config - The server configuration.
 * @param {function} broadcastCallback - Callback to send messages to the client.
 * @returns {Promise<string>} A promise that resolves with the backup filename.
 */
function createBackup(config, broadcastCallback) {
    return new Promise((resolve, reject) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFilename = `backup-${timestamp}.zip`;
        const backupPath = path.join(config.backupsDir, backupFilename);
        if (!fs.existsSync(config.backupsDir)) {
            fs.mkdirSync(config.backupsDir, { recursive: true });
        }
        const output = fs.createWriteStream(backupPath);
        const archive = archiver('zip', { zlib: { level: backupCompressionLevel } });
        
        output.on('close', () => {
            broadcastCallback({ type: 'notification', message: `Backup created: ${backupFilename}`, level: 'success' });
            resolve(backupFilename);
        });

        archive.on('error', (err) => {
            broadcastCallback({ type: 'error', message: `Backup failed: ${err.message}` });
            reject(err);
        });

        archive.pipe(output);

        /* @tweakable An array of file/folder patterns to ignore when creating a backup. */
        const ignorePatterns = [
            'node_modules/**', 
            '.git/**',
            'cache/**'
        ];

        // Add server directory contents to the archive, ignoring specified patterns.
        archive.glob('**', {
            cwd: config.minecraftDir,
            ignore: ignorePatterns
        });
        
        archive.finalize();
    });
}

module.exports = { createBackup };