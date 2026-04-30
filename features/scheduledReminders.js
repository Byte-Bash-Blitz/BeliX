const { EmbedBuilder, ChannelType } = require('discord.js');
const { getDelayUntilNextScheduledTime, getTimeWithTimezoneInfo, formatTimeInTimeZone } = require('../utils/timezoneUtils');

// Scheduled reminder variants (24-hour format)
const REMINDER_VARIANTS = [
    {
        name: 'Daily Progress Reminder',
        hour: 21,
        minute: 30,
        message: '📊 Belmonts Daily Progress Reminder 📊',
        description: `Hey Belmonts! It's time to check in 🚀
What progress did you make today in **Byte Bash Blitz**?
Post your updates, celebrate your wins, and keep pushing forward 💪✨`,
        color: '#00D9FF',
        channelId: '1304853237471510639',
    },
    {
        name: 'Last Call Progress Reminder',
        hour: 23,
        minute: 0,
        message: '⏰ Last Call - Belmonts Daily Progress ⏰',
        description: `🚨 This is your last call, Belmonts! 
Don't miss out on sharing your progress in **Byte Bash Blitz** today!
Post your final updates now and celebrate your achievements before we wrap up! 🎯✨`,
        color: '#FF6B6B',
        channelId: '1304853237471510639',
    },
    {
        name: 'Progress Reminder Boost',
        hour: 21,
        minute: 30,
        message: '🚀 Progress Check-In 🚀',
        description: `Hey Belmonts! Take a minute to log what you built today.\nEvery small step counts, so share your wins and keep the momentum going! 💪✨`,
        color: '#4ECDC4',
        channelId: '1304853237471510639',
    },
    {
        name: 'Daily Wins Reminder',
        hour: 21,
        minute: 30,
        message: '🏆 Daily Wins Reminder 🏆',
        description: `Belmonts, what did you finish today?\nPost your progress, celebrate your wins, and keep building your streak! 🔥`,
        color: '#FFA94D',
        channelId: '1304853237471510639',
    },
    {
        name: 'Byte Bash Blitz Check',
        hour: 21,
        minute: 30,
        message: '⚡ Byte Bash Blitz Check ⚡',
        description: `Time for a quick check-in, Belmonts!\nShare what you learned, what you solved, and what you want to tackle next. 🌟`,
        color: '#845EF7',
        channelId: '1304853237471510639',
    },
];

function pickRandomReminderVariant() {
    return REMINDER_VARIANTS[Math.floor(Math.random() * REMINDER_VARIANTS.length)];
}

/**
 * Find a channel by ID or name
 */
function findTargetChannel(client, reminder) {
    // First try by channel ID if provided
    if (reminder.channelId) {
        const channel = client.channels.cache.get(reminder.channelId);
        if (channel && channel.type === ChannelType.GuildText && channel.permissionsFor(channel.guild.members.me)?.has('SendMessages')) {
            return channel;
        }
    }
    return null;
}

/**
 * Create reminder embed
 */
function createReminderEmbed(reminder) {
    return new EmbedBuilder()
        .setColor(reminder.color)
        .setTitle(reminder.message)
        .setDescription(reminder.description)
        .setTimestamp();
}

/**
 * Send scheduled reminder
 */
async function sendScheduledReminder(client) {
    let selectedReminder = null;
    try {
        selectedReminder = pickRandomReminderVariant();
        console.log(`⏰ Sending scheduled reminder: "${selectedReminder.name}"`);

        const channel = findTargetChannel(client, selectedReminder);

        if (!channel) {
            console.warn(`⚠ Channel ${selectedReminder.channelId} not found for "${selectedReminder.name}"`);
            return;
        }

        const embed = createReminderEmbed(selectedReminder);

        await channel.send({
            embeds: [embed],
        });

        console.log(`✓ Reminder sent in #${channel.name}`);
    } catch (error) {
        console.error(`Error sending reminder "${selectedReminder?.name || 'random reminder'}":`, error);
    }
}

/**
 * Schedule a reminder to run at a specific time daily
 */
function scheduleReminder(client, reminderSchedule) {
    const msUntilReminder = getDelayUntilNextScheduledTime(reminderSchedule.hour, reminderSchedule.minute);
    const hoursUntil = Math.floor(msUntilReminder / (1000 * 60 * 60));
    const minutesUntil = Math.floor((msUntilReminder % (1000 * 60 * 60)) / (1000 * 60));

    console.log(
        `📅 Random daily reminder scheduled in ${hoursUntil}h ${minutesUntil}m ` +
        `(${reminderSchedule.hour.toString().padStart(2, '0')}:${reminderSchedule.minute.toString().padStart(2, '0')} Asia/Kolkata)`
    );

    // Schedule first execution
    setTimeout(() => {
        sendScheduledReminder(client);

        // Then repeat daily
        setInterval(() => {
            sendScheduledReminder(client);
        }, 24 * 60 * 60 * 1000); // Every 24 hours
    }, msUntilReminder);
}

/**
 * Initialize all scheduled reminders
 */
function handleScheduledReminders(client) {
    client.once('ready', () => {
        console.log('✓ Scheduled reminders system initialized');

        // Schedule one random daily reminder
        scheduleReminder(client, REMINDER_VARIANTS[0]);
    });
}

module.exports = {
    handleScheduledReminders,
};
