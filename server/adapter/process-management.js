const { spawn } = require('child_process');
const fs         = require('fs');
const path       = require('path');
const pidusage   = require('pidusage');
const { disablePaperPluginRemapper } = require('../config.js');

module.exports.start = async function() {
    if (this.minecraftProcess) {
        this.broadcast({ type: 'notification', message: 'Server is already running', level: 'warning' });
        return;
    }

    let serverExecutablePath;
    let javaArgs = [];

    try {
        if (this.config.serverType === 'java') {
            await this.prepareJavaServer();
            serverExecutablePath = path.join(this.config.minecraftDir, this.config.serverJar);
            if (!fs.existsSync(serverExecutablePath)) {
                throw new Error(`Server JAR (${this.config.serverJar}) not found! Please check settings.`);
            }
            javaArgs = [`-Xmx${this.config.maxRam}`, `-Xms${this.config.maxRam}`];
            if (this.config.serverJar.toLowerCase().includes('paper') && disablePaperPluginRemapper) {
                javaArgs.push('-Dpaper.use-legacy-plugin-loading=true');
            }
            javaArgs.push('-jar', this.config.serverJar, 'nogui');
        } else if (this.config.serverType === 'bedrock') {
            serverExecutablePath = path.join(this.config.minecraftDir, this.config.bedrockServerExecutable);
            if (!fs.existsSync(serverExecutablePath)) {
                await this.downloadBedrockServer();
            }
        } else {
            throw new Error(`Unsupported server type: ${this.config.serverType}`);
        }
    } catch (error) {
        this.broadcast({ type: 'error', message: `Could not prepare server: ${error.message}` });
        return;
    }

    console.log('Starting Minecraft server...');
    this.minecraftProcess = spawn(
        this.config.serverType === 'java' ? this.config.javaPath : serverExecutablePath,
        this.config.serverType === 'java' ? javaArgs : [],
        { cwd: this.config.minecraftDir, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    this.setupProcessEventListeners();

    this.serverStatus = 'online';
    this.startTime   = Date.now();
    this.broadcast({ type: 'status', online: true, stats: this.stats, startTime: this.startTime });
    this.broadcast({ type: 'notification', message: 'Server started successfully', level: 'success' });

    if (this.config.enableGeyser) {
        setTimeout(() => this.configureGeyser(), 5000);
    }

    // Monitor memory usage periodically
    if (this.statsUpdater) clearInterval(this.statsUpdater);
    this.statsUpdater = setInterval(async () => {
        if (this.minecraftProcess && this.minecraftProcess.pid) {
            try {
                const usage = await pidusage(this.minecraftProcess.pid);
                this.stats.ram = `${(usage.memory / 1024 / 1024).toFixed(2)} MB`;
            } catch (err) {
                console.error('Failed to get process usage:', err);
            }
        }
    }, 5000);

    // Schedule debug profiling to measure TPS via console output parsing
    if (!this.debugInterval) {
        this.debugInterval = setInterval(() => {
            // Start the built-in server profiler
            this.sendCommand('debug start');
            // Stop profiling after 20 seconds
            this.debugTimeout = setTimeout(() => {
                this.sendCommand('debug stop');
                // No file reading needed; TPS is parsed from the console output
            }, 20000);
        }, 40000);
    }
};

module.exports.setupProcessEventListeners = function() {
    this.minecraftProcess.on('error', (err) => {
        console.error(`Failed to start server process: ${err.message}`);
        this.broadcast({ type: 'error', message: `Failed to start server: ${err.message}. Ensure Java is installed and in your PATH.` });
        this.minecraftProcess = null;
    });

    this.minecraftProcess.stdout.on('data', (data) => {
        const output = data.toString();
        this.parseServerOutput(output);
        this.broadcast({ type: 'console', message: output.trim() });
    });

    this.minecraftProcess.stderr.on('data', (data) => {
        const output = data.toString();
        this.broadcast({ type: 'console', message: `ERROR: ${output.trim()}` });
    });

    this.minecraftProcess.on('exit', (code) => {
        // Stop monitoring memory usage
        if (this.statsUpdater) {
            clearInterval(this.statsUpdater);
            this.statsUpdater = null;
        }

        // Stop debug profiling if running
        if (this.debugInterval) {
            clearInterval(this.debugInterval);
            this.debugInterval = null;
        }
        if (this.debugTimeout) {
            clearTimeout(this.debugTimeout);
            this.debugTimeout = null;
        }

        console.log(`Server process exited with code ${code}`);
        this.minecraftProcess = null;
        this.serverStatus = 'offline';
        this.startTime   = null;
        this.players     = [];
        this.updatePlayersList();
        this.broadcast({ type: 'status', online: false, stats: this.stats, startTime: this.startTime });
        this.broadcast({ type: 'notification', message: 'Server stopped', level: 'info' });
    });
};

module.exports.stop = function() {
    if (!this.minecraftProcess) {
        this.broadcast({ type: 'notification', message: 'Server is not running', level: 'warning' });
        return;
    }
    this.sendCommand('stop');
    setTimeout(() => {
        if (this.minecraftProcess) this.minecraftProcess.kill('SIGKILL');
    }, 10000);
};

module.exports.restart = function() {
    if (this.minecraftProcess) {
        this.broadcast({ type: 'notification', message: 'Restarting server...', level: 'info' });
        this.minecraftProcess.once('exit', () => {
            setTimeout(() => this.start(), 2000);
        });
        this.stop();
    } else {
        this.start();
    }
};

module.exports.sendCommand = function(command) {
    if (!this.minecraftProcess) {
        this.broadcast({ type: 'notification', message: 'Server is not running', level: 'warning' });
        return;
    }
    this.minecraftProcess.stdin.write(`${command}\n`);
};