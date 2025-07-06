const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
const fetch = require('node-fetch');

const { downloadConfig } = require('./config');

/**
 * @tweakable A wrapper for fetch that includes a User-Agent to prevent blocking from some services.
 */
const customFetch = (url, options) => {
    return fetch(url, {
        headers: { 'User-Agent': 'mc-manager/1.0' },
        redirect: 'follow',
        ...options
    });
};

async function downloadFile(url, dest, broadcastCallback) {
    broadcastCallback({ type: 'notification', message: `Downloading ${path.basename(dest)}...`, level: 'info' });
    try {
        const response = await customFetch(url);
        if (!response.ok) {
            throw new Error(`Failed to download file: Status Code ${response.status} ${response.statusText}`);
        }
        const fileStream = fs.createWriteStream(dest);
        const streamPipeline = promisify(pipeline);
        await streamPipeline(response.body, fileStream);
        broadcastCallback({ type: 'notification', message: `Successfully downloaded ${path.basename(dest)}.`, level: 'success' });
        return dest;
    } catch (error) {
        broadcastCallback({ type: 'error', message: `Download failed for ${path.basename(dest)}: ${error.message}` });
        if (fs.existsSync(dest)) {
            fs.unlinkSync(dest); // Clean up partial file
        }
        throw error;
    }
}

async function downloadVanillaServer(config, broadcastCallback) {
    try {
        broadcastCallback({ type: 'notification', message: 'Downloading latest Vanilla Java server...', level: 'info' });
        const manifestResponse = await customFetch(downloadConfig.java.versionManifestUrl);
        const manifest = await manifestResponse.json();
        const latestVersionId = manifest.latest[downloadConfig.java.latestVersionType];
        const versionData = manifest.versions.find(v => v.id === latestVersionId);
        if (!versionData) throw new Error(`Could not find version data for ${latestVersionId}`);
        const versionResponse = await customFetch(versionData.url);
        const versionDetails = await versionResponse.json();
        const serverDownloadUrl = versionDetails.downloads.server.url;
        if (!serverDownloadUrl) throw new Error('Could not find server download URL in version details.');
        
        const newServerJar = `vanilla-${latestVersionId}.jar`;
        const serverJarPath = path.join(config.minecraftDir, newServerJar);

        await downloadFile(serverDownloadUrl, serverJarPath, broadcastCallback);
        broadcastCallback({ type: 'notification', message: `Downloaded ${newServerJar} successfully.`, level: 'success' });
        return newServerJar;
    } catch (error) {
        console.error('Failed to download Vanilla Java server:', error);
        broadcastCallback({ type: 'error', message: `Failed to download Vanilla Java server: ${error.message}` });
        throw error;
    }
}

async function downloadPaperServer(config, broadcastCallback) {
    try {
        broadcastCallback({ type: 'notification', message: 'Downloading latest PaperMC server...', level: 'info' });
        const projectUrl = downloadConfig.paper.apiUrl;
        const versionsResponse = await customFetch(projectUrl);
        const versionsData = await versionsResponse.json();
        const latestVersion = versionsData.versions[versionsData.versions.length - 1];

        const buildsResponse = await customFetch(`${projectUrl}/versions/${latestVersion}`);
        const buildsData = await buildsResponse.json();
        const latestBuild = buildsData.builds[buildsData.builds.length - 1];

        const jarName = `paper-${latestVersion}-${latestBuild}.jar`;
        const downloadUrl = `${projectUrl}/versions/${latestVersion}/builds/${latestBuild}/downloads/${jarName}`;
        
        const serverJarPath = path.join(config.minecraftDir, jarName);
        
        await downloadFile(downloadUrl, serverJarPath, broadcastCallback);
        return jarName;
    } catch (error) {
        console.error('Failed to download PaperMC server:', error);
        broadcastCallback({ type: 'error', message: `Failed to download PaperMC server: ${error.message}` });
        throw error;
    }
}

async function downloadGeyserPlugin(config, broadcastCallback) {
    const pluginsDir = path.join(config.minecraftDir, 'plugins');
    const geyserJarPath = path.join(pluginsDir, downloadConfig.geyser.filename);
    if (fs.existsSync(geyserJarPath)) {
        return;
    }
    try {
        await downloadFile(downloadConfig.geyser.downloadUrl, geyserJarPath, broadcastCallback);
    } catch (error) {
        console.error('Failed to download Geyser plugin:', error);
        broadcastCallback({ type: 'error', message: `Failed to download Geyser: ${error.message}` });
    }
}

async function downloadFloodgatePlugin(config, broadcastCallback) {
    const pluginsDir = path.join(config.minecraftDir, 'plugins');
    const floodgateJarPath = path.join(pluginsDir, downloadConfig.floodgate.filename);
    if (fs.existsSync(floodgateJarPath)) {
        return;
    }
    try {
        await downloadFile(downloadConfig.floodgate.downloadUrl, floodgateJarPath, broadcastCallback);
    } catch (error) {
        console.error('Failed to download Floodgate plugin:', error);
        broadcastCallback({ type: 'error', message: `Failed to download Floodgate: ${error.message}` });
    }
}

async function downloadBedrockServer(broadcastCallback) {
    broadcastCallback({ type: 'notification', message: 'Bedrock server download is not implemented yet.', level: 'warning' });
    throw new Error('Bedrock server download is not implemented.');
}

module.exports = {
    downloadFile,
    downloadVanillaServer,
    downloadPaperServer,
    downloadGeyserPlugin,
    downloadFloodgatePlugin,
    downloadBedrockServer,
};