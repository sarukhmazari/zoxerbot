const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function checkAndInstallDeps() {
    const isTermux = process.platform === 'android' || 
                     Boolean(process.env.PREFIX && process.env.PREFIX.includes('com.termux')) ||
                     Boolean(process.env.TERMUX_VERSION);

    // 1. Check & install missing system packages on Termux (ffmpeg, git)
    if (isTermux) {
        let hasFfmpeg = false;
        try {
            execSync('command -v ffmpeg || which ffmpeg', { stdio: 'ignore' });
            hasFfmpeg = true;
        } catch (_) {}

        let hasGit = false;
        try {
            execSync('command -v git || which git', { stdio: 'ignore' });
            hasGit = true;
        } catch (_) {}

        const missingSys = [];
        if (!hasFfmpeg) missingSys.push('ffmpeg');
        if (!hasGit) missingSys.push('git');

        if (missingSys.length > 0) {
            console.log(`\n========================================`);
            console.log(`📱 [TERMUX] Detected missing system packages: ${missingSys.join(', ')}`);
            console.log(`⏳ Auto-installing with 'pkg install -y ${missingSys.join(' ')}'...`);
            console.log(`========================================\n`);
            try {
                execSync(`pkg install -y ${missingSys.join(' ')}`, { stdio: 'inherit' });
                console.log(`✅ [TERMUX] Successfully installed: ${missingSys.join(', ')}\n`);
            } catch (err) {
                console.error(`⚠️ [TERMUX] Auto-install warning: ${err.message}`);
                console.log(`💡 You can also run: pkg install -y ${missingSys.join(' ')}\n`);
            }
        }
    }

    // 1b. Check & install missing system packages on Linux VPS (Ubuntu / Debian / Lightsail)
    if (!isTermux && process.platform === 'linux') {
        let hasFfmpeg = false;
        try {
            execSync('command -v ffmpeg || which ffmpeg', { stdio: 'ignore' });
            hasFfmpeg = true;
        } catch (_) {}

        if (!hasFfmpeg) {
            console.log(`\n========================================`);
            console.log(`🐧 [LINUX] Missing system package: ffmpeg`);
            console.log(`⏳ Auto-installing with 'sudo apt-get update -qq && sudo apt-get install -y ffmpeg'...`);
            console.log(`========================================\n`);
            try {
                execSync('sudo apt-get update -qq && sudo apt-get install -y ffmpeg', { stdio: 'inherit' });
                console.log(`✅ [LINUX] Successfully installed ffmpeg!\n`);
            } catch (err) {
                console.warn(`⚠️ [LINUX] Auto-install note: ${err.message}. If needed, run: sudo apt install -y ffmpeg\n`);
            }
        }
    }

    // 2. Check if npm node_modules are installed (avoid recursion if running inside npm install/postinstall)
    const isNpmInstall = process.env.npm_lifecycle_event === 'postinstall' || process.env.npm_lifecycle_event === 'install';
    const rootDir = path.resolve(__dirname, '..');
    const nodeModulesDir = path.join(rootDir, 'node_modules');
    const baileysDir = path.join(nodeModulesDir, '@whiskeysockets', 'baileys');

    if (!isNpmInstall && (!fs.existsSync(nodeModulesDir) || !fs.existsSync(baileysDir))) {
        console.log(`\n========================================`);
        console.log(`📦 [NPM] Missing node_modules or dependencies!`);
        console.log(`⏳ Automatically running 'npm install --legacy-peer-deps'... Please wait.`);
        console.log(`========================================\n`);
        try {
            execSync('npm install --legacy-peer-deps', { cwd: rootDir, stdio: 'inherit' });
            console.log(`✅ [NPM] All Node dependencies installed successfully!\n`);
        } catch (err) {
            console.error(`❌ [NPM] Error installing dependencies: ${err.message}`);
        }
    }
}

// Execute check immediately if called directly via 'node lib/auto-installer.js'
if (require.main === module) {
    checkAndInstallDeps();
}

module.exports = checkAndInstallDeps;
