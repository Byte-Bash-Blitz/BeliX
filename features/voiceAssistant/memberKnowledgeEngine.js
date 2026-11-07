/**
 * memberKnowledgeEngine.js
 * Feature 19: Natural Tanglish Member Description Engine
 *
 * Dynamically queries member profiles from the database and generates
 * friendly, funny, engaging 3-4 line conversational Tanglish introductions
 * for both text chat and real-time voice playback.
 * Never hardcodes individual member descriptions inside prompts.
 */

const { getMemberKnowledge, getAllMemberKnowledge } = require('../../database/db');
const { groqVoice } = require('./groqVoice');

// Patterns that identify member inquiries in English and Tanglish
const MEMBER_INQUIRY_PATTERNS = [
    /\b(?:who\s+is|who's|tell\s+me\s+about|know\s+about|details\s+about|info\s+about|explain\s+about)\s+(.+)/i,
    /(.+?)\s+(?:yaaru|yaar|pathi\s+sollu|pathi\s+sollunga|pathi\s+explain\s+pannu|details|profile|bio)\b/i,
    /\b(?:do\s+you\s+know|do\s+u\s+know|tell\s+about)\s+(.+)/i
];

/**
 * Checks if a given input text is asking about a clan member.
 *
 * @param {string} text
 * @returns {boolean}
 */
function isMemberInquiry(text) {
    if (!text || typeof text !== 'string') return false;
    const clean = text.toLowerCase().trim();

    // 1. Direct Discord user mention (e.g. <@123456789> or <@!123456789>)
    if (/<@!?([0-9]{15,22})>/.test(clean)) {
        return true;
    }

    // 2. Check regex patterns (e.g. "who is Michael", "Samuvel pathi sollu")
    for (const pattern of MEMBER_INQUIRY_PATTERNS) {
        if (pattern.test(clean)) return true;
    }

    // 3. Check if inquiry contains any known member name, nickname, or username
    const allMembers = getAllMemberKnowledge();
    for (const m of allMembers) {
        const names = [m.fullName, ...(m.aliases || []), m.discordUsername, m.discordId].filter(Boolean).map(n => n.toLowerCase());
        for (const name of names) {
            if (clean.includes(name) && (
                clean === name ||
                /\b(who|about|tell|know|yaaru|yaar|pathi|sollu|profile|info|details|explain|member)\b/i.test(clean)
            )) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Extracts candidate member name/query from inquiry text.
 *
 * @param {string} text
 * @returns {string|null}
 */
function extractMemberQuery(text) {
    if (!text) return null;
    const clean = text.trim();

    // 1. If text contains a Discord mention, extract the user ID
    const mentionMatch = clean.match(/<@!?([0-9]{15,22})>/);
    if (mentionMatch) {
        return mentionMatch[1];
    }

    // 2. Try regex extractions
    for (const pattern of MEMBER_INQUIRY_PATTERNS) {
        const match = clean.match(pattern);
        if (match && match[1]) {
            let extracted = match[1]
                .replace(/[?,.!]/g, '')
                .replace(/\b(please|bro|pa|konjam|dost|can\s+you|more|details|funny|professional)\b/gi, '')
                .trim();
            if (extracted.length > 1) return extracted;
        }
    }

    // 3. Direct match against known member database
    const allMembers = getAllMemberKnowledge();
    const lower = clean.toLowerCase();
    for (const m of allMembers) {
        const names = [m.fullName, ...(m.aliases || []), m.discordUsername].filter(Boolean);
        for (const name of names) {
            if (lower.includes(name.toLowerCase())) {
                return name;
            }
        }
    }

    return null;
}

/**
 * Detects response mode requested by the user: 'funny', 'professional', or 'combined' (default).
 * Also detects if user asked for extra details ('tell_me_more').
 *
 * @param {string} text
 * @returns {{ mode: 'funny'|'professional'|'combined', isMoreDetails: boolean }}
 */
function detectStyleMode(text) {
    if (!text) return { mode: 'combined', isMoreDetails: false };
    const lower = text.toLowerCase();

    const isMoreDetails = /\b(tell\s+me\s+more|more\s+details|in\s+depth|elaborate|full\s+details|extra\s+info|deep\s+dive)\b/i.test(lower);

    if (/\b(professional|professionally|career|work\s+only|no\s+jokes|serious)\b/i.test(lower)) {
        return { mode: 'professional', isMoreDetails };
    }

    if (/\b(funny|joke|comedy|roast|fun|kalaai|comedy-ah)\b/i.test(lower)) {
        return { mode: 'funny', isMoreDetails };
    }

    return { mode: 'combined', isMoreDetails };
}

/**
 * Generates dynamic 3-4 line conversational Tanglish description for a clan member.
 *
 * @param {string|number} query Name, alias, or ID of member
 * @param {'funny'|'professional'|'combined'} [modeOverride]
 * @param {boolean} [moreDetailsOverride]
 * @returns {Promise<{ text: string, member: Object|null, mode: string, isMoreDetails: boolean }>}
 */
async function generateMemberTanglishDescription(query, modeOverride = null, moreDetailsOverride = null) {
    const member = await getMemberKnowledge(query);

    if (!member) {
        return {
            text: `Ayyayo, "${query}" ngra member namma Belmonts clan database-la kedaikkala pa. Correct name or nickname solli kelunga, naan explain panren!`,
            member: null,
            mode: modeOverride || 'combined',
            isMoreDetails: Boolean(moreDetailsOverride)
        };
    }

    const mode = modeOverride || 'combined';
    const isMoreDetails = Boolean(moreDetailsOverride);

    // Prepare dynamic database payload for AI
    const profilePayload = {
        fullName: member.fullName,
        nicknames: member.aliases,
        clanDesignation: member.clanDesignation,
        team: member.team,
        professionalDescription: member.professionalDescription,
        responsibilities: member.responsibilities,
        funnyPersonality: member.funnyPersonality,
        achievements: member.achievements,
        liveStats: member.liveStats
    };

    let modeInstruction = '';
    if (mode === 'professional') {
        modeInstruction = 'PROFESSIONAL MODE: Focus strictly on their designation, team, responsibilities, and achievements. Avoid jokes or playful roasting. Keep it respectful, encouraging, and career-oriented.';
    } else if (mode === 'funny') {
        modeInstruction = 'FUNNY MODE: Lean heavily into their stored funny personality and humorous quirks. Make it playful, funny, and entertaining like a good college friend talking about them.';
    } else {
        modeInstruction = 'COMBINED MODE (Default): Mix their clan role and professional contributions naturally with their friendly humour and funny personality.';
    }

    const detailInstruction = isMoreDetails
        ? 'MORE DETAILS REQUESTED: Provide 4 to 5 detailed conversational lines including their live stats, batch, points, and specific projects from the database.'
        : 'LENGTH CONTROL: Exactly 3 to 4 short, punchy conversational lines. Do not make it longer.';

    const systemPrompt = `You are BeliX, an AI voice meeting assistant and proud fellow member of the Belmonts clan.
Your task is to introduce and explain clan members to others in natural, authentic Tanglish (Tamil + English mixed).

CRITICAL LANGUAGE RULES:
1. Speak ONLY in natural, casual spoken Tanglish (Tamil words written in English letters / Latin alphabet mixed with English technical terms).
2. NEVER use pure formal Tamil or Tamil unicode script.
3. NEVER reply in pure English. Mix Tamil and English naturally like real Chennai / Tamil Nadu college teammates talking to each other.
4. Use natural clan phrasing (e.g. "namma clan-oda", "ivar kitta", "ivanga", "dhaan", "romba important", "full-ah", "edhavadhu", "pola", "pa", "bro").
5. Do NOT use identical templates for every member. Keep each person's unique vibe distinct!
6. Use emojis occasionally when appropriate (e.g. 😂, 😎, 🤣, 👏).
7. ABSOLUTELY ZERO markdown symbols in the response. No asterisks (*bold*), no hash headers (###), no bullet points (-). Output plain text ready for voice speech synthesis!
8. Do NOT invent missing facts. Use ONLY what is verified in the database record.`;

    const userPrompt = `DATABASE RECORD:
${JSON.stringify(profilePayload, null, 2)}

OPERATING MODE:
${modeInstruction}

${detailInstruction}

Generate a natural, friendly 3-4 line Tanglish explanation for ${member.fullName}:`;

    try {
        const response = await groqVoice._chatWithFallback([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ], 600, 0.7);

        // Strip any residual markdown
        const cleanText = (response || '')
            .replace(/[*_#`~]/g, '')
            .replace(/^[-*+]\s+/gm, '')
            .trim();

        return {
            text: cleanText,
            member,
            mode,
            isMoreDetails
        };
    } catch (err) {
        console.error('Error generating member Tanglish description:', err.message);

        // Fallback using stored database description directly if AI call fails
        let fallback = '';
        if (mode === 'funny' && member.funnyPersonality) {
            fallback = member.funnyPersonality;
        } else if (member.funnyPersonality && mode === 'combined') {
            fallback = `${member.fullName} namma clan-oda ${member.clanDesignation}! ${member.funnyPersonality}`;
        } else {
            fallback = `${member.fullName} namma Belmonts clan-oda ${member.clanDesignation}! ${member.professionalDescription} Clan tasks and responsibilities-la romba active-ah participate pannuvaanga.`;
        }

        return {
            text: fallback,
            member,
            mode,
            isMoreDetails
        };
    }
}

module.exports = {
    isMemberInquiry,
    extractMemberQuery,
    detectStyleMode,
    generateMemberTanglishDescription
};

