const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
const fetch = require('node-fetch');
const { downloadConfig, geyserServerType } = require('./config.js');

async function downloadFile(url, dest, broadcast) {
    broadcast({ type: 'notification', message: `Downloading ${path.basename(dest)}...`, level: 'info' });
    try {
        const response = await fetch(url, { redirect: 'follow' });
        if (!response.ok) {
            throw new Error(`Failed to download file: Status Code ${response.status} ${response.statusText}`);
        }
        const fileStream = fs.createWriteStream(dest);
        const streamPipeline = promisify(pipeline);
        await streamPipeline(response.body, fileStream);
        broadcast({ type: 'notification', message: `Successfully downloaded ${path.basename(dest)}.`, level: 'success' });
        return dest;
    } catch (error) {
        broadcast({ type: 'error', message: `Download failed for ${path.basename(dest)}: ${error.message}` });
        if (fs.existsSync(dest)) {
            fs.unlinkSync(dest); // Clean up partial file
        }
        throw error;
    }
}

async function downloadVanillaServer(config, broadcast) {
    try {
        broadcast({ type: 'notification', message: 'Downloading latest Vanilla Java server...', level: 'info' });
        const manifestResponse = await fetch(downloadConfig.java.versionManifestUrl);
        const manifest = await manifestResponse.json();
        const latestVersionId = manifest.latest[downloadConfig.java.latestVersionType];
        const versionData = manifest.versions.find(v => v.id === latestVersionId);
        if (!versionData) throw new Error(`Could not find version data for ${latestVersionId}`);
        const versionResponse = await fetch(versionData.url);
        const versionDetails = await versionResponse.json();
        const serverDownloadUrl = versionDetails.downloads.server.url;
        if (!serverDownloadUrl) throw new Error('Could not find server download URL in version details.');
        
        config.serverJar = `vanilla-${latestVersionId}.jar`;
        const serverJarPath = path.join(config.minecraftDir, config.serverJar);

        await downloadFile(serverDownloadUrl, serverJarPath, broadcast);
        broadcast({ type: 'notification', message: `Downloaded ${config.serverJar} successfully.`, level: 'success' });
        return serverJarPath;
    } catch (error) {
        console.error('Failed to download Vanilla Java server:', error);
        broadcast({ type: 'error', message: `Failed to download Vanilla Java server: ${error.message}` });
        throw error;
    }
}

async function downloadPaperServer(config, broadcast) {
    try {
        broadcast({ type: 'notification', message: 'Downloading latest PaperMC server...', level: 'info' });
        const projectUrl = downloadConfig.paper.apiUrl;
        const versionsResponse = await fetch(projectUrl);
        const versionsData = await versionsResponse.json();
        const latestVersion = versionsData.versions[versionsData.versions.length - 1];

        const buildsResponse = await fetch(`${projectUrl}/versions/${latestVersion}`);
        const buildsData = await buildsResponse.json();
        const latestBuild = buildsData.builds[buildsData.builds.length - 1];

        const jarName = `paper-${latestVersion}-${latestBuild}.jar`;
        const downloadUrl = `${projectUrl}/versions/${latestVersion}/builds/${latestBuild}/downloads/${jarName}`;
        
        config.serverJar = jarName;
        const serverJarPath = path.join(config.minecraftDir, config.serverJar);
        
        await downloadFile(downloadUrl, serverJarPath, broadcast);
        return serverJarPath;
    } catch (error) {
        console.error('Failed to download PaperMC server:', error);
        broadcast({ type: 'error', message: `Failed to download PaperMC server: ${error.message}` });
        throw error;
    }
}

async function downloadGeyserPlugin(config, broadcast) {
    const pluginsDir = path.join(config.minecraftDir, 'plugins');
    const geyserJarPath = path.join(pluginsDir, downloadConfig.geyser.filename);
    if (fs.existsSync(geyserJarPath)) return;
    try {
        await downloadFile(downloadConfig.geyser.downloadUrl, geyserJarPath, broadcast);
    } catch (error) {
        console.error('Failed to download Geyser plugin:', error);
        broadcast({ type: 'error', message: `Failed to download Geyser: ${error.message}` });
    }
}

async function downloadFloodgatePlugin(config, broadcast) {
    const pluginsDir = path.join(config.minecraftDir, 'plugins');
    const floodgateJarPath = path.join(pluginsDir, downloadConfig.floodgate.filename);
    if (fs.existsSync(floodgateJarPath)) return;
    try {
        await downloadFile(downloadConfig.floodgate.downloadUrl, floodgateJarPath, broadcast);
    } catch (error) {
        console.error('Failed to download Floodgate plugin:', error);
        broadcast({ type: 'error', message: `Failed to download Floodgate: ${error.message}` });
    }
}

async function preparePlugins(config, broadcast) {
    const pluginsDir = path.join(config.minecraftDir, 'plugins');
    if (!fs.existsSync(pluginsDir)) {
        fs.mkdirSync(pluginsDir, { recursive: true });
    }

    if (config.enableGeyser) {
        await downloadGeyserPlugin(config, broadcast);
        if (config.enableFloodgate) {
            await downloadFloodgatePlugin(config, broadcast);
        }
    }
}

async function prepareJavaServer(config, broadcast) {
    const serverJarPath = path.join(config.minecraftDir, config.serverJar);
    if (config.enableGeyser) {
        broadcast({ type: 'notification', message: `Geyser requires a plugin-compatible server. Preparing ${geyserServerType}...`, level: 'info' });
        if (!fs.existsSync(serverJarPath) || !config.serverJar.toLowerCase().includes(geyserServerType.toLowerCase())) {
            if (geyserServerType === 'paper') {
                await downloadPaperServer(config, broadcast);
            } else {
                await downloadVanillaServer(config, broadcast); // Fallback
            }
        }
        await preparePlugins(config, broadcast);
    } else {
        broadcast({ type: 'notification', message: 'Preparing vanilla server...', level: 'info' });
        if (!fs.existsSync(serverJarPath) || config.serverJar.toLowerCase().includes('paper')) {
            await downloadVanillaServer(config, broadcast);
        }
    }
}

module.exports = {
    downloadFile,
    downloadVanillaServer,
    downloadPaperServer,
    downloadGeyserPlugin,
    downloadFloodgatePlugin,
    preparePlugins,
    prepareJavaServer
};