const { getMemberByDiscordID, getMemberByDiscordUsername, getLastPointUpdate, addPoints, incrementProblemsSolved } = require('../database/db');
const { TIMEZONE } = require('../utils/timezoneUtils');

const VIBE_CODING_CHANNEL_ID = '1362052133570220123';
const MOTIVATION_MESSAGE = '💪 Keep going! Errors are part of learning. Fix it and try again!';
const BASHER_ROLE_NAME = (process.env.BASHER_ROLE_NAME || 'basher').trim().toLowerCase();

// Helper function to log unfound members to JSON file
function normalizeRoleName(name) {
    return String(name || '').trim().toLowerCase();
}

async function isBasherMember(guild, userId, username) {
    const databaseMember = await getMemberByDiscordID(userId) || await getMemberByDiscordUsername(username);
    if (databaseMember && normalizeRoleName(databaseMember.role) === BASHER_ROLE_NAME) {
        return true;
    }

    if (guild) {
        try {
            const member = await guild.members.fetch(userId);
            if (member) {
                const hasRole = member.roles.cache.some((role) => normalizeRoleName(role.name) === BASHER_ROLE_NAME);
                if (hasRole) return true;
            }
        } catch (error) {
            console.error('Error checking basher role:', error.message);
        }
    }

    return false;
}

function getTodayKey() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

module.exports = {
    handleProgressUpdate: (client) => {
        client.on('messageCreate', async (message) => {

            // Only process messages from "I Run Code" bot in vibe-coding channel
            if (message.author.bot && 
                message.author.username === 'I Run Code' && 
                message.channel?.id === VIBE_CODING_CHANNEL_ID) {
                
                const isSuccessOutput = message.content.includes('Here is your ') &&
                    message.content.includes(' output') &&
                    !message.content.includes('error output');
                const isErrorOutput = message.content.includes('error output') ||
                    message.content.includes('I only received ');

                if (isErrorOutput) {
                    const mentionedUser = message.mentions.users.first();
                    if (mentionedUser) {
                        try {
                            await message.reply({
                                content: `👋 <@${mentionedUser.id}> ${MOTIVATION_MESSAGE}`,
                            });
                        } catch (error) {
                            console.error('Could not send motivation reply:', error.message);
                        }
                    }
                    return;
                }

                // Check if message contains "Here is your <language>(...) output"
                if (isSuccessOutput) {
                    
                    // Get the mentioned user from the message
                    const mentionedUser = message.mentions.users.first();
                    
                    if (mentionedUser) {
                        const userId = mentionedUser.id;
                        const username = mentionedUser.username;
                        const pointsToAward = 5; // 5 points for successful code execution
                        
                        const todayKey = getTodayKey();
                        const existingMember = await getMemberByDiscordID(userId) || await getMemberByDiscordUsername(username);
                        let newPoints = null;

                        if (existingMember) {
                            const memberId = String(existingMember.member_id);
                            const lastAwardedAt = await getLastPointUpdate(memberId);
                            const lastAwardedDate = lastAwardedAt ? new Intl.DateTimeFormat('en-CA', {
                                timeZone: TIMEZONE,
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                            }).format(new Date(lastAwardedAt)) : null;

                            if (lastAwardedDate === todayKey) {
                                try {
                                    await message.reply({
                                        content: `✅ <@${userId}> You already earned today's **+${pointsToAward} points**. Keep solving and come back tomorrow!`,
                                    });
                                } catch (error) {
                                    console.error('Could not send daily limit reply:', error.message);
                                }
                                return;
                            }

                            newPoints = await addPoints(existingMember.member_id, pointsToAward);
                            if (newPoints !== null) {
                                await incrementProblemsSolved(existingMember.member_id);
                            }
                        } else {
                            console.warn(`Member not found in database for successful code output: ${username} (${userId})`);
                            return;
                        }
                        
                        // Reply to acknowledge
                        try {
                            const totalLabel = newPoints !== null ? newPoints : '(updating)';
                            await message.reply({
                                content: `🎉 <@${userId}> earned **+${pointsToAward} points** for running code successfully! Total: **${totalLabel}**`
                            });
                        } catch (error) {
                            console.error('Could not send reply:', error.message);
                        }
                    }
                }
            }
        });
    }
};
