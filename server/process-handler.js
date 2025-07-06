const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { disablePaperPluginRemapper } = require('./config.js');

class ProcessHandler {
    constructor(config, { onData, onError, onExit }) {
        this.config = config;
        this.process = null;
        this.onDataCallback = onData;
        this.onErrorCallback = onError;
        this.onExitCallback = onExit;
    }

    isRunning() {
        return !!this.process;
    }

    spawn() {
        let serverExecutablePath;
        let execArgs = [];

        if (this.config.serverType === 'java') {
            serverExecutablePath = this.config.javaPath;
            const serverJarPath = path.join(this.config.minecraftDir, this.config.serverJar);
            if (!fs.existsSync(serverJarPath)) {
                console.error(`Server JAR not found: ${serverJarPath}`);
                return false;
            }
            execArgs = [`-Xmx${this.config.maxRam}`, `-Xms${this.config.maxRam}`];
            if (this.config.serverJar.toLowerCase().includes('paper') && disablePaperPluginRemapper) {
                execArgs.push('-Dpaper.use-legacy-plugin-loading=true');
            }
            execArgs.push('-jar', this.config.serverJar, 'nogui');
        } else { // bedrock
            serverExecutablePath = path.join(this.config.minecraftDir, this.config.bedrockServerExecutable);
            if (!fs.existsSync(serverExecutablePath)) {
                console.error(`Bedrock executable not found: ${serverExecutablePath}`);
                return false;
            }
        }

        this.process = spawn(serverExecutablePath, execArgs, {
            cwd: this.config.minecraftDir,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        this.setupEventListeners();
        return true;
    }

    setupEventListeners() {
        this.process.on('error', (err) => {
            console.error(`Failed to start server process: ${err.message}`);
            this.onErrorCallback(err.message);
            this.process = null;
        });

        this.process.stdout.on('data', this.onDataCallback);
        this.process.stderr.on('data', this.onErrorCallback);

        this.process.on('exit', (code) => {
            this.process = null;
            if (this.onExitCallback) {
                this.onExitCallback(code);
            }
        });
    }

    sendCommand(command) {
        if (this.isRunning()) {
            this.process.stdin.write(`${command}\n`);
        }
    }

    kill() {
        if (this.isRunning()) {
            this.sendCommand('stop');
            setTimeout(() => {
                if (this.isRunning()) this.process.kill('SIGKILL');
            }, 10000); // Force kill after 10s
        }
    }
}

module.exports = ProcessHandler;