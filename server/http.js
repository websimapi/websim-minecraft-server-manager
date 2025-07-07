const express = require('express');
const path = require('path');
const fs = require('fs');

function setupExpress(serverInstance) {
    const app = serverInstance.app;
    app.use(express.json());
    app.use(express.static(path.join(__dirname, '..')));

    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'index.html'));
    });

    app.get('/api/status', (req, res) => {
        res.json({
            status: serverInstance.minecraft.serverStatus,
            stats: serverInstance.minecraft.stats,
            players: serverInstance.minecraft.players
        });
    });

    app.post('/api/upload', (req, res) => {
        // TODO: Handle file upload
        res.json({ success: true, message: 'File uploaded successfully' });
    });

    app.post('/api/backup', (req, res) => {
        serverInstance.minecraft.createBackup()
            .then(filename => {
                res.json({ success: true, filename });
            })
            .catch(error => {
                res.status(500).json({ success: false, error: error.message });
            });
    });

    app.get('/api/download-bridge', (req, res) => {
        res.status(400).json({
            success: false,
            message: 'This endpoint is deprecated. Bridge download is now handled client-side.'
        });
    });

    // GET server.properties as JSON
    app.get('/api/server-properties', (req, res) => {
        const filePath = path.join(serverInstance.config.minecraftDir, 'server.properties');
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            const properties = {};
            data.split(/\r?\n/).forEach(line => {
                if (line && !line.trim().startsWith('#')) {
                    const idx = line.indexOf('=');
                    if (idx > -1) {
                        const key = line.substring(0, idx);
                        const value = line.substring(idx + 1);
                        properties[key] = value;
                    }
                }
            });
            res.json({ success: true, properties });
        });
    });

    // POST update server.properties from JSON
    app.post('/api/server-properties', (req, res) => {
        const newProps = req.body.properties;
        if (!newProps) return res.status(400).json({ success: false, error: 'No properties provided' });
        const filePath = path.join(serverInstance.config.minecraftDir, 'server.properties');
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            const lines = data.split(/\r?\n/);
            Object.entries(newProps).forEach(([key, value]) => {
                const idx = lines.findIndex(l => l.startsWith(key + '='));
                if (idx > -1) {
                    lines[idx] = `${key}=${value}`;
                } else {
                    lines.push(`${key}=${value}`);
                }
            });
            fs.writeFile(filePath, lines.join('\n'), 'utf8', err2 => {
                if (err2) return res.status(500).json({ success: false, error: err2.message });
                res.json({ success: true });
            });
        });
    });
}

module.exports = { setupExpress };