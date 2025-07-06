const path = require('path');
const fs = require('fs');

/* @tweakable server configuration */
let serverConfig = {
    port: 3001,
    minecraftDir: path.join(__dirname, '..', 'minecraft'),
    backupsDir: path.join(__dirname, '..', 'backups'),
    javaPath: 'java',
    serverJar: 'server.jar',
    bedrockServerExecutable: 'bedrock_server',
    maxRam: '2G',
    serverType: 'java', // 'java' or 'bedrock'
    autoStart: false,
    /* @tweakable Enable Geyser to allow Bedrock clients to connect */
    enableGeyser: false,
    /* @tweakable Enable Floodgate to allow Bedrock clients without a Java account */
    enableFloodgate: false
};

const configPath = path.join(__dirname, 'config.json');
if (fs.existsSync(configPath)) {
    try {
        const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        serverConfig = { ...serverConfig, ...savedConfig };
    } catch (e) {
        console.error("Error reading saved config.json, using defaults.", e);
    }
}

/* @tweakable Minecraft server download URLs and settings */
const downloadConfig = {
    java: {
        versionManifestUrl: 'https://launchermeta.mojang.com/mc/game/version_manifest.json',
        latestVersionType: 'release' // 'release' or 'snapshot'
    },
    bedrock: {
        downloadPageUrl: 'https://www.minecraft.net/en-us/download/server/bedrock',
        downloadLinkRegex: /https:\/\/minecraft\.azureedge\.net\/bin-linux\/bedrock-server-([\d\.]+)\.zip/
    },
    /* @tweakable PaperMC download API settings */
    paper: {
        apiUrl: 'https://api.papermc.io/v2/projects/paper',
    },
    /* @tweakable Geyser download settings */
    geyser: {
        downloadUrl: 'https://ci.geysermc.org/job/GeyserMC/job/Geyser/job/master/lastSuccessfulBuild/artifact/bootstrap/spigot/target/Geyser-Spigot.jar'
    },
    /* @tweakable Floodgate download settings */
    floodgate: {
        downloadUrl: 'https://ci.geysermc.org/job/GeyserMC/job/Floodgate/job/master/lastSuccessfulBuild/artifact/spigot/target/floodgate-spigot.jar'
    }
};

/** @tweakable The server software to use when Geyser is enabled. Must be 'paper' to support plugins. */
const geyserServerType = 'paper';

/** @tweakable The compression level for zip backups (0-9). 9 is highest compression. */
const backupCompressionLevel = 1; // Lowered for performance, 9 can be very slow

module.exports = {
    serverConfig,
    downloadConfig,
    backupCompressionLevel,
    geyserServerType
};