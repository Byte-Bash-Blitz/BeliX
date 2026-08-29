const { EmbedBuilder } = require('discord.js');
const { getDelayUntilNextScheduledTime } = require('../utils/timezoneUtils');

// Channel IDs
const VIBE_CODING_CHANNEL_ID = process.env['vibe-coding'] || '1362052133570220123';
const REPORTS_CHANNEL_ID = '1475575831601610862';
const BELMONTS_ROLE_ID = '1307057022453153813';

const REPORT_HOUR = 11; // 11 PM
const REPORT_MINUTE = 45; // 50 minutes

/**
 * Get today's date as string (YYYY-MM-DD)
 */
function getTodayDateString() {
    const today = new Date();
    return today.toISOString().split('T')[0];
}

/**
 * Fetch and analyze vibe-coding messages from today
 */
async function fetchTodaysCodingMessages(client) {
    try {
        const channel = client.channels.cache.get(VIBE_CODING_CHANNEL_ID);
        if (!channel || !channel.isTextBased()) {
            console.warn(`⚠ Vibe-coding channel not found`);
            return null;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        let allMessages = [];
        let lastMessageId = null;

        // Fetch messages in batches
        while (true) {
            const options = { limit: 100 };
            if (lastMessageId) {
                options.before = lastMessageId;
            }

            const messages = await channel.messages.fetch(options);
            if (messages.size === 0) break;

            // Filter messages from today
            const todayMessages = messages.filter(msg => {
                const msgDate = new Date(msg.createdTimestamp);
                return msgDate >= today && msgDate < tomorrow;
            });

            allMessages = [...allMessages, ...todayMessages.values()];

            // Stop if we've gone past today
            const oldestMessage = messages.last();
            if (new Date(oldestMessage.createdTimestamp) < today) {
                break;
            }

            lastMessageId = messages.last().id;
        }

        return allMessages;
    } catch (error) {
        console.error(`Error fetching today's coding messages:`, error.message);
        return null;
    }
}

/**
 * Build daily vibe-coding report
 */
async function buildDailyVibeCodeReport(client) {
    try {
        const messages = await fetchTodaysCodingMessages(client);
        
        if (!messages || messages.length === 0) {
            console.log(`ℹ️ No vibe-coding messages found for today`);
            return null;
        }

        // Get all responses (non-bot messages)
        const responses = messages.filter(msg => !msg.author.bot && msg.content.length > 0);

        if (responses.length === 0) {
            console.log(`ℹ️ No responses found for today`);
            return null;
        }

        // Collect unique solvers with their message count
        const solvers = {};
        const solverOrder = []; // To maintain order of first appearance

        responses.forEach(msg => {
            const userId = msg.author.id;
            const displayName = msg.member?.displayName || msg.author.username;
            
            if (!solvers[userId]) {
                solvers[userId] = {
                    name: displayName,
                    count: 0
                };
                solverOrder.push(userId);
            }
            solvers[userId].count++;
        });

        // Build embed
        const embed = new EmbedBuilder()
            .setColor('#FF6B9D')
            .setTitle(`📊 Daily Vibe-Code Report - ${new Date().toLocaleDateString()}`)
            .setDescription(`Summary of today's coding activity in #vibe-coding`)
            .addFields(
                {
                    name: `📈 Activity Summary`,
                    value: `Total Responses: ${responses.length}\nUnique Solvers: ${solverOrder.length}`,
                    inline: false
                }
            );

        // Add who solved list
        let solvedList = '';
        solverOrder.forEach((userId, index) => {
            const solver = solvers[userId];
            solvedList += `${index + 1}. ${solver.name} - ${solver.count} solution(s)\n`;
        });

        embed.addFields({
            name: `✅ Who Solved Today`,
            value: solvedList || 'No solvers',
            inline: false
        });

        embed
            .setFooter({ text: `Report generated at ${new Date().toLocaleString()}` })
            .setTimestamp();

        return embed;
    } catch (error) {
        console.error(`Error building vibe-code report:`, error.message);
        return null;
    }
}

/**
 * Send daily vibe-coding report
 */
async function sendDailyVibeCodeReport(client) {
    try {
        const reportEmbed = await buildDailyVibeCodeReport(client);
        
        if (!reportEmbed) {
            console.log(`⚠ Could not generate vibe-code report`);
            return;
        }

        const reportsChannel = client.channels.cache.get(REPORTS_CHANNEL_ID);
        if (!reportsChannel || !reportsChannel.isTextBased()) {
            console.warn(`⚠ Reports channel not found`);
            return;
        }

        await reportsChannel.send({ embeds: [reportEmbed] });
        console.log(`✓ Daily vibe-code report sent to chamber-of-reckoning`);
    } catch (error) {
        console.error(`Error sending vibe-code report:`, error.message);
    }
}

/**
 * Schedule daily vibe-code report at 23:50
 */
function scheduleVibeCodeReport(client) {
    function scheduleNext() {
        const delay = getDelayUntilNextScheduledTime(REPORT_HOUR, REPORT_MINUTE);
        const hoursUntil = Math.floor(delay / (1000 * 60 * 60));
        const minutesUntil = Math.floor((delay % (1000 * 60 * 60)) / (1000 * 60));

        console.log(
            `📅 Next vibe-code report scheduled in ${hoursUntil}h ${minutesUntil}m (${REPORT_HOUR.toString().padStart(2, '0')}:${REPORT_MINUTE.toString().padStart(2, '0')} Asia/Kolkata)`
        );

        setTimeout(async () => {
            await sendDailyVibeCodeReport(client);
            scheduleNext();
        }, delay);
    }

    scheduleNext();
}

/**
 * Initialize vibe-code report feature
 */
function handleVibeCodeReport(client) {
    client.once('ready', () => {
        console.log('✓ Daily vibe-code report scheduler initialized');
        scheduleVibeCodeReport(client);
    });
}

module.exports = {
    handleVibeCodeReport,
    sendDailyVibeCodeReport
};
