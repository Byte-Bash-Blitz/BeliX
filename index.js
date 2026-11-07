require('dotenv').config({ path: ['.env', 'utils/.env'] });
const express = require('express');
const path = require('path');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { handleWelcomeMessage } = require('./features/welcome');
const { handleProgressUpdate } = require('./features/progressupdate');
//const { handleDailyTerminology } = require('./features/dailyTerminology');
const { handleSlashCommands } = require('./features/slashCommands');
const { handleMemberSync } = require('./features/memberSync');
const { handleBirthdayAnnouncement } = require('./features/birthdayAnnouncement');
const { handleScheduledReminders } = require('./features/scheduledReminders');
//const { setupDailyQuestion } = require('./features/dailyQuestionPoster');
const { handleVibeCodeReport } = require('./features/dailyVibeCodeReport');
const { handleGatheringScheduler } = require('./features/dailyGatheringscheduler');
const { getGatheringSnapshot } = require('./features/dailyGatheringscheduler');
const { handleVoiceAssistant } = require('./features/voiceAssistant/voiceAssistant');
const { getAllMembers, getAttendanceAnalytics } = require('./database/db');
// Express setup
const app = express();
const PORT = process.env.PORT || 3000;
const dashboardPath = path.join(__dirname, 'dashboard');
const dashboardAdminToken = process.env.DASHBOARD_ADMIN_TOKEN;


// Bot status tracking
const botStatus = {
    isOnline: false,
    connectedAt: null,
    lastMessageSent: null,
    totalMessagesSent: 0,
    startedAt: new Date().toISOString(),
    recentEvents: [],
};

function recordDashboardEvent(type, message, severity = 'info') {
    botStatus.recentEvents.unshift({
        type,
        message,
        severity,
        timestamp: new Date().toISOString(),
    });
    botStatus.recentEvents = botStatus.recentEvents.slice(0, 100);
}

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

const discordToken = process.env.DISCORD_TOKEN || process.env.TOKEN;

if (!discordToken) {
    console.error('Missing Discord bot token. Create a .env file in the project root with DISCORD_TOKEN=your_token or TOKEN=your_token, then restart the bot.');
    process.exit(1);
}

// Initialize reminders from disk
const reminders = [];

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log(`Loaded reminders system`);
    botStatus.isOnline = true;
    botStatus.connectedAt = new Date().toISOString();
    recordDashboardEvent('bot', `Connected to Discord as ${client.user.tag}`);
});

// Setup features
console.log('Setting up bot features...');
handleWelcomeMessage(client);
handleProgressUpdate(client);
// handleDailyTerminology(client);
handleSlashCommands(client);
handleMemberSync(client);
handleBirthdayAnnouncement(client);
handleScheduledReminders(client);
// setupDailyQuestion(client);
handleVibeCodeReport(client);
handleGatheringScheduler(client);
handleVoiceAssistant(client);
console.log('✓ All features loaded');

// Track messages
client.on('messageCreate', (message) => {
    if (!message.author.bot) {
        botStatus.lastMessageSent = new Date().toISOString();
        botStatus.totalMessagesSent++;
        recordDashboardEvent('message', `Message processed in ${message.guild?.name || 'direct messages'}`);
    }
});

app.use(express.json({ limit: '100kb' }));
app.use(express.static(dashboardPath));

function requireDashboardAdmin(req, res, next) {
    if (!dashboardAdminToken) {
        return res.status(503).json({
            error: 'Dashboard admin actions are disabled. Set DASHBOARD_ADMIN_TOKEN in .env.',
        });
    }
    const suppliedToken = req.get('x-dashboard-token') || req.body?.token;
    if (suppliedToken !== dashboardAdminToken) {
        return res.status(401).json({ error: 'Administrator authentication required.' });
    }
    next();
}

app.get('/api/overview', async (req, res) => {
    try {
        const members = await getAllMembers();
        const guilds = Array.from(client.guilds.cache.values());
        const gathering = getGatheringSnapshot();
        const analytics = await getAttendanceAnalytics(30);
        res.json({
            bot: {
                online: botStatus.isOnline,
                username: client.user?.tag || null,
                uptimeSeconds: botStatus.connectedAt
                    ? Math.floor((Date.now() - new Date(botStatus.connectedAt).getTime()) / 1000)
                    : 0,
                connectedAt: botStatus.connectedAt,
                startedAt: botStatus.startedAt,
                ping: client.ws.ping,
                memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
                nodeVersion: process.version,
            },
            servers: guilds.map(guild => ({
                id: guild.id,
                name: guild.name,
                icon: guild.iconURL({ size: 64 }),
                memberCount: guild.memberCount,
            })),
            totals: {
                servers: guilds.length,
                discordMembers: guilds.reduce((sum, guild) => sum + guild.memberCount, 0),
                registeredMembers: members.length,
                messagesProcessed: botStatus.totalMessagesSent,
                activeGatherings: gathering.isActive ? 1 : 0,
                aiRequests: 0,
            },
            gathering,
            analytics,
            events: botStatus.recentEvents,
            capabilities: {
                dashboardAdminActions: Boolean(dashboardAdminToken),
                moderationActions: false,
                aiConfiguration: false,
                commandToggles: false,
            },
        });
    } catch (error) {
        console.error('Dashboard overview error:', error);
        res.status(500).json({ error: 'Unable to load dashboard overview.' });
    }
});

app.get('/api/members', async (req, res) => {
    try {
        const members = await getAllMembers();
        const search = String(req.query.search || '').trim().toLowerCase();
        const filtered = search
            ? members.filter(member => [member.name, member.display_name, member.discord_username, member.members_discord_id]
                .some(value => String(value || '').toLowerCase().includes(search)))
            : members;
        res.json(filtered.slice(0, 250));
    } catch (error) {
        console.error('Dashboard members error:', error);
        res.status(500).json({ error: 'Unable to load members.' });
    }
});

app.get('/api/commands', async (req, res) => {
    try {
        const guild = process.env.GUILD_ID ? client.guilds.cache.get(process.env.GUILD_ID) : client.guilds.cache.first();
        const commands = guild ? await guild.commands.fetch() : [];
        res.json(Array.from(commands.values()).map(command => ({
            id: command.id,
            name: command.name,
            description: command.description,
            permissions: command.defaultMemberPermissions?.toString() || 'Everyone',
            configurable: false,
        })));
    } catch (error) {
        console.error('Dashboard commands error:', error);
        res.status(500).json({ error: 'Unable to load registered commands.' });
    }
});

app.get('/api/events', (req, res) => {
    res.json(botStatus.recentEvents);
});

app.post('/api/admin/restart', requireDashboardAdmin, (req, res) => {
    recordDashboardEvent('admin', 'Bot restart requested from dashboard', 'warning');
    res.status(501).json({ error: 'Safe process restart is not configured for this deployment.' });
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(dashboardPath, 'index.html'));
});

// Basic API/health endpoints
app.get('/', (req, res) => {
    res.sendFile(path.join(dashboardPath, 'index.html'));
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
const server = app.listen(PORT, () => {
    console.log(`Express server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`Status check: http://localhost:${PORT}/status`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.warn(`⚠ Port ${PORT} is already in use. Skipping Express server.`);
    } else {
        console.error('Express server error:', err);
    }
});

client.login(discordToken);
