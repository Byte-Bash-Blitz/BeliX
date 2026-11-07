/**
 * audioReceiver.js
 * Captures incoming Discord voice audio streams from meeting participants,
 * decodes Opus to PCM, filters noise/silence, resamples to 16kHz mono WAV,
 * and handles participant interruptions.
 */

const { EndBehaviorType } = require('@discordjs/voice');
const EventEmitter = require('events');
const {
    createOpusDecoder,
    resample48kStereoTo16kMono,
    pcmToWav,
    isSilence,
    getDurationMs
} = require('./audioProcessor');

// Audio threshold constants
const MIN_SPEECH_DURATION_MS = 600;  // Ignore bursts shorter than 600ms (clicks, breathing)
const MAX_SPEECH_DURATION_MS = 25000; // Cap utterances at 25 seconds (payload protection)
const SILENCE_DURATION_MS = 800;     // End speech after 800ms of participant silence

class VoiceAudioReceiver extends EventEmitter {
    /**
     * @param {import('@discordjs/voice').VoiceConnection} connection
     * @param {string} botUserId Discord ID of the bot to ignore self-audio
     */
    constructor(connection, botUserId) {
        super();
        this.connection = connection;
        this.botUserId = botUserId;
        this.activeStreams = new Map(); // userId -> { opusStream, decoder, chunks: [] }
        this.isListening = true;

        this._setupReceiver();
    }

    _setupReceiver() {
        if (!this.connection || !this.connection.receiver) return;

        const receiver = this.connection.receiver;

        receiver.speaking.on('start', (userId) => {
            if (!this.isListening) return;
            // Never process the bot's own voice
            if (userId === this.botUserId) return;

            this.emit('participantSpeakingStart', userId);
            this._startListeningToUser(userId);
        });

        receiver.speaking.on('end', (userId) => {
            if (userId === this.botUserId) return;
            this.emit('participantSpeakingEnd', userId);
        });
    }

    _startListeningToUser(userId) {
        // If already capturing this user, let existing stream continue
        if (this.activeStreams.has(userId)) return;

        try {
            const opusStream = this.connection.receiver.subscribe(userId, {
                end: {
                    behavior: EndBehaviorType.AfterSilence,
                    duration: SILENCE_DURATION_MS
                }
            });

            const decoder = createOpusDecoder();
            const chunks = [];

            this.activeStreams.set(userId, { opusStream, decoder, chunks, startTime: Date.now() });

            decoder.on('data', (chunk) => {
                chunks.push(chunk);

                // Protect against oversized audio payloads
                const totalBytes = chunks.reduce((acc, c) => acc + c.length, 0);
                const duration = getDurationMs(totalBytes, 48000, 2, 16);
                if (duration > MAX_SPEECH_DURATION_MS) {
                    opusStream.destroy();
                }
            });

            decoder.on('error', (err) => {
                console.warn(`Opus decoder error for user ${userId}:`, err.message);
            });

            opusStream.on('error', (err) => {
                console.warn(`Opus stream error for user ${userId}:`, err.message);
            });

            opusStream.on('end', () => {
                this._finishUserSpeech(userId);
            });

            opusStream.pipe(decoder);
        } catch (err) {
            console.error(`Failed to subscribe to audio for user ${userId}:`, err.message);
            this.activeStreams.delete(userId);
        }
    }

    _finishUserSpeech(userId) {
        const streamData = this.activeStreams.get(userId);
        if (!streamData) return;

        this.activeStreams.delete(userId);

        const { chunks } = streamData;
        if (!chunks || chunks.length === 0) return;

        const pcm48kStereo = Buffer.concat(chunks);
        const durationMs = getDurationMs(pcm48kStereo.length, 48000, 2, 16);

        // Filter out very short noises
        if (durationMs < MIN_SPEECH_DURATION_MS) {
            return;
        }

        // Resample from 48kHz stereo to 16kHz mono for Groq Whisper
        const pcm16kMono = resample48kStereoTo16kMono(pcm48kStereo);

        // Filter out silence / ambient noise
        if (isSilence(pcm16kMono)) {
            return;
        }

        // Wrap in WAV container
        const wavBuffer = pcmToWav(pcm16kMono, 16000, 1, 16);

        this.emit('speechComplete', {
            userId,
            wavBuffer,
            durationMs,
            timestamp: Date.now()
        });
    }

    /**
     * Pause or resume receiving audio.
     * @param {boolean} listening
     */
    setListening(listening) {
        this.isListening = Boolean(listening);
    }

    /**
     * Cleans up all active audio subscriptions.
     */
    destroy() {
        this.isListening = false;
        for (const [userId, streamData] of this.activeStreams.entries()) {
            try {
                streamData.opusStream?.destroy();
                streamData.decoder?.destroy();
            } catch (e) {}
        }
        this.activeStreams.clear();
        this.removeAllListeners();
    }
}

module.exports = { VoiceAudioReceiver };

