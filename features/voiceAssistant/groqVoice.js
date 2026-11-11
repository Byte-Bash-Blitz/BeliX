/**
 * groqVoice.js (AI Engine)
 * Exclusively uses Groq API for real-time speech understanding, transcription (Whisper),
 * technical reasoning, and voice meeting interactions (Llama 3.3 / GPT-OSS 120B).
 * Zero Gemini models or dependencies.
 */

const fs = require('fs');
const path = require('path');
const { Groq, toFile } = require('groq-sdk');
const { wakeWordDetector } = require('./wakeWordDetector');

// Load instructions persona
let systemInstructions = '';
try {
    const instructionsPath = path.join(__dirname, '../../prompts/botInstructions.txt');
    if (fs.existsSync(instructionsPath)) {
        systemInstructions = fs.readFileSync(instructionsPath, 'utf8');
    }
} catch (e) {
    console.warn('Could not read botInstructions.txt, using built-in defaults:', e.message);
}

if (!systemInstructions) {
    systemInstructions = 'You are BeliX, an AI voice meeting assistant powered by Groq. Respond conversationally, concisely (2-4 sentences max), with zero markdown symbols.';
}

class GroqVoice {
    constructor() {
        this.apiKey = (process.env.GROQ_API_KEY || '').trim();
        this.model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
        this.whisperModel = process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3';

        this.groq = this.apiKey ? new Groq({ apiKey: this.apiKey }) : null;
    }

    /**
     * Checks if Groq API key is configured.
     * @returns {boolean}
     */
    isConfigured() {
        return !!(this.apiKey && this.apiKey.length > 5);
    }

    /**
     * Returns human-readable provider name.
     * @returns {string}
     */
    getProviderName() {
        return 'Groq';
    }

    /**
     * Executes chat completion with automatic candidate fallback if a model is unavailable.
     *
     * @param {Array<{role: string, content: string}>} messages
     * @param {number} max_tokens
     * @param {number} temperature
     * @returns {Promise<string>}
     */
    async _chatWithFallback(messages, max_tokens = 800, temperature = 0.6) {
        if (!this.groq) {
            throw new Error('GROQ_API_KEY is not configured in .env file.');
        }

        const candidateModels = [
            this.model,
            'openai/gpt-oss-120b',
            'qwen/qwen3.8-27b',
            'openai/gpt-oss-20b',
            'llama-3.3-70b-versatile',
            'llama-3.1-8b-instant'
        ];
        const modelsToTry = [...new Set(candidateModels.filter(Boolean))];

        let lastError = null;
        for (const m of modelsToTry) {
            try {
                const completion = await this.groq.chat.completions.create({
                    model: m,
                    messages,
                    max_tokens,
                    temperature
                });

                if (this.model !== m) {
                    console.log(`✓ Switched Groq model to active candidate: ${m}`);
                    this.model = m;
                }

                const choice = completion.choices?.[0];
                const reply = choice?.message?.content?.trim();
                return reply || '';
            } catch (err) {
                lastError = err;
                // If model not found or forbidden, try next candidate model
                if (err.status === 404 || (err.message && (err.message.includes('does not exist') || err.message.includes('model_not_found')))) {
                    console.warn(`Groq model ${m} not accessible, trying next candidate...`);
                    continue;
                }
                throw err;
            }
        }
        throw lastError;
    }

    /**
     * Performs a diagnostic test against the Groq API.
     * @returns {Promise<{ success: boolean, provider: string, model: string, latencyMs: number, message: string, isQuotaExceeded?: boolean }>}
     */
    async testConnection() {
        if (!this.isConfigured()) {
            return {
                success: false,
                provider: 'Groq',
                model: this.model,
                latencyMs: 0,
                message: 'GROQ_API_KEY is not configured in .env file.'
            };
        }

        const start = Date.now();
        try {
            const text = await this._chatWithFallback([
                { role: 'system', content: 'You are a diagnostic probe. Reply in 5 words.' },
                { role: 'user', content: 'Ping test.' }
            ], 25, 0.1);

            const latencyMs = Date.now() - start;

            return {
                success: true,
                provider: 'Groq',
                model: this.model,
                latencyMs,
                message: text || 'Groq connection successful.'
            };
        } catch (error) {
            const latencyMs = Date.now() - start;
            const errMsg = error.message || String(error);
            const isQuota = errMsg.includes('429') || errMsg.includes('rate_limit') || errMsg.includes('quota');

            return {
                success: false,
                provider: 'Groq',
                model: this.model,
                latencyMs,
                isQuotaExceeded: isQuota,
                message: errMsg
            };
        }
    }

    /**
     * Generates a natural dynamic voice introduction for BeliX upon joining a voice channel.
     *
     * @param {string} meetingName Name of the voice channel or topic
     * @returns {Promise<string>} Clean speech introduction
     */
    async generateIntroduction(meetingName = 'General Meeting') {
        const fallbackIntro = "Vanakkam ellarukkum! Naan BeliX, unga AI meeting assistant. Meeting-la programming, coding, or technical doubts edhavadhu irundha, Hey BeliX nu solli kelunga, naan voice-la reply panren. Let's have a great meeting!";

        if (!this.isConfigured()) return fallbackIntro;

        try {
            const prompt = `You are BeliX, an AI voice meeting assistant joining a Discord voice channel for "${meetingName}".
Generate a brief, warm, natural spoken introduction (2 to 3 sentences maximum).
LANGUAGE: You must speak ONLY in natural, friendly Tanglish (Tamil words written in English letters with English tech terms).
Explain that participants can ask technical questions or brainstorm by saying "Hey BeliX" or "Hey Blix" followed by their question, or by mentioning @BeliX in chat, and you will answer in voice.
CRITICAL: Speak directly. Do NOT use markdown symbols, asterisks, bullet points, or emojis. Use punctuation for natural speech pauses.`;

            const text = await this._chatWithFallback([
                { role: 'system', content: systemInstructions },
                { role: 'user', content: prompt }
            ], 600, 0.7);

            if (text && text.length > 20) {
                return text.replace(/[*_#`~]/g, '');
            }
            return fallbackIntro;
        } catch (err) {
            console.warn('Groq dynamic intro generation failed, using fallback:', err.message);
            return fallbackIntro;
        }
    }

    /**
     * Answers a participant doubt (from chat mention or voice question) using Groq.
     * Always speaks exclusively in natural Tanglish.
     *
     * @param {string} question The user question or doubt
     * @param {string} speakerName Name of the asking member
     * @param {string} conversationHistory Recent meeting dialogue
     * @returns {Promise<string>} Crisp spoken response in Tanglish (2-3 sentences max, zero markdown)
     */
    /**
     * Answers a participant's question or doubt in natural spoken Tanglish.
     * Incorporates previous conversation turns, recognized speaker memory, and channel chat context.
     *
     * @param {string} question The question asked
     * @param {string} speakerName Name of the person asking
     * @param {string} conversationHistory Recent meeting or text turns
     * @param {object} extraContext Additional context (channelRecentChat, speakerProfile, etc.)
     * @returns {Promise<string>} Direct spoken Tanglish answer
     */
    async answerQuestion(question, speakerName = 'Participant', conversationHistory = '', extraContext = {}) {
        if (!this.isConfigured()) {
            return `Unga question "${question}" vandhuchu, aana GROQ_API_KEY bot config-la illai. Please add pannunga.`;
        }

        // Feature 19: Check if question is asking about a Belmonts clan member
        try {
            const { isMemberInquiry, extractMemberQuery, detectStyleMode, generateMemberTanglishDescription } = require('./memberKnowledgeEngine');
            if (isMemberInquiry(question)) {
                const memberQuery = extractMemberQuery(question);
                if (memberQuery) {
                    const { mode, isMoreDetails } = detectStyleMode(question);
                    const memberResult = await generateMemberTanglishDescription(memberQuery, mode, isMoreDetails);
                    if (memberResult && memberResult.text) {
                        return memberResult.text;
                    }
                }
            }
        } catch (memberErr) {
            console.warn('Member inquiry check error in answerQuestion:', memberErr.message);
        }

        const speakerBio = extraContext.speakerProfile ? `Speaker Profile Knowledge: ${extraContext.speakerProfile.fullName} (${extraContext.speakerProfile.clanDesignation || 'Belmonts Clan Member'})${extraContext.speakerProfile.bio ? ' - ' + extraContext.speakerProfile.bio : ''}` : '';
        const recentChatContext = extraContext.channelRecentChat ? `Recent Channel Chat History (what participants were discussing):\n${extraContext.channelRecentChat}` : '';

        const prompt = `Context:
${speakerBio ? speakerBio + '\n' : ''}Participant: "${speakerName}" has called you and asked this question:
"${question}"

${recentChatContext ? recentChatContext + '\n' : ''}Previous Conversation Memory with BeliX:
${conversationHistory || 'None yet.'}

Provide a direct, conversational, natural answer in Tanglish.
You know this participant and remember previous conversation context. Speak to them warmly and intelligently like a helpful teammate who remembers everything!
STRICT LANGUAGE REQUIREMENT:
You must speak ONLY in natural, fluent Tanglish (Tamil words written in English letters / Latin alphabet mixed with English technical terms).
Never reply in pure English. Never use Tamil unicode script. Use everyday spoken Tamil words in English script (e.g. "pa", "na", "ithu", "panna use aagum", "simple-ah sollanum na").

RULES:
1. 2 to 3 sentences maximum.
2. Be direct, helpful, and technically accurate.
3. Absolutely NO markdown syntax (no asterisks, backticks, bold, headers, code blocks, or bullets).
4. Use natural commas and periods so speech pauses sound human.`;

        try {
            const reply = await this._chatWithFallback([
                { role: 'system', content: systemInstructions },
                { role: 'user', content: prompt }
            ], 800, 0.6);

            if (!reply) {
                return `Sorry ${speakerName}, ennala ippo answer generate panna mudiyala. Innoru vaati kelunga.`;
            }

            return reply.replace(/[*_#`~]/g, '').trim();
        } catch (err) {
            console.error('Groq answerQuestion error:', err.message);
            if (err.message && (err.message.includes('429') || err.message.includes('rate_limit'))) {
                return `Sorry ${speakerName}, Groq API rate limit momentary-ah reach aayiduchu. Oru few seconds kazhichu kelunga.`;
            }
            throw err;
        }
    }

    /**
     * Transcribes an incoming 16kHz mono WAV buffer using Groq Whisper.
     *
     * @param {Buffer} wavBuffer 16kHz mono WAV buffer
     * @returns {Promise<string>} Transcribed text
     */
    async transcribeAudio(wavBuffer) {
        if (!this.isConfigured() || !wavBuffer || wavBuffer.length === 0) {
            return '';
        }

        const whisperModels = [this.whisperModel, 'whisper-large-v3', 'whisper-large-v3-turbo'];
        const uniqueWhisper = [...new Set(whisperModels.filter(Boolean))];

        for (const wm of uniqueWhisper) {
            try {
                const file = await toFile(wavBuffer, 'speech.wav', { type: 'audio/wav' });
                const transcription = await this.groq.audio.transcriptions.create({
                    file,
                    model: wm,
                    response_format: 'json',
                    temperature: 0.0
                });

                return (transcription.text || '').trim();
            } catch (err) {
                if (err.status === 404 || (err.message && err.message.includes('does not exist'))) {
                    continue;
                }
                console.warn('Groq Whisper audio transcription failed:', err.message);
                return '';
            }
        }
        return '';
    }

    /**
     * Process an incoming speech WAV buffer from a meeting participant.
     * Complete pipeline: Groq Whisper STT -> Wake word detection -> Groq LLM.
     *
     * @param {Buffer} wavBuffer 16kHz mono WAV buffer
     * @param {string} speakerName Name of the speaking member
     * @param {string} conversationHistory Recent meeting turns
     * @param {string} mode 'wake-word' or 'active-meeting'
     * @returns {Promise<{ transcript: string, hasWakeWord: boolean, shouldRespond: boolean, reply: string, question: string }>}
     */
    async processParticipantAudio(wavBuffer, speakerName = 'Participant', conversationHistory = '', mode = 'wake-word') {
        if (!this.isConfigured()) {
            throw new Error('GROQ_API_KEY is not configured in environment variables.');
        }

        // 1. Transcribe speech using Groq Whisper (ultra-fast STT)
        const transcript = await this.transcribeAudio(wavBuffer);
        if (!transcript || transcript.length < 2) {
            return { transcript: '', hasWakeWord: false, shouldRespond: false, reply: '', question: '' };
        }

        // 2. Check for interruption commands (e.g. "Hey BeliX stop", "BeliX shut up")
        if (wakeWordDetector.isInterruptionCommand(transcript)) {
            return {
                transcript,
                hasWakeWord: true,
                shouldRespond: false,
                reply: '',
                question: 'stop',
                isInterruption: true
            };
        }

        // 3. Check for wake words ("Hey BliX", "BliX", "Hey BeliX", "BeliX")
        const hasWakeWord = wakeWordDetector.containsWakeWord(transcript);
        const isActiveMeeting = mode === 'active-meeting';

        // In wake-word mode: strict silence unless wake word was spoken
        if (!hasWakeWord && !isActiveMeeting) {
            return {
                transcript,
                hasWakeWord: false,
                shouldRespond: false,
                reply: '',
                question: ''
            };
        }

        // 4. Extract question
        const question = wakeWordDetector.extractQuestion(transcript) || transcript;

        // If user only said the wake word without question (e.g. "Okay blitz", "Blinks", "Hey Blix")
        if (!question || question.length < 2) {
            return {
                transcript,
                hasWakeWord: true,
                shouldRespond: true,
                reply: `Sollinga ${speakerName}, naan kekuren! Enna doubt ungalukku?`,
                question: 'Wake word greeting'
            };
        }

        // 5. Generate conversational response using Groq
        const reply = await this.answerQuestion(question, speakerName, conversationHistory);

        return {
            transcript,
            hasWakeWord,
            shouldRespond: true,
            reply,
            question
        };
    }
}

module.exports = {
    GroqVoice,
    groqVoice: new GroqVoice()
};
