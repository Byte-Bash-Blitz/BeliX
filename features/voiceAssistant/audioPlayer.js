/**
 * audioPlayer.js
 * Manages audio playback for BeliX in Discord voice channels.
 * Features an internal queue, interruption support, and safe error handling.
 */

const {
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    entersState,
    StreamType
} = require('@discordjs/voice');
const { Readable } = require('stream');
const EventEmitter = require('events');

// Ensure ffmpeg path is set from ffmpeg-static if available
try {
    const ffmpegPath = require('ffmpeg-static');
    if (ffmpegPath && !process.env.FFMPEG_PATH) {
        process.env.FFMPEG_PATH = ffmpegPath;
    }
} catch (e) {
    // ffmpeg-static not available or already configured
}

class VoiceAudioPlayer extends EventEmitter {
    constructor() {
        super();
        this.player = createAudioPlayer();
        this.queue = [];
        this.currentTrack = null;
        this.isStopped = false;

        this._setupListeners();
    }

    _setupListeners() {
        this.player.on(AudioPlayerStatus.Playing, () => {
            this.emit('start', this.currentTrack);
        });

        this.player.on(AudioPlayerStatus.Idle, () => {
            this.currentTrack = null;
            this.emit('finish');
            this._playNext();
        });

        this.player.on('error', (error) => {
            console.error('Discord Voice AudioPlayer error:', error.message);
            this.emit('error', error);
            this.currentTrack = null;
            this._playNext();
        });
    }

    /**
     * Subscribes the player to a Discord VoiceConnection.
     * @param {import('@discordjs/voice').VoiceConnection} connection
     */
    attachToConnection(connection) {
        if (!connection) return;
        connection.subscribe(this.player);
    }

    /**
     * Checks if BeliX is currently speaking or buffering audio.
     * @returns {boolean}
     */
    isSpeaking() {
        const status = this.player.state.status;
        return status === AudioPlayerStatus.Playing || status === AudioPlayerStatus.Buffering;
    }

    /**
     * Queues an audio buffer to be played.
     *
     * @param {Buffer} audioBuffer WAV or MP3 audio buffer
     * @param {object} metadata Optional metadata (e.g. text spoken, speaker, etc.)
     */
    enqueue(audioBuffer, metadata = {}) {
        if (!audioBuffer || audioBuffer.length === 0) return;

        this.queue.push({
            buffer: audioBuffer,
            metadata,
            queuedAt: Date.now()
        });

        if (!this.isSpeaking() && !this.currentTrack) {
            this._playNext();
        }
    }

    /**
     * Internal method to play the next audio item in queue.
     */
    _playNext() {
        if (this.queue.length === 0) {
            this.currentTrack = null;
            return;
        }

        const next = this.queue.shift();
        this.currentTrack = next;

        try {
            const readable = Readable.from(next.buffer);
            const resource = createAudioResource(readable, {
                inlineVolume: true
            });

            if (resource.volume) {
                resource.volume.setVolume(1.0);
            }

            this.player.play(resource);
        } catch (err) {
            console.error('Failed to create/play audio resource:', err.message);
            this.currentTrack = null;
            this._playNext();
        }
    }

    /**
     * Immediately stops current speech and clears any queued audio (Barge-in / interruption).
     */
    stop() {
        this.queue = [];
        this.currentTrack = null;
        try {
            this.player.stop(true); // force stop
            this.emit('interrupted');
        } catch (e) {
            console.warn('Error while stopping audio player:', e.message);
        }
    }

    /**
     * Destroys player resources when leaving voice channel.
     */
    destroy() {
        this.stop();
        this.removeAllListeners();
    }
}

module.exports = { VoiceAudioPlayer };

