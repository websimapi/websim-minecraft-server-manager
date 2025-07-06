const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');

class ConfigManager {
    constructor(broadcastCallback, initialConfig) {
        this.broadcast = broadcastCallback;
        this.config = initialConfig;
    }

    loadConfig() {
        if (fs.existsSync(configPath)) {
            try {
                const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                this.config = { ...this.config, ...savedConfig };
            } catch (e) {
                console.error("Error reading saved config.json, using defaults.", e);
            }
        }
        return this.config;
    }

    updateSettings(newSettings) {
        this.config = { ...this.config, ...newSettings };
        try {
            fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2));
            this.broadcast({ type: 'notification', message: 'Settings updated successfully. A restart is required for some changes to take effect.', level: 'success' });
        } catch (error) {
            this.broadcast({ type: 'error', message: `Failed to save settings: ${error.message}` });
        }
        
        if (newSettings.port || newSettings.maxPlayers) {
            this.updateServerProperties({ port: newSettings.port, maxPlayers: newSettings.maxPlayers });
        }
        return this.config;
    }
    
    updateServerProperties(settings) {
        const serverPropsPath = path.join(this.config.minecraftDir, 'server.properties');
        if (fs.existsSync(serverPropsPath)) {
            let content = fs.readFileSync(serverPropsPath, 'utf8');
            if (settings.port) {
                content = content.replace(/server-port=\d*/, `server-port=${settings.port}`);
            }
            if (settings.maxPlayers) {
                content = content.replace(/max-players=\d*/, `max-players=${settings.maxPlayers}`);
            }
            fs.writeFileSync(serverPropsPath, content);
        }
    }

    configureGeyser() {
        if (!this.config.enableGeyser || !this.config.enableFloodgate) return;

        const geyserConfigPath = path.join(this.config.minecraftDir, 'plugins', 'Geyser-Spigot', 'config.yml');

        if (!fs.existsSync(geyserConfigPath)) {
            this.broadcast({ type: 'notification', message: 'Geyser config not found. Waiting for it to be generated.', level: 'warning' });
            return;
        }

        try {
            let configContent = fs.readFileSync(geyserConfigPath, 'utf8');
            const targetAuthType = 'floodgate';
            const authTypeRegex = /auth-type:\s*\w+/;

            if (configContent.match(/auth-type:\s*floodgate/)) {
                return; // Already configured
            }

            if (authTypeRegex.test(configContent)) {
                configContent = configContent.replace(authTypeRegex, `auth-type: ${targetAuthType}`);
            } else {
                this.broadcast({ type: 'error', message: 'Could not find "auth-type" in Geyser config.' });
                return;
            }

            fs.writeFileSync(geyserConfigPath, configContent, 'utf8');
            this.broadcast({ type: 'notification', message: 'Geyser config updated for Floodgate. A server restart is recommended.', level: 'success' });

        } catch (error) {
            console.error(`Failed to configure Geyser: ${error}`);
            this.broadcast({ type: 'error', message: `Failed to auto-configure Geyser: ${error.message}` });
        }
    }
}

module.exports = ConfigManager;

