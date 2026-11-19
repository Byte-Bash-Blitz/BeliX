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
        // Fish Audio Configuration (Custom Cloned Voice: https://s.fish.audio/8ax6r3)
        this.fishAudioApiKey = (process.env.FISH_AUDIO_API_KEY || '').trim();
        this.fishAudioModelId = (process.env.FISH_AUDIO_MODEL_ID || '8748b6af48204a0c8e8afa268d2beeb8').trim();

        if (this.fishAudioApiKey) {
            console.log(`✓ Fish Audio Cloned Voice initialized (Model: ${this.fishAudioModelId.slice(0, 8)}...)`);
        }

        // Sarvam AI Configuration (Natural Indian Tanglish Human Voice)
        this.sarvamApiKey = (process.env.SARVAM_API_KEY || '').trim();
        this.sarvamModel = process.env.SARVAM_MODEL || 'bulbul:v4-flash';
        this.sarvamSpeaker = process.env.SARVAM_SPEAKER || 'aravind_ta_ads';

        if (this.sarvamApiKey) {
            console.log(`✓ Sarvam AI Voice initialized (Speaker: ${this.sarvamSpeaker}, Model: ${this.sarvamModel})`);
        }

        // ElevenLabs Configuration
        this.elevenLabsApiKey = (process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY || '').trim();
        this.elevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID || 'wLIQpmGi7jT7aiEmDsE3';
        this.elevenLabsModel = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';

        if (this.elevenLabsApiKey) {
            console.log(`✓ ElevenLabs Voice initialized (Voice: ${this.elevenLabsVoiceId.slice(0, 8)}..., Model: ${this.elevenLabsModel})`);
        }

        // Cartesia Configuration
        this.cartesiaApiKey = (process.env.CARTESIA_API_KEY || '').trim();
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
     * Synthesizes audio using Fish Audio TTS (Custom Cloned Voice).
     *
     * @param {string} text Clean speech text
     * @returns {Promise<Buffer|null>} MP3 audio buffer
     */
    async synthesizeWithFishAudio(text) {
        if (!text || !this.fishAudioApiKey) return null;

        try {
            const res = await fetch('https://api.fish.audio/v1/tts', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.fishAudioApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: text,
                    reference_id: this.fishAudioModelId,
                    format: 'mp3'
                })
            });

            if (res.ok) {
                const arrayBuffer = await res.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                if (buffer && buffer.length > 0) {
                    return buffer;
                }
            } else {
                const errText = await res.text();
                console.warn('Fish Audio TTS notice:', res.status, errText);
            }
        } catch (err) {
            console.warn('Fish Audio TTS failed:', err.message);
        }

        return null;
    }

    /**
     * Synthesizes audio using Sarvam AI TTS (India's premier model for natural Tamil/Tanglish).
     *
     * @param {string} text Clean speech text
     * @returns {Promise<Buffer|null>} WAV audio buffer
     */
    async synthesizeWithSarvam(text) {
        if (!text || !this.sarvamApiKey) return null;

        const candidateConfigs = [
            { model: this.sarvamModel, speaker: this.sarvamSpeaker },
            { model: 'bulbul:v3', speaker: 'gokul' },
            { model: 'bulbul:v3', speaker: 'vijay' }
        ];

        for (const config of candidateConfigs) {
            try {
                const res = await fetch('https://api.sarvam.ai/text-to-speech', {
                    method: 'POST',
                    headers: {
                        'api-subscription-key': this.sarvamApiKey,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        inputs: [text],
                        target_language_code: 'ta-IN',
                        speaker: config.speaker,
                        pitch: 0,
                        pace: 1.0,
                        loudness: 1.5,
                        speech_sample_rate: 24000,
                        enable_preprocessing: true,
                        model: config.model
                    })
                });

                if (res.ok) {
                    const data = await res.json();
                    if (data.audios && data.audios[0]) {
                        const buffer = Buffer.from(data.audios[0], 'base64');
                        if (buffer && buffer.length > 0) {
                            return buffer;
                        }
                    }
                } else {
                    const errText = await res.text();
                    console.warn(`Sarvam AI TTS notice (${config.speaker}):`, res.status, errText);
                }
            } catch (err) {
                console.warn(`Sarvam AI TTS notice (${config.speaker}):`, err.message);
            }
        }

        return null;
    }

    /**
     * Synthesizes audio using ElevenLabs TTS with custom cloned voice.
     *
     * @param {string} text Clean speech text
     * @returns {Promise<Buffer|null>} MP3 audio buffer
     */
    async synthesizeWithElevenLabs(text) {
        if (!text || !this.elevenLabsApiKey) return null;

        try {
            const url = `https://api.elevenlabs.io/v1/text-to-speech/${this.elevenLabsVoiceId}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'xi-api-key': this.elevenLabsApiKey,
                    'Content-Type': 'application/json',
                    'Accept': 'audio/mpeg'
                },
                body: JSON.stringify({
                    text: text,
                    model_id: this.elevenLabsModel,
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75
                    }
                })
            });

            if (res.ok) {
                const arrayBuffer = await res.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                if (buffer && buffer.length > 0) {
                    return buffer;
                }
            } else {
                const errText = await res.text();
                console.warn('ElevenLabs TTS notice:', res.status, errText);
            }
        } catch (err) {
            console.warn('ElevenLabs TTS failed:', err.message);
        }

        return null;
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
        let format = 'mp3';

        // 1. Primary: Fish Audio Cloned Voice (User's custom cloned voice: https://s.fish.audio/8ax6r3)
        if (this.fishAudioApiKey) {
            try {
                audioBuffer = await this.synthesizeWithFishAudio(cleanText);
                if (audioBuffer && audioBuffer.length > 0) {
                    format = 'mp3';
                }
            } catch (err) {
                console.warn('Fish Audio voice synthesis notice:', err.message);
            }
        }

        // 2. Secondary: Sarvam AI Natural Tanglish Voice
        if ((!audioBuffer || audioBuffer.length === 0) && this.sarvamApiKey) {
            try {
                audioBuffer = await this.synthesizeWithSarvam(cleanText);
                if (audioBuffer && audioBuffer.length > 0) {
                    format = 'wav';
                }
            } catch (err) {
                console.warn('Sarvam AI voice synthesis notice:', err.message);
            }
        }

        // 3. Tertiary: ElevenLabs Voice
        if ((!audioBuffer || audioBuffer.length === 0) && this.elevenLabsApiKey) {
            try {
                audioBuffer = await this.synthesizeWithElevenLabs(cleanText);
                if (audioBuffer && audioBuffer.length > 0) {
                    format = 'mp3';
                }
            } catch (err) {
                console.warn('ElevenLabs voice synthesis notice:', err.message);
            }
        }

        // 4. Quaternary: Cartesia Cloned Voice
        if ((!audioBuffer || audioBuffer.length === 0) && this.cartesiaApiKey) {
            try {
                audioBuffer = await this.synthesizeWithCartesia(cleanText);
                if (audioBuffer && audioBuffer.length > 0) {
                    format = 'wav';
                }
            } catch (err) {
                console.warn('Cartesia cloned voice synthesis notice:', err.message);
            }
        }

        // 5. Fallback: Google TTS
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
        let provider = 'Google TTS';
        let voiceId = null;

        if (this.fishAudioApiKey) {
            provider = 'Fish Audio (Cloned Voice)';
            voiceId = this.fishAudioModelId;
        } else if (this.sarvamApiKey) {
            provider = 'Sarvam AI';
            voiceId = this.sarvamSpeaker;
        } else if (this.elevenLabsApiKey) {
            provider = 'ElevenLabs';
            voiceId = this.elevenLabsVoiceId;
        } else if (this.cartesiaApiKey) {
            provider = 'Cartesia';
            voiceId = this.cartesiaVoiceId;
        }

        return {
            provider,
            voiceId,
            isClone: Boolean(this.fishAudioApiKey || this.elevenLabsApiKey || this.cartesiaApiKey)
        };
    }
}

module.exports = {
    SpeechGenerator,
    speechGenerator: new SpeechGenerator()
};
