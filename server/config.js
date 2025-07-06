const path = require('path');

/* @tweakable server configuration */
const serverConfig = {
    port: 3001,
    minecraftDir: path.join(__dirname, '..', 'minecraft'),
    backupsDir: path.join(__dirname, '..', 'backups'),
    javaPath: 'java',
    serverJar: 'server.jar',
    bedrockServerExecutable: 'bedrock_server',
    maxRam: '2G',
    serverType: 'java', // 'java' or 'bedrock'
    autoStart: false
};

/* @tweakable Minecraft server download URLs and settings */
const downloadConfig = {
    java: {
        versionManifestUrl: 'https://launchermeta.mojang.com/mc/game/version_manifest.json',
        latestVersionType: 'release' // 'release' or 'snapshot'
    },
    bedrock: {
        downloadPageUrl: 'https://www.minecraft.net/en-us/download/server/bedrock',
        downloadLinkRegex: /https:\/\/minecraft\.azureedge\.net\/bin-linux\/bedrock-server-([\d\.]+)\.zip/
    }
};

/** @tweakable The compression level for zip backups (0-9). 9 is highest compression. */
const backupCompressionLevel = 9;


module.exports = {
    serverConfig,
    downloadConfig,
    backupCompressionLevel
};