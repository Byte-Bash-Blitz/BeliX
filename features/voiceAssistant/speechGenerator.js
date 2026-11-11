/**
 * speechGenerator.js
 * Synthesizes natural human-like voice responses using Cartesia TTS
 * (Sonic 3.6 with custom cloned voice) with seamless fallback to google-tts-api.
 */

const googleTTS = require('google-tts-api');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

class SpeechGenerator {
    constructor() {
        this.cartesiaApiKey = process.env.CARTESIA_API_KEY || 'sk_car_S2jTpyZnED8mkrpCeADYu5';
        this.cartesiaModelId = process.env.CARTESIA_MODEL_ID || 'sonic-3.6';
        this.cartesiaVoiceId = process.env.CARTESIA_VOICE_ID || 'fed32815-0139-4026-ba22-949763a5d17b';
        this.cartesiaClient = null;

        if (this.cartesiaApiKey) {
            try {
                const Cartesia = require('@cartesia/cartesia-js').default || require('@cartesia/cartesia-js');
                this.cartesiaClient = new Cartesia({
                    apiKey: this.cartesiaApiKey,
                    baseURL: process.env.CARTESIA_BASE_URL || 'https://api.cartesia.ai'
                });
                console.log(`✓ Cartesia Cloned Voice initialized (Model: ${this.cartesiaModelId}, Voice: ${this.cartesiaVoiceId.slice(0, 8)}...)`);
            } catch (err) {
                console.warn('Cartesia SDK initialization notice:', err.message);
            }
        }
    }

    /**
     * Synthesizes audio using Cartesia with custom cloned voice.
     *
     * @param {string} text Clean text
     * @returns {Promise<Buffer|null>} Lossless WAV audio buffer
     */
    async synthesizeWithCartesia(text) {
        if (!text || !this.cartesiaApiKey) return null;

        // 1. Try official Cartesia SDK
        if (this.cartesiaClient) {
            try {
                const response = await this.cartesiaClient.tts.generate({
                    model_id: this.cartesiaModelId,
                    transcript: text,
                    voice: {
                        mode: 'id',
                        id: this.cartesiaVoiceId
                    },
                    output_format: {
                        container: 'wav',
                        encoding: 'pcm_s16le',
                        sample_rate: 44100
                    },
                    generation_config: {
                        speed: 1,
                        volume: 1
                    }
                });

                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                if (buffer && buffer.length > 0) {
                    return buffer;
                }
            } catch (err) {
                console.warn('Cartesia SDK generation error, trying REST endpoint:', err.message);
            }
        }

        // 2. Fallback to direct Cartesia REST endpoint
        try {
            const res = await fetch('https://api.cartesia.ai/tts/bytes', {
                method: 'POST',
                headers: {
                    'X-API-Key': this.cartesiaApiKey,
                    'Cartesia-Version': '2024-06-10',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model_id: this.cartesiaModelId,
                    transcript: text,
                    voice: {
                        mode: 'id',
                        id: this.cartesiaVoiceId
                    },
                    output_format: {
                        container: 'wav',
                        encoding: 'pcm_s16le',
                        sample_rate: 44100
                    }
                })
            });

            if (res.ok) {
                const arrayBuffer = await res.arrayBuffer();
                return Buffer.from(arrayBuffer);
            }
            const errText = await res.text();
            console.warn('Cartesia REST error:', errText);
        } catch (err) {
            console.warn('Cartesia REST failed:', err.message);
        }

        return null;
    }
    /**
     * Stitches multiple MP3 chunks into a single seamless, valid audio buffer
     * using FFmpeg's concat filter to prevent broken headers or audio stutter.
     *
     * @param {Buffer[]} buffers
     * @returns {Promise<Buffer>}
     */
    async stitchMp3Chunks(buffers) {
        if (!buffers || buffers.length === 0) return null;
        if (buffers.length === 1) return buffers[0];

        return new Promise((resolve) => {
            try {
                const args = [];
                for (let i = 0; i < buffers.length; i++) {
                    args.push('-i', 'pipe:' + (3 + i));
                }

                const filterInputs = buffers.map((_, i) => '[' + i + ':a]').join('');
                const filter = filterInputs + 'concat=n=' + buffers.length + ':v=0:a=1[out]';
                args.push('-filter_complex', filter, '-map', '[out]', '-f', 'mp3', 'pipe:1');

                const stdio = ['ignore', 'pipe', 'ignore'];
                for (let i = 0; i < buffers.length; i++) {
                    stdio.push('pipe');
                }

                const proc = spawn(ffmpegPath || 'ffmpeg', args, { stdio });
                const outChunks = [];

                proc.stdout.on('data', c => outChunks.push(c));
                proc.on('close', code => {
                    if (code === 0 && outChunks.length > 0) {
                        resolve(Buffer.concat(outChunks));
                    } else {
                        resolve(Buffer.concat(buffers));
                    }
                });
                proc.on('error', () => {
                    resolve(Buffer.concat(buffers));
                });

                for (let i = 0; i < buffers.length; i++) {
                    proc.stdio[3 + i].end(buffers[i]);
                }
            } catch (e) {
                resolve(Buffer.concat(buffers));
            }
        });
    }

    /**
     * Cleans text to prepare it for high quality text-to-speech.
     * Removes code syntax, backticks, URLs, markdown asterisks, hashes.
     *
     * @param {string} text
     * @returns {string} Clean speech-ready text
     */
    cleanTextForSpeech(text) {
        if (!text) return '';

        return text
            // Strip URLs
            .replace(/https?:\/\/\S+/gi, 'link')
            // Strip code blocks and inline code ticks
            .replace(/```[\s\S]*?```/g, 'code snippet omitted')
            .replace(/`([^`]+)`/g, '$1')
            // Strip bold, italics, strikethrough, headers, bullet symbols
            .replace(/[*_~#]/g, '')
            .replace(/^[-*+]\s+/gm, '')
            // Strip excessive newlines and whitespace
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Synthesizes audio using google-tts-api.
     *
     * @param {string} text Clean text
     * @returns {Promise<Buffer|null>} MP3 audio buffer
     */
    async synthesizeWithTTS(text) {
        try {
            // Split into chunks if text exceeds google-tts 200 char limit
            const results = await googleTTS.getAllAudioBase64(text, {
                lang: 'en',
                slow: false,
                timeout: 10000,
                splitPunct: ',.?!'
            });

            if (!results || results.length === 0) return null;

            const buffers = results.map(r => Buffer.from(r.base64, 'base64'));
            if (buffers.length === 1) {
                return buffers[0];
            }

            // Cleanly stitch multi-chunk audio using FFmpeg to avoid header corruption
            return await this.stitchMp3Chunks(buffers);
        } catch (err) {
            console.error('TTS synthesis failed:', err.message);
            return null;
        }
    }

    /**
     * Main method: converts text to speech buffer.
     * Uses Cartesia cloned voice as primary, with automatic fallback to Google TTS.
     *
     * @param {string} text Text to speak
     * @returns {Promise<{ buffer: Buffer, format: string, durationSec: number }>}
     */
    async generateSpeech(text) {
        const cleanText = this.cleanTextForSpeech(text);
        if (!cleanText) {
            throw new Error('Empty text provided for speech generation.');
        }

        let audioBuffer = null;
        let format = 'wav';

        // 1. Primary: Generate speech using Cartesia Cloned Voice
        if (this.cartesiaApiKey) {
            try {
                audioBuffer = await this.synthesizeWithCartesia(cleanText);
            } catch (err) {
                console.warn('Cartesia cloned voice synthesis error:', err.message);
            }
        }

        // 2. Fallback: Google TTS
        if (!audioBuffer || audioBuffer.length === 0) {
            audioBuffer = await this.synthesizeWithTTS(cleanText);
            format = 'mp3';
        }

        if (!audioBuffer || audioBuffer.length === 0) {
            throw new Error('TTS failed to generate audio.');
        }

        // Estimate duration based on word count (~150 words per minute = 2.5 words/sec)
        const wordCount = cleanText.split(/\s+/).length;
        const durationSec = Math.max(1, Math.round(wordCount / 2.5));

        return {
            buffer: audioBuffer,
            format,
            durationSec
        };
    }

    /**
     * Returns metadata about the active TTS voice engine.
     */
    getVoiceInfo() {
        return {
            provider: this.cartesiaApiKey ? 'Cartesia' : 'Google TTS',
            model: this.cartesiaModelId,
            voiceId: this.cartesiaVoiceId,
            isClone: Boolean(this.cartesiaApiKey && this.cartesiaVoiceId)
        };
    }
}

module.exports = {
    SpeechGenerator,
    speechGenerator: new SpeechGenerator()
};
