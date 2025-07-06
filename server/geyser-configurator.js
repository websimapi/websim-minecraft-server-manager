const fs = require('fs');
const path = require('path');

/**
 * @tweakable The auth type to set in Geyser's config. Should be 'floodgate' for Bedrock account support.
 */
const geyserAuthType = 'floodgate';

/**
 * @description Automatically configures Geyser's config.yml to use Floodgate.
 * This is called after the server has started to ensure the config file exists.
 * @param {object} config The server configuration.
 * @param {function} broadcastCallback Callback to send messages to the client.
 */
function configureGeyser(config, broadcastCallback) {
    const geyserConfigPath = path.join(config.minecraftDir, 'plugins', 'Geyser-Spigot', 'config.yml');

    if (!fs.existsSync(geyserConfigPath)) {
        broadcastCallback({
            type: 'notification',
            message: 'Geyser config not found. Waiting for it to be generated.',
            level: 'warning'
        });
        return;
    }

    try {
        let configContent = fs.readFileSync(geyserConfigPath, 'utf8');

        const authTypeRegex = /auth-type:\s*(\w+)/;
        const currentAuthType = configContent.match(authTypeRegex)?.[1];
        
        if (currentAuthType === geyserAuthType) {
            // Already configured, no action needed.
            return;
        }

        if (authTypeRegex.test(configContent)) {
            configContent = configContent.replace(authTypeRegex, `auth-type: ${geyserAuthType}`);
        } else {
            // This case is unlikely if Geyser generated a valid default config.
            broadcastCallback({
                type: 'error',
                message: 'Could not find "auth-type" in Geyser config.'
            });
            return;
        }

        fs.writeFileSync(geyserConfigPath, configContent, 'utf8');
        broadcastCallback({
            type: 'notification',
            message: 'Geyser config updated for Floodgate. A server restart is recommended.',
            level: 'success'
        });

    } catch (error) {
        console.error(`Failed to configure Geyser: ${error}`);
        broadcastCallback({
            type: 'error',
            message: `Failed to auto-configure Geyser: ${error.message}`
        });
    }
}

module.exports = { configureGeyser };