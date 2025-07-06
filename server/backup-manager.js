const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

/* @tweakable Format for backup filenames. Use {timestamp} for the date. */
const backupFilenameFormat = 'backup-{timestamp}.zip';

/* @tweakable List of files/folders to ignore during backup. Wildcards are supported. */
const backupIgnoreList = ['node_modules/**'];

async function createBackup(config, broadcast) {
    return new Promise((resolve, reject) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFilename = backupFilenameFormat.replace('{timestamp}', timestamp);
        const backupPath = path.join(config.backupsDir, backupFilename);

        if (!fs.existsSync(config.backupsDir)) {
            fs.mkdirSync(config.backupsDir, { recursive: true });
        }

        broadcast({ type: 'notification', message: `Creating backup: ${backupFilename}...`, level: 'info' });

        const output = fs.createWriteStream(backupPath);
        const archive = archiver('zip', { zlib: { level: config.backupCompressionLevel } });

        output.on('close', () => {
            broadcast({ type: 'notification', message: `Backup created: ${backupFilename}`, level: 'success' });
            resolve(backupFilename);
        });

        archive.on('error', (err) => {
            broadcast({ type: 'error', message: `Backup failed: ${err.message}` });
            reject(err);
        });

        archive.pipe(output);
        
        archive.glob('**', {
            cwd: config.minecraftDir,
            ignore: backupIgnoreList
        });
        
        archive.finalize();
    });
}

module.exports = { createBackup };