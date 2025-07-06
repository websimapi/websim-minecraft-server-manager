const fs = require('fs');
const path = require('path');

/**
 * Updates the server.properties file with new settings.
 * @param {string} minecraftDir - The path to the minecraft server directory.
 * @param {object} settings - The settings to update.
 */
function updateServerProperties(minecraftDir, settings) {
    const serverPropsPath = path.join(minecraftDir, 'server.properties');
    if (!fs.existsSync(serverPropsPath)) return;
    
    let content = fs.readFileSync(serverPropsPath, 'utf8');
    if (settings.port) {
        content = content.replace(/^server-port=.*$/m, `server-port=${settings.port}`);
    }
    if (settings.maxPlayers) {
        content = content.replace(/^max-players=.*$/m, `max-players=${settings.maxPlayers}`);
    }
    fs.writeFileSync(serverPropsPath, content);
}


/**
 * Updates the server configuration.
 * @param {object} currentConfig - The current server configuration.
 * @param {object} newSettings - The new settings from the client.
 * @param {function} broadcastCallback - Callback to send messages to the client.
 * @returns {object} The updated configuration object.
 */
function updateSettings(currentConfig, newSettings, broadcastCallback) {
    const configPath = path.join(__dirname, 'config.json');

    /* @tweakable A list of settings that require a server restart to take effect. */
    const restartRequiredKeys = ['serverType', 'port', 'maxRam', 'enableGeyser', 'enableFloodgate'];

    const newConfig = { ...currentConfig, ...newSettings };
    
    try {
        fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2));
        
        // Update server.properties if relevant settings changed
        if (newSettings.port || newSettings.maxPlayers) {
            updateServerProperties(newConfig.minecraftDir, newSettings);
        }

        const changedKeys = Object.keys(newSettings).filter(key => currentConfig[key] !== newSettings[key]);
        const needsRestart = changedKeys.some(key => restartRequiredKeys.includes(key));
        
        let message = 'Settings updated successfully.';
        if (needsRestart) {
            message += ' A server restart is required for some changes to take effect.';
        }

        broadcastCallback({ type: 'notification', message: message, level: 'success' });

    } catch (error) {
        console.error('Failed to save settings:', error);
        broadcastCallback({ type: 'error', message: 'Failed to save settings.' });
    }

    return newConfig;
}

module.exports = { updateSettings };