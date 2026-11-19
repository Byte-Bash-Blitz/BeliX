/**
 * speechGenerator.js
 * Synthesizes natural human-like voice responses using Cartesia TTS
 * (Sonic 3.6 with custom cloned voice) with seamless fallback to google-tts-api.
 */

const googleTTS = require('google-tts-api');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

class SpeechGenerator {
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

        const audioBuffer = await this.synthesizeWithTTS(cleanText);

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
}

module.exports = {
    SpeechGenerator,
    speechGenerator: new SpeechGenerator()
};
