/**
 * voiceSessionManager.js
 * Central coordinator for active guild voice meeting sessions.
 * Glues together connection, audio receiver, Groq AI, TTS speech generator,
 * audio playback, conversation context, modes, and mute controls.
 */

const { VoiceConnectionManager } = require('./voiceConnection');
const { VoiceAudioReceiver } = require('./audioReceiver');
const { VoiceAudioPlayer } = require('./audioPlayer');
const { ConversationManager } = require('./conversationManager');
const { groqVoice } = require('./groqVoice');
const { speechGenerator } = require('./speechGenerator');
const { defaultDetector } = require('./wakeWordDetector');
const { EmbedBuilder } = require('discord.js');

class VoiceSession {
    /**
     * @param {import('discord.js').Client} client
     * @param {import('discord.js').VoiceBasedChannel} voiceChannel
     * @param {import('discord.js').TextBasedChannel} textChannel
     * @param {string} initialMode 'wake-word' | 'active-meeting'
     */
    constructor(client, voiceChannel, textChannel = null, initialMode = 'wake-word') {
        this.client = client;
        this.guild = voiceChannel.guild;
        this.voiceChannel = voiceChannel;
        this.textChannel = textChannel;
        this.mode = initialMode;
        this.isMuted = false;
        this.startedAt = new Date();
        this.questionsAnswered = 0;
        this.isProcessing = false;

        this.connectionManager = new VoiceConnectionManager();
        this.conversation = new ConversationManager(12);
        this.audioPlayer = new VoiceAudioPlayer();
        this.audioReceiver = null;
    }

    /**
     * Initializes the voice session: connects, announces presence, sets up pipelines.
     */
    async start() {
        console.log(`Starting voice session for guild ${this.guild.name} (${this.guild.id}) in channel ${this.voiceChannel.name}...`);

        // Check permissions
        const permCheck = this.connectionManager.checkPermissions(this.voiceChannel, this.client);
        if (!permCheck.hasPermissions) {
            throw new Error(`Missing required voice permissions in #${this.voiceChannel.name}: ${permCheck.missing.join(', ')}`);
        }

        // Join channel
        const connection = await this.connectionManager.join(this.voiceChannel);

        // Attach audio player to connection
        this.audioPlayer.attachToConnection(connection);

        // Setup audio receiver
        this.audioReceiver = new VoiceAudioReceiver(connection, this.client.user.id);
        this._setupAudioEventHandlers();

        // Send privacy and active meeting notification embed to text channel
        if (this.textChannel) {
            const embed = new EmbedBuilder()
                .setColor('#2ecc71')
                .setTitle('🎙️ BeliX Voice Assistant Connected')
                .setDescription(`Joined **${this.voiceChannel.name}** and ready to assist!`)
                .addFields(
                    { name: '⚙️ Mode', value: `\`${this.mode}\``, inline: true },
                    { name: '🔊 Audio Status', value: this.isMuted ? '🔇 Muted' : '🔊 Active', inline: true },
                    { name: '🗣️ Wake Word', value: '"**Hey BeliX**" or "**BeliX**"', inline: true },
                    { name: '🔒 Privacy Notice', value: 'BeliX processes audio in-memory for real-time meeting questions. No raw meeting audio is permanently stored on disk.', inline: false }
                )
                .setFooter({ text: 'Use /belix-leave to disconnect or /belix-mode to change settings' })
                .setTimestamp();

            this.textChannel.send({ embeds: [embed] }).catch(err => console.warn('Could not send session embed:', err.message));
        }

        // Generate and play introduction audio
        this._playIntroduction();
    }

    async _playIntroduction() {
        try {
            console.log('Generating voice introduction for meeting...');
            const introText = await groqVoice.generateIntroduction(this.voiceChannel.name);
            const { buffer, format } = await speechGenerator.generateSpeech(introText);
            this.audioPlayer.enqueue(buffer, { type: 'intro', text: introText });
        } catch (err) {
            console.error('Error generating or playing introduction audio:', err.message);
        }
    }

    _setupAudioEventHandlers() {
        if (!this.audioReceiver) return;

        // Participant starts speaking: check for interruption
        this.audioReceiver.on('participantSpeakingStart', (userId) => {
            if (this.audioPlayer.isSpeaking()) {
                console.log(`Participant ${userId} started speaking while BeliX was speaking (potential interruption).`);
            }
        });

        // Speech burst completed and processed into WAV
        this.audioReceiver.on('speechComplete', async ({ userId, wavBuffer, durationMs }) => {
            await this._handleParticipantSpeech(userId, wavBuffer, durationMs);
        });
    }

    async _handleParticipantSpeech(userId, wavBuffer, durationMs) {
        // If voice output is muted, ignore
        if (this.isMuted) return;

        // Fetch participant name
        let speakerName = 'Participant';
        try {
            const member = await this.guild.members.fetch(userId);
            if (member) {
                speakerName = member.displayName || member.user.username;
            }
        } catch (e) {
            // Member fetch failed, use fallback
        }

        // If BeliX is currently speaking, participant might be interrupting!
        if (this.audioPlayer.isSpeaking()) {
            console.log(`Checking interruption from ${speakerName}...`);
            // Stop current speech so BeliX can listen to the new instruction
            this.audioPlayer.stop();
        }

        // Avoid multiple simultaneous AI API calls
        if (this.isProcessing) {
            console.log('Already processing another speech burst, skipping overlapping speech.');
            return;
        }

        this.isProcessing = true;

        try {
            const historyPrompt = this.conversation.getHistoryForPrompt();
            console.log(`Processing speech (${Math.round(durationMs)}ms) from ${speakerName}...`);

            const aiResult = await groqVoice.processParticipantAudio(
                wavBuffer,
                speakerName,
                historyPrompt,
                this.mode
            );

            console.log(`Transcript: "${aiResult.transcript}" | WakeWord: ${aiResult.hasWakeWord} | ShouldRespond: ${aiResult.shouldRespond}`);

            // Check wake word both via AI understanding and local phonetic detector
            const localCheck = defaultDetector.detect(aiResult.transcript);
            const hasWakeWord = Boolean(aiResult.hasWakeWord || localCheck.hasWakeWord);

            // In Wake Word mode: ONLY reply if user explicitly called "Hey BeliX" or "Hey Blix"!
            // In Active Meeting mode: reply if wake word called OR if direct question asked to the room
            let shouldSpeak = false;
            if (this.mode === 'wake-word') {
                shouldSpeak = hasWakeWord;
            } else if (this.mode === 'active-meeting') {
                shouldSpeak = hasWakeWord || Boolean(aiResult.shouldRespond);
            }

            // Check if user specifically told BeliX to stop/be quiet
            if (defaultDetector.isInterruptionCommand(aiResult.transcript)) {
                this.audioPlayer.stop();
                this.isProcessing = false;
                return;
            }

            if (!shouldSpeak) {
                console.log(`Speech heard from ${speakerName}, but no wake word ("Hey BeliX" / "Hey Blix") detected. Staying silent.`);
                this.isProcessing = false;
                return;
            }

            if (shouldSpeak && aiResult.reply) {
                this.questionsAnswered++;
                const questionText = aiResult.question || localCheck.question || aiResult.transcript;

                // Save to conversation history for follow-up questions
                this.conversation.addTurn(userId, speakerName, questionText, aiResult.reply);

                // Convert reply to speech
                console.log(`Generating speech response: "${aiResult.reply}"`);
                const { buffer } = await speechGenerator.generateSpeech(aiResult.reply);

                // Play in voice channel
                this.audioPlayer.enqueue(buffer, {
                    speakerName,
                    question: questionText,
                    reply: aiResult.reply
                });

                // Post in text channel if available
                if (this.textChannel) {
                    const replyEmbed = new EmbedBuilder()
                        .setColor('#3498db')
                        .setAuthor({ name: `${speakerName} asked:` })
                        .setDescription(`**"${questionText}"**\n\n🎙️ **BeliX (Voice):**\n${aiResult.reply}`)
                        .setFooter({ text: `Mode: ${this.mode} • Questions: ${this.questionsAnswered}` })
                        .setTimestamp();

                    this.textChannel.send({ embeds: [replyEmbed] }).catch(() => {});
                }
            }
        } catch (err) {
            console.error('Error handling participant speech:', err.message);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Changes conversation mode: 'wake-word' or 'active-meeting'.
     * @param {string} newMode
     */
    setMode(newMode) {
        if (newMode !== 'wake-word' && newMode !== 'active-meeting') {
            throw new Error('Invalid mode. Options are: "wake-word" or "active-meeting"');
        }
        this.mode = newMode;
    }

    /**
     * Mute or unmute voice responses.
     * @param {boolean} muted
     */
    setMute(muted) {
        this.isMuted = Boolean(muted);
        if (this.isMuted) {
            this.audioPlayer.stop();
        }
    }

    /**
     * Clears temporary conversation history.
     */
    clearContext() {
        this.conversation.clear();
    }

    /**
     * Returns a summary status of the active session.
     */
    getStatus() {
        const connStatus = this.connectionManager.getStatus();
        const uptimeMinutes = Math.floor((Date.now() - this.startedAt.getTime()) / 60000);

        return {
            guildId: this.guild.id,
            guildName: this.guild.name,
            channelId: this.voiceChannel.id,
            channelName: this.voiceChannel.name,
            textChannelId: this.textChannel?.id || null,
            isConnected: connStatus.isConnected,
            connectionState: connStatus.status,
            ping: connStatus.ping,
            mode: this.mode,
            isMuted: this.isMuted,
            isSpeaking: this.audioPlayer.isSpeaking(),
            questionsAnswered: this.questionsAnswered,
            contextTurns: this.conversation.getTotalTurns(),
            uptimeMinutes
        };
    }

    /**
     * Disconnects and releases all resources.
     */
    destroy() {
        console.log(`Ending voice session for guild ${this.guild.name}...`);
        if (this.audioPlayer) {
            this.audioPlayer.destroy();
        }
        if (this.audioReceiver) {
            this.audioReceiver.destroy();
        }
        if (this.connectionManager) {
            this.connectionManager.leave();
        }
        this.conversation.clear();
    }
}

class VoiceSessionManager {
    constructor() {
        /** @type {Map<string, VoiceSession>} */
        this.sessions = new Map();
    }

    /**
     * Gets or creates a voice session for a guild.
     *
     * @param {import('discord.js').Client} client
     * @param {import('discord.js').VoiceBasedChannel} voiceChannel
     * @param {import('discord.js').TextBasedChannel} textChannel
     * @returns {Promise<VoiceSession>}
     */
    async joinSession(client, voiceChannel, textChannel = null) {
        const guildId = voiceChannel.guild.id;

        // If existing session exists in this guild
        if (this.sessions.has(guildId)) {
            const existing = this.sessions.get(guildId);
            // If already in this channel and connected, return it
            if (existing.voiceChannel.id === voiceChannel.id && existing.connectionManager.getStatus().isConnected) {
                return existing;
            }
            // Otherwise destroy old session before starting new one
            existing.destroy();
            this.sessions.delete(guildId);
        }

        const session = new VoiceSession(client, voiceChannel, textChannel, process.env.VOICE_MODE || 'wake-word');
        await session.start();
        this.sessions.set(guildId, session);
        return session;
    }

    /**
     * Leaves and cleans up the voice session for a guild.
     *
     * @param {string} guildId
     * @returns {boolean} True if a session was ended
     */
    leaveSession(guildId) {
        const session = this.sessions.get(guildId);
        if (session) {
            session.destroy();
            this.sessions.delete(guildId);
            return true;
        }
        return false;
    }

    /**
     * Gets the active session for a guild.
     *
     * @param {string} guildId
     * @returns {VoiceSession|null}
     */
    getSession(guildId) {
        return this.sessions.get(guildId) || null;
    }
}

module.exports = {
    VoiceSession,
    VoiceSessionManager,
    voiceSessionManager: new VoiceSessionManager()
};

