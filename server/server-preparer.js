const fs = require('fs');
const path = require('path');
const downloader = require('./downloader');
const { geyserServerType } = require('./config.js');

async function prepareJavaServer(config, broadcastCallback) {
    const serverJarPath = path.join(config.minecraftDir, config.serverJar);
    let newJarName = config.serverJar;

    if (config.enableGeyser) {
        broadcastCallback({ type: 'notification', message: `Geyser requires a plugin-compatible server. Preparing ${geyserServerType}...`, level: 'info' });
        if (!fs.existsSync(serverJarPath) || !config.serverJar.toLowerCase().includes(geyserServerType.toLowerCase())) {
            if (geyserServerType === 'paper') {
                newJarName = await downloader.downloadPaperServer(config, broadcastCallback);
            } else {
                newJarName = await downloader.downloadVanillaServer(config, broadcastCallback); // Fallback
            }
        }
        await preparePlugins(config, broadcastCallback);
    } else {
        broadcastCallback({ type: 'notification', message: 'Preparing vanilla server...', level: 'info' });
        if (!fs.existsSync(serverJarPath) || config.serverJar.toLowerCase().includes('paper')) {
            newJarName = await downloader.downloadVanillaServer(config, broadcastCallback);
        }
    }
    return newJarName;
}

async function preparePlugins(config, broadcastCallback) {
    const pluginsDir = path.join(config.minecraftDir, 'plugins');
    if (!fs.existsSync(pluginsDir)) {
        fs.mkdirSync(pluginsDir, { recursive: true });
    }

    if (config.enableGeyser) {
        await downloader.downloadGeyserPlugin(config, broadcastCallback);
        if (config.enableFloodgate) {
            await downloader.downloadFloodgatePlugin(config, broadcastCallback);
        }
    }
}

async function prepareServer(config, broadcastCallback) {
    if (config.serverType === 'java') {
        const newJarName = await prepareJavaServer(config, broadcastCallback);
        return newJarName;
    } else if (config.serverType === 'bedrock') {
        await downloader.downloadBedrockServer(broadcastCallback);
        return config.bedrockServerExecutable;
    } else {
        throw new Error(`Unsupported server type: ${config.serverType}`);
    }
}

module.exports = { prepareServer };

