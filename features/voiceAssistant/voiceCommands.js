/**
 * voiceCommands.js
 * Definitions and handlers for all BeliX voice assistant slash commands:
 * /belix-join, /belix-leave, /belix-mode, /belix-mute, /belix-unmute,
 * /belix-voice-status, /belix-clear-context, /belix-test
 */

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { voiceSessionManager } = require('./voiceSessionManager');
const { groqVoice } = require('./groqVoice');
const { speechGenerator } = require('./speechGenerator');

/**
 * Returns an array of SlashCommandBuilder instances for registration.
 */
function getVoiceSlashCommands() {
    return [
        new SlashCommandBuilder()
            .setName('belix-join')
            .setDescription('Connect BeliX AI Voice Assistant to your current voice channel.'),

        new SlashCommandBuilder()
            .setName('belix-leave')
            .setDescription('Disconnect BeliX from the voice channel and end the meeting session.'),

        new SlashCommandBuilder()
            .setName('belix-mode')
            .setDescription('Change the voice assistant conversation mode.')
            .addStringOption(option =>
                option.setName('mode')
                    .setDescription('Choose between wake-word mode or active-meeting mode')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Wake Word Mode (Responds only when called)', value: 'wake-word' },
                        { name: 'Active Meeting Mode (Participates intelligently)', value: 'active-meeting' }
                    )
            ),

        new SlashCommandBuilder()
            .setName('belix-mute')
            .setDescription('Mute BeliX voice output (stops and prevents spoken replies).'),

        new SlashCommandBuilder()
            .setName('belix-unmute')
            .setDescription('Unmute BeliX voice output (resumes spoken replies).'),

        new SlashCommandBuilder()
            .setName('belix-voice-status')
            .setDescription('Show current voice session status, latency, and conversation metrics.'),

        new SlashCommandBuilder()
            .setName('belix-clear-context')
            .setDescription('Clear the temporary meeting conversation memory and context.'),

        new SlashCommandBuilder()
            .setName('belix-test')
            .setDescription('Test Groq AI connectivity and voice synthesis functionality.')
    ];
}

/**
 * Routes and handles all /belix-* command interactions.
 * Note: interaction is already deferred by the main interactionCreate handler!
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleVoiceInteraction(interaction) {
    const { commandName, guild, member } = interaction;

    if (!guild) {
        return interaction.editReply({
            content: '❌ Voice commands can only be used within a server.'
        });
    }

    try {
        switch (commandName) {
            case 'belix-join': {
                const voiceChannel = member?.voice?.channel;
                if (!voiceChannel) {
                    return interaction.editReply({
                        content: '⚠️ You must be connected to a voice channel to invite BeliX.'
                    });
                }

                // Check permissions
                const permissions = voiceChannel.permissionsFor(interaction.client.user);
                if (!permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
                    return interaction.editReply({
                        content: `❌ I do not have permission to Connect or Speak in **${voiceChannel.name}**.`
                    });
                }

                const session = await voiceSessionManager.joinSession(
                    interaction.client,
                    voiceChannel,
                    interaction.channel
                );

                const embed = new EmbedBuilder()
                    .setColor('#2ecc71')
                    .setTitle('🎙️ BeliX Joined Voice Channel')
                    .setDescription(`Successfully joined **${voiceChannel.name}**!\nI will introduce myself in voice momentarily.`)
                    .addFields(
                        { name: '🗣️ Wake Words', value: '`Hey BeliX`, `BeliX`', inline: true },
                        { name: '⚙️ Mode', value: `\`${session.mode}\``, inline: true },
                        { name: '🔒 Security', value: 'Audio processed in-memory. No permanent recordings.', inline: false }
                    )
                    .setFooter({ text: 'Use /belix-leave to disconnect' })
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            }

            case 'belix-leave': {
                const session = voiceSessionManager.getSession(guild.id);
                if (!session) {
                    return interaction.editReply({
                        content: 'ℹ️ BeliX is not currently connected to any voice channel in this server.'
                    });
                }

                const channelName = session.voiceChannel.name;
                voiceSessionManager.leaveSession(guild.id);

                const embed = new EmbedBuilder()
                    .setColor('#e74c3c')
                    .setTitle('👋 BeliX Disconnected')
                    .setDescription(`Left voice channel **${channelName}**. The meeting session and temporary conversation memory have been cleared.`)
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            }

            case 'belix-mode': {
                const session = voiceSessionManager.getSession(guild.id);
                if (!session) {
                    return interaction.editReply({
                        content: '⚠️ BeliX is not currently connected to a voice channel. Use `/belix-join` first.'
                    });
                }

                const newMode = interaction.options.getString('mode');
                session.setMode(newMode);

                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle('⚙️ Conversation Mode Updated')
                    .setDescription(`Operating mode set to **${newMode === 'wake-word' ? 'Wake Word Mode' : 'Active Meeting Mode'}**.`)
                    .addFields(
                        {
                            name: 'Description',
                            value: newMode === 'wake-word'
                                ? 'BeliX listens silently and responds only when someone addresses it directly with "**Hey BeliX**".'
                                : 'BeliX participates in active discussions and offers brief assistance when technical topics or questions arise.'
                        }
                    )
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            }

            case 'belix-mute': {
                const session = voiceSessionManager.getSession(guild.id);
                if (!session) {
                    return interaction.editReply({
                        content: '⚠️ BeliX is not currently in a voice channel.'
                    });
                }

                session.setMute(true);

                const embed = new EmbedBuilder()
                    .setColor('#e67e22')
                    .setTitle('🔇 BeliX Voice Output Muted')
                    .setDescription('Voice responses are now paused. BeliX will not speak into the channel until `/belix-unmute` is used.')
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            }

            case 'belix-unmute': {
                const session = voiceSessionManager.getSession(guild.id);
                if (!session) {
                    return interaction.editReply({
                        content: '⚠️ BeliX is not currently in a voice channel.'
                    });
                }

                session.setMute(false);

                const embed = new EmbedBuilder()
                    .setColor('#2ecc71')
                    .setTitle('🔊 BeliX Voice Output Resumed')
                    .setDescription('BeliX is now unmuted and will respond through voice when called.')
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            }

            case 'belix-voice-status': {
                const session = voiceSessionManager.getSession(guild.id);

                if (!session) {
                    const idleEmbed = new EmbedBuilder()
                        .setColor('#95a5a6')
                        .setTitle('📊 BeliX Voice Status')
                        .setDescription('Status: **Idle** (Not in any voice channel)')
                        .addFields(
                            { name: 'Groq API Key', value: groqVoice.isConfigured() ? '✅ Configured' : '❌ Missing', inline: true },
                            { name: 'Default Model', value: `\`${groqVoice.model}\``, inline: true }
                        )
                        .setFooter({ text: 'Use /belix-join to start a voice meeting session' })
                        .setTimestamp();

                    return interaction.editReply({ embeds: [idleEmbed] });
                }

                const status = session.getStatus();

                const embed = new EmbedBuilder()
                    .setColor('#9b59b6')
                    .setTitle('📊 Active Voice Session Status')
                    .addFields(
                        { name: '🔊 Channel', value: `**${status.channelName}**`, inline: true },
                        { name: '📡 State', value: `\`${status.connectionState}\``, inline: true },
                        { name: '📶 WS Ping', value: status.ping ? `${status.ping} ms` : 'N/A', inline: true },
                        { name: '⚙️ Mode', value: `\`${status.mode}\``, inline: true },
                        { name: '🎙️ Voice Output', value: status.isMuted ? '🔇 Muted' : (status.isSpeaking ? '🗣️ Speaking' : '🟢 Listening'), inline: true },
                        { name: '⏱️ Session Uptime', value: `${status.uptimeMinutes} min`, inline: true },
                        { name: '💬 Questions Answered', value: `${status.questionsAnswered}`, inline: true },
                        { name: '🧠 Context Turns', value: `${status.contextTurns} in memory`, inline: true },
                        { name: `🤖 AI Provider (${groqVoice.getProviderName()})`, value: `\`${groqVoice.model}\``, inline: true }
                    )
                    .setFooter({ text: `Guild ID: ${guild.id}` })
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            }

            case 'belix-clear-context': {
                const session = voiceSessionManager.getSession(guild.id);
                if (!session) {
                    return interaction.editReply({
                        content: '⚠️ No active meeting session found in this server.'
                    });
                }

                session.clearContext();

                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle('🧹 Conversation Context Cleared')
                    .setDescription('Meeting memory has been wiped. BeliX will treat subsequent questions as a fresh conversation.')
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            }

            case 'belix-test': {
                const testEmbed = new EmbedBuilder()
                    .setColor('#f1c40f')
                    .setTitle('🧪 BeliX System & Voice Diagnostics')
                    .setDescription('Running tests on Groq AI, speech synthesis, and voice systems...')
                    .setTimestamp();

                await interaction.editReply({ embeds: [testEmbed] });

                // Test 1: Groq API
                const groqCheck = await groqVoice.testConnection();

                // Test 2: Voice TTS synthesis
                let ttsSuccess = false;
                let ttsFormat = '';
                let ttsDuration = 0;
                let ttsError = null;

                try {
                    const ttsResult = await speechGenerator.generateSpeech('BeliX voice systems are operational and ready.');
                    ttsSuccess = true;
                    ttsFormat = ttsResult.format;
                    ttsDuration = ttsResult.durationSec;

                    // If currently connected to a channel, play a quick test ping
                    const session = voiceSessionManager.getSession(guild.id);
                    if (session && !session.isMuted) {
                        session.audioPlayer.enqueue(ttsResult.buffer, { type: 'test' });
                    }
                } catch (e) {
                    ttsError = e.message;
                }

                const resultEmbed = new EmbedBuilder()
                    .setColor(groqCheck.success && ttsSuccess ? '#2ecc71' : '#e74c3c')
                    .setTitle('🧪 BeliX System & Voice Diagnostic Results')
                    .addFields(
                        {
                            name: `🤖 AI Provider (${groqCheck.provider || groqVoice.getProviderName()})`,
                            value: groqCheck.success
                                ? `✅ Connected (\`${groqCheck.model}\`)\n*Latency:* ${groqCheck.latencyMs}ms\n*Response:* "${groqCheck.message}"`
                                : `❌ Notice: ${groqCheck.message}`,
                            inline: false
                        },
                        {
                            name: '🗣️ Voice Synthesis (TTS)',
                            value: ttsSuccess
                                ? `✅ Operational (Format: \`${ttsFormat.toUpperCase()}\`, Est: ${ttsDuration}s)`
                                : `❌ Failed: ${ttsError}`,
                            inline: false
                        },
                        {
                            name: '🎙️ Voice Channel Session',
                            value: voiceSessionManager.getSession(guild.id)
                                ? '✅ Active session in progress'
                                : 'ℹ️ Idle (Use `/belix-join` to connect)',
                            inline: false
                        }
                    )
                    .setFooter({ text: 'Diagnostics complete' })
                    .setTimestamp();

                return interaction.editReply({ embeds: [resultEmbed] });
            }

            default:
                return interaction.editReply({ content: 'Unknown voice command.' });
        }
    } catch (error) {
        console.error(`Error executing voice command ${commandName}:`, error);
        return interaction.editReply({
            content: `❌ An error occurred while executing \`/${commandName}\`: ${error.message}`
        });
    }
}

module.exports = {
    getVoiceSlashCommands,
    handleVoiceInteraction
};

