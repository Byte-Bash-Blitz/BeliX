require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { handleWelcomeMessage } = require('./features/welcome');
const { handleProgressUpdate } = require('./features/progressupdate');
const { handleDailyTerminology } = require('./features/dailyTerminology');
const { handleSlashCommands } = require('./features/slashCommands');
const { handleMemberSync } = require('./features/memberSync');
const { handleBirthdayAnnouncement } = require('./features/birthdayAnnouncement');
const { handleScheduledReminders } = require('./features/scheduledReminders');
const { setupDailyQuestion } = require('./features/dailyQuestionPoster');
const { handleVibeCodeReport } = require('./features/dailyVibeCodeReport');

// Express setup
const app = express();
const PORT = process.env.PORT || 3000;

// Bot status tracking
const botStatus = {
    isOnline: false,
    connectedAt: null,
    lastMessageSent: null,
    totalMessagesSent: 0,
};

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

// Initialize reminders from disk
const reminders = [];

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log(`Loaded reminders system`);
    botStatus.isOnline = true;
    botStatus.connectedAt = new Date().toISOString();
});

// Setup features
console.log('Setting up bot features...');
handleWelcomeMessage(client);
handleProgressUpdate(client);
handleDailyTerminology(client);
handleSlashCommands(client);
handleMemberSync(client);
handleBirthdayAnnouncement(client);
handleScheduledReminders(client);
setupDailyQuestion(client);
handleVibeCodeReport(client);
handleleaderboard(client);
console.log('✓ All features loaded');

// Track messages
client.on('messageCreate', (message) => {
    if (!message.author.bot) {
        botStatus.lastMessageSent = new Date().toISOString();
        botStatus.totalMessagesSent++;
    }
});

// Express API endpoints
app.get('/', (req, res) => {
    res.json({
        service: 'BeliX Discord Bot',
        status: botStatus.isOnline ? 'online' : 'offline',
        uptime: botStatus.connectedAt ? Math.floor((Date.now() - new Date(botStatus.connectedAt)) / 1000) : 0,
        endpoints: {
            health: '/health',
            status: '/status'
        }
    });
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString()
    });
});

app.get('/status', (req, res) => {
    const statusCode = botStatus.isOnline ? 200 : 503;
    res.status(statusCode).json({
        botOnline: botStatus.isOnline,
        connectedAt: botStatus.connectedAt,
        lastMessageSent: botStatus.lastMessageSent,
        totalMessagesSent: botStatus.totalMessagesSent,
        uptime: botStatus.connectedAt ? Math.floor((Date.now() - new Date(botStatus.connectedAt)) / 1000) : 0,
        nextScheduledUpdate: '9:00 PM IST',
        timestamp: new Date().toISOString()
    });
});

// Start Express server
app.listen(PORT, () => {
    console.log(`Express server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`Status check: http://localhost:${PORT}/status`);
});

client.login(process.env.DISCORD_TOKEN);
