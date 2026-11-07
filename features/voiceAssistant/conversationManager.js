/**
 * conversationManager.js
 * In-memory rolling meeting conversation context.
 * Tracks questions, answers, and speakers so Groq understands follow-up inquiries.
 * Does NOT persist audio to disk. Automatically cleared when meeting ends.
 */

class ConversationManager {
    /**
     * @param {number} maxTurns Maximum turns to keep in memory (default 10)
     */
    constructor(maxTurns = 10) {
        this.maxTurns = maxTurns;
        this.turns = [];
        this.participants = new Map(); // userId -> { username, displayName, messageCount }
        this.startedAt = new Date();
    }

    /**
     * Adds an exchange to the conversation history.
     *
     * @param {string} speakerId
     * @param {string} speakerName
     * @param {string} question
     * @param {string} answer
     */
    addTurn(speakerId, speakerName, question, answer) {
        if (!question && !answer) return;

        this.turns.push({
            speakerId,
            speakerName: speakerName || 'Participant',
            question: question?.trim() || '',
            answer: answer?.trim() || '',
            timestamp: new Date().toISOString()
        });

        // Keep only the most recent N turns
        if (this.turns.length > this.maxTurns) {
            this.turns.shift();
        }

        // Track participant metadata
        const existing = this.participants.get(speakerId) || {
            username: speakerName,
            displayName: speakerName,
            questionCount: 0
        };
        existing.questionCount++;
        this.participants.set(speakerId, existing);
    }

    /**
     * Formats recent conversation history into a structured prompt context for Groq.
     * @returns {string}
     */
    getHistoryForPrompt() {
        if (this.turns.length === 0) {
            return 'No previous conversation in this meeting yet.';
        }

        return this.turns
            .map((t, idx) => `[Turn ${idx + 1}] ${t.speakerName}: "${t.question}"\nBeliX: "${t.answer}"`)
            .join('\n\n');
    }

    /**
     * Returns total questions asked in this meeting.
     * @returns {number}
     */
    getTotalTurns() {
        return this.turns.length;
    }

    /**
     * Returns list of participants who have spoken or asked questions.
     * @returns {Array<{ speakerId: string, displayName: string, questionCount: number }>}
     */
    getParticipantsSummary() {
        return Array.from(this.participants.entries()).map(([id, meta]) => ({
            speakerId: id,
            displayName: meta.displayName,
            questionCount: meta.questionCount
        }));
    }

    /**
     * Resets/clears the temporary conversation history.
     */
    clear() {
        this.turns = [];
        this.participants.clear();
        this.startedAt = new Date();
    }
}

module.exports = { ConversationManager };

