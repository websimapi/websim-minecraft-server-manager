const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
const fetch = require('node-fetch');

class Downloader {
    constructor(broadcastCallback, downloadConfig) {
        this.broadcast = broadcastCallback;
        this.downloadConfig = downloadConfig;
    }

    updateDownloadConfig(newConfig) {
        this.downloadConfig = newConfig;
    }

    async downloadFile(url, dest) {
        this.broadcast({ type: 'notification', message: `Downloading ${path.basename(dest)}...`, level: 'info' });
        try {
            const response = await fetch(url, { redirect: 'follow' });
            if (!response.ok) {
                throw new Error(`Failed to download file: Status Code ${response.status} ${response.statusText}`);
            }
            const fileStream = fs.createWriteStream(dest);
            const streamPipeline = promisify(pipeline);
            await streamPipeline(response.body, fileStream);
            this.broadcast({ type: 'notification', message: `Successfully downloaded ${path.basename(dest)}.`, level: 'success' });
            return dest;
        } catch (error) {
            this.broadcast({ type: 'error', message: `Download failed for ${path.basename(dest)}: ${error.message}` });
            if (fs.existsSync(dest)) {
                fs.unlinkSync(dest); // Clean up partial file
            }
            throw error;
        }
    }

    async downloadVanillaServer(minecraftDir) {
        try {
            this.broadcast({ type: 'notification', message: 'Downloading latest Vanilla Java server...', level: 'info' });
            const manifestResponse = await fetch(this.downloadConfig.java.versionManifestUrl);
            const manifest = await manifestResponse.json();
            const latestVersionId = manifest.latest[this.downloadConfig.java.latestVersionType];
            const versionData = manifest.versions.find(v => v.id === latestVersionId);
            if (!versionData) throw new Error(`Could not find version data for ${latestVersionId}`);
            
            const versionResponse = await fetch(versionData.url);
            const versionDetails = await versionResponse.json();
            const serverDownloadUrl = versionDetails.downloads.server.url;
            if (!serverDownloadUrl) throw new Error('Could not find server download URL in version details.');
            
            const serverJarName = `vanilla-${latestVersionId}.jar`;
            const serverJarPath = path.join(minecraftDir, serverJarName);

            await this.downloadFile(serverDownloadUrl, serverJarPath);
            return serverJarPath;
        } catch (error) {
            console.error('Failed to download Vanilla Java server:', error);
            this.broadcast({ type: 'error', message: `Failed to download Vanilla Java server: ${error.message}` });
            throw error;
        }
    }

    async downloadPaperServer(minecraftDir) {
        try {
            this.broadcast({ type: 'notification', message: 'Downloading latest PaperMC server...', level: 'info' });
            const projectUrl = this.downloadConfig.paper.apiUrl;
            const versionsResponse = await fetch(projectUrl);
            const versionsData = await versionsResponse.json();
            const latestVersion = versionsData.versions[versionsData.versions.length - 1];

            const buildsResponse = await fetch(`${projectUrl}/versions/${latestVersion}`);
            const buildsData = await buildsResponse.json();
            const latestBuild = buildsData.builds[buildsData.builds.length - 1];

            const jarName = `paper-${latestVersion}-${latestBuild}.jar`;
            const downloadUrl = `${projectUrl}/versions/${latestVersion}/builds/${latestBuild}/downloads/${jarName}`;
            
            const serverJarPath = path.join(minecraftDir, jarName);
            await this.downloadFile(downloadUrl, serverJarPath);
            return serverJarPath;
        } catch (error) {
            console.error('Failed to download PaperMC server:', error);
            this.broadcast({ type: 'error', message: `Failed to download PaperMC server: ${error.message}` });
            throw error;
        }
    }

    async downloadGeyserPlugin(pluginsDir) {
        const geyserJarPath = path.join(pluginsDir, this.downloadConfig.geyser.filename);
        if (fs.existsSync(geyserJarPath)) return;
        try {
            await this.downloadFile(this.downloadConfig.geyser.downloadUrl, geyserJarPath);
        } catch (error) {
            console.error('Failed to download Geyser plugin:', error);
            this.broadcast({ type: 'error', message: `Failed to download Geyser: ${error.message}` });
        }
    }

    async downloadFloodgatePlugin(pluginsDir) {
        const floodgateJarPath = path.join(pluginsDir, this.downloadConfig.floodgate.filename);
        if (fs.existsSync(floodgateJarPath)) return;
        try {
            await this.downloadFile(this.downloadConfig.floodgate.downloadUrl, floodgateJarPath);
        } catch (error) {
            console.error('Failed to download Floodgate plugin:', error);
            this.broadcast({ type: 'error', message: `Failed to download Floodgate: ${error.message}` });
        }
    }

    async downloadBedrockServer() {
        this.broadcast({ type: 'notification', message: 'Bedrock server download is not implemented yet.', level: 'warning' });
        throw new Error('Bedrock server download is not implemented.');
    }
}

module.exports = Downloader;