/**
 * mentionHandler.js
 * Enables meeting participants to invite, control, and ask doubts to BeliX
 * simply by mentioning the bot in text chat (e.g. "@BeliX join", "@BeliX what is an API?").
 * When a doubt is asked in chat, BeliX generates the answer and REPLIES BY VOICE
 * in the active Discord voice channel!
 */

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { voiceSessionManager } = require('./voiceSessionManager');
const { groqVoice } = require('./groqVoice');
const { speechGenerator } = require('./speechGenerator');
const {
    isMemberInquiry,
    extractMemberQuery,
    detectStyleMode,
    generateMemberTanglishDescription
} = require('./memberKnowledgeEngine');

/**
 * Checks if the message content matches a join intent.
 * Handles: "@BeliX join", "join voice", "join vc", "please join", "come to voice", "come here", etc.
 * @param {string} text
 * @returns {boolean}
 */
function isJoinIntent(text) {
    const t = text.toLowerCase().trim();
    return /\b(join|connect|come\s*(to\s*voice|in|here|over)?|enter|hop\s*in)\b/i.test(t);
}

/**
 * Checks if the message content matches a leave intent.
 * Handles: "@BeliX leave", "disconnect", "bye", "leave vc", "exit"
 * @param {string} text
 * @returns {boolean}
 */
function isLeaveIntent(text) {
    const t = text.toLowerCase().trim();
    return /\b(leave|disconnect|exit|bye|quit|stop\s*meeting)\b/i.test(t);
}

/**
 * Checks if the message content matches a status intent.
 * @param {string} text
 * @returns {boolean}
 */
function isStatusIntent(text) {
    const t = text.toLowerCase().trim();
    return /\b(status|ping|state|info)\b/i.test(t);
}

/**
 * Checks if the message content matches a mute intent.
 * @param {string} text
 * @returns {boolean}
 */
function isMuteIntent(text) {
    const t = text.toLowerCase().trim();
    return /\b(mute|be\s*quiet|silence|shh)\b/i.test(t);
}

/**
 * Checks if the message content matches an unmute intent.
 * @param {string} text
 * @returns {boolean}
 */
function isUnmuteIntent(text) {
    const t = text.toLowerCase().trim();
    return /\b(unmute|speak|resume)\b/i.test(t);
}

/**
 * Checks if the message is explicitly asking for general help/guidelines.
 * @param {string} text
 * @returns {boolean}
 */
function isHelpIntent(text) {
    const t = text.toLowerCase().trim();
    return t === 'help' || t === 'commands' || t === 'how to use';
}

/**
 * Sets up the Discord messageCreate listener for bot mentions.
 * @param {import('discord.js').Client} client
 */
function setupMentionHandler(client) {
    client.on('messageCreate', async (message) => {
        // Ignore bots and direct messages
        if (message.author.bot || !message.guild) return;

        // Check if the bot was directly mentioned
        if (!message.mentions.has(client.user, { ignoreRoles: true, ignoreEveryone: true })) {
            return;
        }

        // Clean text: strip the bot mention (<@123456789> or <@!123456789>)
        const mentionRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
        const cleanText = message.content.replace(mentionRegex, '').trim();
        const speakerName = message.member?.displayName || message.author.username;

        // 1. EMPTY MENTION OR HELP INTENT
        if (cleanText === '' || isHelpIntent(cleanText)) {
            return message.reply({
                content: `👋 Hey **${speakerName}**! I'm **BeliX**, your AI voice meeting assistant.\n\n` +
                         `• **Invite to Voice:** Mention me: \`@BeliX join\` while you're in a voice channel.\n` +
                         `• **Ask Doubts in Voice:** Say **"Hey BeliX"** followed by your question in the voice channel!\n` +
                         `• **Ask Doubts in Chat:** Mention me here: \`@BeliX <your question>\` and I will **reply by voice** in the meeting!\n` +
                         `• **Disconnect:** Mention \`@BeliX leave\` when the meeting finishes.`
            });
        }

        // 2. JOIN INTENT (e.g. "@BeliX join", "@BeliX please join voice")
        if (isJoinIntent(cleanText)) {
            const voiceChannel = message.member?.voice?.channel;

            if (!voiceChannel) {
                return message.reply('⚠️ Please join a voice channel first, then mention me with **join** (e.g., `@BeliX join`) so I know which channel to join!');
            }

            // Check bot permissions in voice channel
            const permissions = voiceChannel.permissionsFor(client.user);
            if (!permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
                return message.reply(`❌ I don't have permission to **Connect** or **Speak** in **${voiceChannel.name}**. Please check my channel permissions.`);
            }

            const statusMsg = await message.reply(`🎙️ Joining **${voiceChannel.name}**...`);

            try {
                const session = await voiceSessionManager.joinSession(client, voiceChannel, message.channel);

                const embed = new EmbedBuilder()
                    .setColor('#2ecc71')
                    .setTitle('🎙️ BeliX Joined Voice Channel')
                    .setDescription(`Connected to **${voiceChannel.name}**!\nI'll introduce myself in voice momentarily.`)
                    .addFields(
                        { name: '🗣️ In Voice', value: 'Say **"Hey BeliX"** followed by your question.', inline: true },
                        { name: '💬 In Chat', value: 'Mention `@BeliX <question>` and I\'ll answer by voice!', inline: true },
                        { name: '👋 Leave', value: 'Mention `@BeliX leave` to disconnect', inline: true }
                    )
                    .setFooter({ text: 'BeliX Real-Time Voice Meeting Assistant' })
                    .setTimestamp();

                await statusMsg.edit({ content: null, embeds: [embed] });
            } catch (error) {
                console.error('Error joining via mention:', error);
                await statusMsg.edit({ content: `❌ Failed to join **${voiceChannel.name}**: ${error.message}` });
            }
            return;
        }

        // 3. LEAVE INTENT (e.g. "@BeliX leave", "@BeliX disconnect", "@BeliX bye")
        if (isLeaveIntent(cleanText)) {
            const session = voiceSessionManager.getSession(message.guild.id);
            if (!session) {
                return message.reply("ℹ️ I'm not currently connected to any voice channel in this server.");
            }

            const channelName = session.voiceChannel.name;
            voiceSessionManager.leaveSession(message.guild.id);

            const embed = new EmbedBuilder()
                .setColor('#e74c3c')
                .setTitle('👋 BeliX Disconnected')
                .setDescription(`Disconnected from **${channelName}**. The meeting session and temporary memory have been cleared.`)
                .setTimestamp();

            return message.reply({ embeds: [embed] });
        }

        // 4. MUTE INTENT (e.g. "@BeliX mute")
        if (isMuteIntent(cleanText)) {
            const session = voiceSessionManager.getSession(message.guild.id);
            if (!session) {
                return message.reply("⚠️ I'm not currently in a voice channel.");
            }
            session.setMute(true);
            return message.reply('🔇 Voice output muted. I will not speak into the voice channel until unmuted.');
        }

        // 5. UNMUTE INTENT (e.g. "@BeliX unmute")
        if (isUnmuteIntent(cleanText)) {
            const session = voiceSessionManager.getSession(message.guild.id);
            if (!session) {
                return message.reply("⚠️ I'm not currently in a voice channel.");
            }
            session.setMute(false);
            return message.reply('🔊 Voice output resumed. I am ready to answer your questions in voice!');
        }

        // 6. STATUS INTENT (e.g. "@BeliX status")
        if (isStatusIntent(cleanText)) {
            const session = voiceSessionManager.getSession(message.guild.id);
            if (!session) {
                return message.reply('📊 Status: **Idle** (Not in any voice channel. Mention me with **`join`** to start a voice meeting!)');
            }

            const s = session.getStatus();
            const embed = new EmbedBuilder()
                .setColor('#9b59b6')
                .setTitle('📊 Active Voice Session Status')
                .addFields(
                    { name: '🔊 Channel', value: `**${s.channelName}**`, inline: true },
                    { name: '📡 Connection State', value: `\`${s.connectionState}\``, inline: true },
                    { name: '⚙️ Mode', value: `\`${s.mode}\``, inline: true },
                    { name: '🎙️ Voice Output', value: s.isMuted ? '🔇 Muted' : (s.isSpeaking ? '🗣️ Speaking' : '🟢 Listening'), inline: true },
                    { name: '💬 Questions Answered', value: `${s.questionsAnswered}`, inline: true },
                    { name: '⏱️ Uptime', value: `${s.uptimeMinutes} min`, inline: true }
                )
                .setTimestamp();

            return message.reply({ embeds: [embed] });
        }

        // 7. USER ASKS A DOUBT / QUESTION VIA CHAT MENTION!
        // BeliX generates the answer and REPLIES BY NATURAL VOICE in the meeting channel!
        let session = voiceSessionManager.getSession(message.guild.id);

        // If BeliX is not yet in a voice channel, but the asking member is in one, auto-join!
        if (!session && message.member?.voice?.channel) {
            try {
                const targetChannel = message.member.voice.channel;
                const perms = targetChannel.permissionsFor(client.user);
                if (perms.has(PermissionFlagsBits.Connect) && perms.has(PermissionFlagsBits.Speak)) {
                    session = await voiceSessionManager.joinSession(client, targetChannel, message.channel);
                }
            } catch (joinErr) {
                console.warn('Auto-join voice channel on question failed:', joinErr.message);
            }
        }

        const thinkingMsg = await message.reply('🎙️ *Thinking... generating voice response for your meeting!*');

        try {
            // Feature 19: Check if message is inquiring about a Belmonts clan member
            // Supports typing the name (e.g. "who is Michael") OR directly mentioning the member (e.g. "@BeliX @Michael", "@BeliX @Michael pathi sollu")
            const otherUserMentioned = message.mentions.users.find(u => u.id !== client.user.id);
            const isMemberQuery = isMemberInquiry(cleanText) || Boolean(otherUserMentioned);

            if (isMemberQuery) {
                let memberQuery = extractMemberQuery(cleanText);
                if (!memberQuery && otherUserMentioned) {
                    memberQuery = otherUserMentioned.id;
                }
                const { mode, isMoreDetails } = detectStyleMode(cleanText);
                let memberResult = await generateMemberTanglishDescription(memberQuery, mode, isMoreDetails);

                // If not found by Discord ID, fallback to display name or username
                if ((!memberResult || !memberResult.member) && otherUserMentioned) {
                    const guildMember = message.guild?.members.cache.get(otherUserMentioned.id) ||
                        await message.guild?.members.fetch(otherUserMentioned.id).catch(() => null);
                    const nameFallback = guildMember?.displayName || otherUserMentioned.globalName || otherUserMentioned.username;
                    if (nameFallback) {
                        const fallbackResult = await generateMemberTanglishDescription(nameFallback, mode, isMoreDetails);
                        if (fallbackResult?.member) {
                            memberResult = fallbackResult;
                        }
                    }
                }

                const replyText = memberResult.text;
                const member = memberResult.member;

                if (session && !session.isMuted) {
                    if (session.audioPlayer.isSpeaking()) {
                        session.audioPlayer.stop();
                    }

                    // Convert Tanglish answer into natural voice audio
                    const { buffer } = await speechGenerator.generateSpeech(replyText);

                    // Speak the answer in the Discord voice channel
                    session.audioPlayer.enqueue(buffer, {
                        speakerName,
                        question: cleanText,
                        reply: replyText
                    });

                    // Record into meeting memory
                    session.conversation.addTurn(message.author.id, speakerName, cleanText, replyText);
                    session.questionsAnswered++;

                    const embed = new EmbedBuilder()
                        .setColor('#e67e22')
                        .setTitle(`🛡️ Belmonts Clan Member: ${member ? member.fullName : (memberQuery || cleanText)}`)
                        .setDescription(`**"${cleanText}"**\n\n🎙️ **BeliX (Speaking in #${session.voiceChannel.name}):**\n${replyText}`)
                        .addFields(
                            { name: '🎭 Mode', value: `\`${memberResult.mode}\``, inline: true },
                            { name: '🔰 Designation', value: member?.clanDesignation || 'Belmonts Member', inline: true }
                        );

                    if (member?.aliases && member.aliases.length > 0) {
                        embed.addFields({ name: '🏷️ Aliases / Nicknames', value: member.aliases.join(', '), inline: false });
                    }

                    if (member?.liveStats?.points !== undefined) {
                        embed.setFooter({ text: `Belmonts Points: ${member.liveStats.points} • Solved: ${member.liveStats.problemsSolved || 0} • Feature 19 Natural Tanglish` });
                    } else {
                        embed.setFooter({ text: 'BeliX Belmonts Clan Knowledge Engine • Feature 19' });
                    }
                    embed.setTimestamp();

                    return await thinkingMsg.edit({ content: null, embeds: [embed] });
                } else if (session && session.isMuted) {
                    const embed = new EmbedBuilder()
                        .setColor('#e67e22')
                        .setTitle(`🛡️ Belmonts Clan Member: ${member ? member.fullName : (memberQuery || cleanText)}`)
                        .setDescription(`**"${cleanText}"**\n\n💬 **BeliX:**\n${replyText}\n\n*(Note: Voice output is currently muted. Mention \`@BeliX unmute\` to enable voice speech)*`)
                        .addFields(
                            { name: '🎭 Mode', value: `\`${memberResult.mode}\``, inline: true },
                            { name: '🔰 Designation', value: member?.clanDesignation || 'Belmonts Member', inline: true }
                        );

                    if (member?.aliases && member.aliases.length > 0) {
                        embed.addFields({ name: '🏷️ Aliases / Nicknames', value: member.aliases.join(', '), inline: false });
                    }

                    if (member?.liveStats?.points !== undefined) {
                        embed.setFooter({ text: `Belmonts Points: ${member.liveStats.points} • Solved: ${member.liveStats.problemsSolved || 0} • Feature 19 Natural Tanglish` });
                    } else {
                        embed.setFooter({ text: 'BeliX Belmonts Clan Knowledge Engine • Feature 19' });
                    }
                    embed.setTimestamp();

                    return await thinkingMsg.edit({ content: null, embeds: [embed] });
                } else {
                    const embed = new EmbedBuilder()
                        .setColor('#e67e22')
                        .setTitle(`🛡️ Belmonts Clan Member: ${member ? member.fullName : (memberQuery || cleanText)}`)
                        .setDescription(`**"${cleanText}"**\n\n💬 **BeliX:**\n${replyText}\n\n💡 *Tip: Join a voice channel and mention \`@BeliX join\` to hear me speak my answers aloud in voice!*`)
                        .addFields(
                            { name: '🎭 Mode', value: `\`${memberResult.mode}\``, inline: true },
                            { name: '🔰 Designation', value: member?.clanDesignation || 'Belmonts Member', inline: true }
                        );

                    if (member?.aliases && member.aliases.length > 0) {
                        embed.addFields({ name: '🏷️ Aliases / Nicknames', value: member.aliases.join(', '), inline: false });
                    }

                    if (member?.liveStats?.points !== undefined) {
                        embed.setFooter({ text: `Belmonts Points: ${member.liveStats.points} • Solved: ${member.liveStats.problemsSolved || 0} • Feature 19 Natural Tanglish` });
                    } else {
                        embed.setFooter({ text: 'BeliX Belmonts Clan Knowledge Engine • Feature 19' });
                    }
                    embed.setTimestamp();

                    return await thinkingMsg.edit({ content: null, embeds: [embed] });
                }
            }

            const history = session ? session.conversation.getHistoryForPrompt() : '';
            const replyText = await groqVoice.answerQuestion(cleanText, speakerName, history);

            if (session && !session.isMuted) {
                // If BeliX is already speaking, interrupt to deliver the new answer
                if (session.audioPlayer.isSpeaking()) {
                    session.audioPlayer.stop();
                }

                // Convert text answer into natural human-like voice audio
                const { buffer } = await speechGenerator.generateSpeech(replyText);

                // Speak the answer in the Discord voice channel!
                session.audioPlayer.enqueue(buffer, {
                    speakerName,
                    question: cleanText,
                    reply: replyText
                });

                // Record into meeting memory for follow-up questions
                session.conversation.addTurn(message.author.id, speakerName, cleanText, replyText);
                session.questionsAnswered++;

                // Update text chat with the transcript
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setAuthor({ name: `${speakerName} asked:` })
                    .setDescription(`**"${cleanText}"**\n\n🎙️ **BeliX (Speaking in #${session.voiceChannel.name}):**\n${replyText}`)
                    .setFooter({ text: `Speaking via voice • Questions answered: ${session.questionsAnswered}` })
                    .setTimestamp();

                await thinkingMsg.edit({ content: null, embeds: [embed] });
            } else if (session && session.isMuted) {
                // BeliX is in voice channel but muted
                const embed = new EmbedBuilder()
                    .setColor('#e67e22')
                    .setAuthor({ name: `${speakerName} asked:` })
                    .setDescription(`**"${cleanText}"**\n\n💬 **BeliX:**\n${replyText}\n\n*(Note: Voice output is currently muted. Mention \`@BeliX unmute\` to enable voice speech)*`)
                    .setTimestamp();

                await thinkingMsg.edit({ content: null, embeds: [embed] });
            } else {
                // Not in voice channel
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setAuthor({ name: `${speakerName} asked:` })
                    .setDescription(`**"${cleanText}"**\n\n💬 **BeliX:**\n${replyText}\n\n💡 *Tip: Join a voice channel and mention \`@BeliX join\` to hear me speak my answers aloud in voice!*`)
                    .setTimestamp();

                await thinkingMsg.edit({ content: null, embeds: [embed] });
            }
        } catch (err) {
            console.error('Error answering chat mention doubt:', err);
            await thinkingMsg.edit({
                content: `❌ Sorry ${speakerName}, I encountered an issue processing your doubt: ${err.message}`
            });
        }
    });
}

module.exports = {
    setupMentionHandler,
    isJoinIntent,
    isLeaveIntent,
    isStatusIntent,
    isMuteIntent,
    isUnmuteIntent,
    isHelpIntent
};
