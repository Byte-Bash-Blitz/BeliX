/**
 * wakeWordDetector.js
 * Detects wake words in transcribed speech, cleans and normalizes user questions.
 * Handles Whisper phonetic variations (e.g., "blitz", "balik", "blinks", "well it's").
 */

// Primary and phonetic variations of BeliX / BliX wake words
const WAKE_WORD_PATTERNS = [
    // Primary names
    'blix',
    'belix',
    'bli x',
    'beli x',
    'b lix',
    'be lix',
    // Whisper speech-to-text phonetic misinterpretations
    'blitz',      // Very common Whisper transcription for "Blix"
    'balik',      // Common Whisper transcription for "BeliX"
    'blinks',     // Common Whisper transcription for "Blix"
    'blink',
    'well its',   // Common Whisper transcription for "BeliX"
    'well it s',
    'well it',
    'bellits',
    'belits',
    'belik',
    'pelix',
    'pelik',
    'bellix',
    'blik',
    'blex',
    'plix',
    'flix',
    'felix',
    'helix',
    'baylix',
    'bilix',
    'bliss',
    'blis',
    'alex'
];

// Common greeting prefixes
const PREFIXES = [
    'hey',
    'hi',
    'hello',
    'ok',
    'okay',
    'ay',
    'yo',
    'dei',
    'dai',
    'pa'
];

class WakeWordDetector {
    constructor(customWakeWords = []) {
        this.patterns = [...WAKE_WORD_PATTERNS, ...customWakeWords.map(w => w.toLowerCase())];
    }

    /**
     * Normalizes text by removing punctuation and collapsing spaces.
     * e.g., "Okay, blitz." -> "okay blitz"
     *       "well it's"     -> "well its"
     * @param {string} text
     * @returns {string}
     */
    normalize(text) {
        if (!text || typeof text !== 'string') return '';
        return text
            .toLowerCase()
            .replace(/['’]/g, '')                // Remove apostrophes ("it's" -> "its")
            .replace(/[^a-z0-9\s]/g, ' ')        // Replace remaining punctuation with space
            .replace(/\s+/g, ' ')               // Collapse whitespace
            .trim();
    }

    /**
     * Checks if text contains any recognized wake word.
     *
     * @param {string} text Spoken transcription
     * @returns {{ hasWakeWord: boolean, wakeWord: string|null, question: string }}
     */
    detect(text) {
        if (!text || typeof text !== 'string') {
            return { hasWakeWord: false, wakeWord: null, question: '' };
        }

        const normalized = this.normalize(text);
        if (!normalized) {
            return { hasWakeWord: false, wakeWord: null, question: '' };
        }

        // Sort patterns and prefixes by length descending so longer phrases match first
        const sorted = [...this.patterns].sort((a, b) => b.length - a.length);
        const prefixGroup = [...PREFIXES].sort((a, b) => b.length - a.length).join('|');

        for (const word of sorted) {
            const escapedWord = word.replace(/\s+/g, '\\s*');
            // Matches wake word with optional prefix (e.g. "okay blitz", "blitz", "hey balik")
            const regex = new RegExp(`\\b(?:(?:${prefixGroup})\\s+)?${escapedWord}\\b`, 'i');

            if (regex.test(normalized)) {
                // Remove the matched wake word and prefix from the question
                let question = normalized.replace(regex, ' ').replace(/\s+/g, ' ').trim();

                return {
                    hasWakeWord: true,
                    wakeWord: word,
                    question
                };
            }
        }

        return {
            hasWakeWord: false,
            wakeWord: null,
            question: normalized
        };
    }

    /**
     * Checks if text contains a wake word.
     * @param {string} text
     * @returns {boolean}
     */
    containsWakeWord(text) {
        return this.detect(text).hasWakeWord;
    }

    /**
     * Extracts question by stripping the wake word.
     * @param {string} text
     * @returns {string}
     */
    extractQuestion(text) {
        return this.detect(text).question;
    }

    /**
     * Helper to test if a question is an interruption or stop command.
     * Supports both English and Tanglish stop commands.
     * @param {string} text
     * @returns {boolean}
     */
    isInterruptionCommand(text) {
        if (!text) return false;
        const norm = this.normalize(text);
        const stopKeywords = [
            'stop',
            'be quiet',
            'shut up',
            'pause',
            'cancel',
            'hold on',
            'wait',
            'podhum',       // Tanglish: enough
            'niruva',       // Tanglish: stop
            'niruva pa',
            'podhum pa',
            'pesatha'       // Tanglish: don't speak
        ];
        return stopKeywords.some(keyword => norm.includes(keyword));
    }
}

const defaultDetector = new WakeWordDetector();

module.exports = {
    WakeWordDetector,
    defaultDetector,
    wakeWordDetector: defaultDetector
};
