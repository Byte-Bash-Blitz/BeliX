/**
 * features/voiceAssistant/voiceAssistant.js
 * Main entrypoint for BeliX Voice Meeting Assistant.
 */

const { voiceSessionManager } = require('./voiceSessionManager');
const { getVoiceSlashCommands, handleVoiceInteraction } = require('./voiceCommands');
const { setupMentionHandler } = require('./mentionHandler');
const { groqVoice } = require('./groqVoice');
const { speechGenerator } = require('./speechGenerator');

// Set FFMPEG_PATH to ffmpeg-static binary if not already defined
try {
    const ffmpegPath = require('ffmpeg-static');
    if (ffmpegPath) {
        process.env.FFMPEG_PATH = ffmpegPath;
        console.log('✓ Initialized ffmpeg from ffmpeg-static');
    }
} catch (e) {
    console.warn('ffmpeg-static not detected:', e.message);
}

function handleVoiceAssistant(client) {
    console.log('✓ Voice Assistant feature initialized');

    // Enable @BeliX mention triggers (e.g. "@BeliX join", "@BeliX leave")
    setupMentionHandler(client);

    // Clean up all active voice sessions on bot shutdown or process exit
    const cleanup = () => {
        console.log('Cleaning up voice sessions before shutdown...');
        for (const [guildId, session] of voiceSessionManager.sessions.entries()) {
            try {
                session.destroy();
            } catch (e) {}
        }
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    client.on('shardDisconnect', cleanup);
}

module.exports = {
    handleVoiceAssistant,
    voiceSessionManager,
    getVoiceSlashCommands,
    handleVoiceInteraction,
    groqVoice,
    speechGenerator,
    memberKnowledgeEngine: require('./memberKnowledgeEngine')
};

