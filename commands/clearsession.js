const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

const channelInfo = {};

async function clearSessionCommand(sock, chatId, msg) {
    try {
        const senderId = msg.key.participant || msg.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
        
        if (!msg.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, { 
                text: '❌ This command can only be used by the owner!',
                ...channelInfo
            });
            return;
        }

        // Define session directory
        const sessionDir = path.join(__dirname, '../session');

        if (!fs.existsSync(sessionDir)) {
            await sock.sendMessage(chatId, { 
                text: '❌ Session directory not found!',
                ...channelInfo
            });
            return;
        }

        let filesCleared = 0;
        let errors = 0;
        let errorDetails = [];

        // Send initial status
        await sock.sendMessage(chatId, { 
            text: `🔍 Optimizing session files across all bot sessions...`,
            ...channelInfo
        });

        // Scan root and any session subdirectories
        const directoriesToClean = [sessionDir];
        const entries = fs.readdirSync(sessionDir);
        for (const entry of entries) {
            const fullPath = path.join(sessionDir, entry);
            if (fs.lstatSync(fullPath).isDirectory()) {
                directoriesToClean.push(fullPath);
            }
        }

        let preKeyCount = 0;

        for (const dir of directoriesToClean) {
            try {
                const files = fs.readdirSync(dir);
                for (const file of files) {
                    // Only safely clear stale pre-keys (never creds.json or app-state)
                    if (file.startsWith('pre-key-') && file.endsWith('.json')) {
                        preKeyCount++;
                        try {
                            fs.unlinkSync(path.join(dir, file));
                            filesCleared++;
                        } catch (err) {
                            errors++;
                            if (errorDetails.length < 5) {
                                errorDetails.push(`${file}: ${err.message}`);
                            }
                        }
                    }
                }
            } catch (_) {}
        }

        // Send completion message
        const message = `✅ Session files optimized successfully!\n\n` +
                       `📊 Statistics:\n` +
                       `• Total obsolete pre-keys cleared: ${filesCleared}\n` +
                       `• Active credentials & app states: Preserved 🛡️\n` +
                       (errors > 0 ? `\n⚠️ Errors encountered: ${errors}\n${errorDetails.join('\n')}` : '');

        await sock.sendMessage(chatId, { 
            text: message,
            ...channelInfo
        });

    } catch (error) {
        console.error('Error in clearsession command:', error);
        await sock.sendMessage(chatId, { 
            text: '❌ Failed to clear session files!',
            ...channelInfo
        });
    }
}

module.exports = clearSessionCommand;
