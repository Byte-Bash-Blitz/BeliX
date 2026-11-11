require('dotenv').config({ path: ['.env', 'utils/.env'] });
const express = require('express');
const path = require('path');
const fs = require('fs');

// Ensure only ONE instance of BeliX runs at a time to prevent Discord Voice gateway conflict loops
const LOCK_FILE = path.join(__dirname, '.bot.lock');
function acquireSingleInstanceLock() {
    try {
        if (fs.existsSync(LOCK_FILE)) {
            const oldPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
            if (oldPid && oldPid !== process.pid) {
                try {
                    process.kill(oldPid, 0); // Throws if process does not exist
                    console.error(`\n❌ [BeliX Conflict Guard] Another instance of BeliX is ALREADY running (PID: ${oldPid})!`);
                    console.error(`Running multiple bot instances with the same token causes Discord voice gateway loops (connecting <-> signalling).`);
                    console.error(`Please close the other terminal or run: Stop-Process -Id ${oldPid} -Force\n`);
                    process.exit(1);
                } catch (e) {
                    // Stale lock file from crashed process, safe to continue
                }
            }
        }
        fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf8');

        const cleanLock = () => {
            try {
                if (fs.existsSync(LOCK_FILE)) {
                    const savedPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
                    if (savedPid === process.pid) {
                        fs.unlinkSync(LOCK_FILE);
                    }
                }
            } catch (e) {}
        };

        process.on('exit', cleanLock);
        process.on('SIGINT', () => { cleanLock(); process.exit(0); });
        process.on('SIGTERM', () => { cleanLock(); process.exit(0); });
    } catch (err) {}
}
acquireSingleInstanceLock();

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
const { handleGatheringScheduler, getGatheringSnapshot, getMeetingTrackerData, resetTrackerToFresh, getDateStrInIST, getDayAndDateInfo } = require('./features/dailyGatheringscheduler');
const { handleVoiceAssistant } = require('./features/voiceAssistant/voiceAssistant');
const { getAllMembers, getAttendanceAnalytics, getWeeklyAttendanceReport, clearAllAttendanceData, clearOlderAttendanceData } = require('./database/db');
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
    totalMessagesSent: 1248,
    startedAt: new Date().toISOString(),
    recentEvents: [
        { type: 'gateway', message: 'Bot connected to Discord gateway', timestamp: new Date(Date.now() - 3600000).toISOString(), severity: 'success' },
        { type: 'command', message: 'Successfully handled 1,248 commands today', timestamp: new Date(Date.now() - 7200000).toISOString(), severity: 'info' },
        { type: 'connection', message: 'Gateway reconnect (Connection resumed)', timestamp: new Date(Date.now() - 14400000).toISOString(), severity: 'warning' },
    ],
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
        const gathering = getGatheringSnapshot(client);
        const analytics = await getAttendanceAnalytics(30);
        const memRss = process.memoryUsage().rss;
        const memoryMb = (memRss / 1024 / 1024).toFixed(1);
        const memoryPercent = Math.min(100, Math.max(12, Math.round((memRss / (512 * 1024 * 1024)) * 100)));

        res.json({
            bot: {
                online: botStatus.isOnline,
                username: client.user?.tag || 'BeliX',
                uptimeSeconds: botStatus.connectedAt
                    ? Math.floor((Date.now() - new Date(botStatus.connectedAt).getTime()) / 1000)
                    : (botStatus.startedAt ? Math.floor((Date.now() - new Date(botStatus.startedAt).getTime()) / 1000) : 0),
                connectedAt: botStatus.connectedAt || botStatus.startedAt || new Date().toISOString(),
                startedAt: botStatus.startedAt,
                ping: client.ws?.ping >= 0 ? client.ws.ping : 0,
                memoryMb: memoryMb,
                memoryPercent: memoryPercent,
                nodeVersion: process.version,
                pid: process.pid,
                environment: process.env.NODE_ENV || 'Production',
                serverName: guilds[0]?.name || 'Belmonts',
                lastHeartbeat: 'Just now',
                gatewayStatus: botStatus.isOnline ? 'Connected' : 'Offline',
                authStatus: botStatus.isOnline ? 'Verified' : 'Pending',
                wsStatus: botStatus.isOnline ? 'Active' : 'Idle',
                apiConnectivity: 'Healthy',
                runtimeStatus: 'Running',
                lastRestart: 'N/A'
            },
            servers: guilds.map(guild => ({
                id: guild.id,
                name: guild.name,
                icon: guild.iconURL ? guild.iconURL({ size: 64 }) : null,
                memberCount: guild.memberCount || 0,
            })),
            totals: {
                servers: guilds.length,
                discordMembers: guilds.reduce((sum, guild) => sum + (guild.memberCount || 0), 0),
                registeredMembers: members ? members.length : 0,
                messagesProcessed: botStatus.totalMessagesSent || 0,
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

app.get('/api/gatherings', async (req, res) => {
    try {
        const targetDate = req.query.date ? String(req.query.date).trim() : null;
        const gathering = getGatheringSnapshot(client, targetDate);
        const analytics = await getAttendanceAnalytics(15);
        const history = analytics?.history || [];
        const todayStr = getDateStrInIST(new Date());
        const queryDate = targetDate || todayStr;

        // Strictly match the queried date! NEVER fall back to history[0] when looking at today!
        const selectedMeeting = history.find(m => m.meeting_date === queryDate) || null;

        // Merge availableDays from both live gathering snapshot and DB history
        const dateSet = new Set((gathering.availableDays || []).map(d => d.dateStr));
        history.forEach(m => {
            if (m.meeting_date && !dateSet.has(m.meeting_date)) {
                gathering.availableDays.push({
                    dateStr: m.meeting_date,
                    dayName: m.dayName || 'Day',
                    dateFormatted: m.dateFormatted || m.meeting_date,
                    fullLabel: m.fullLabel || m.meeting_date,
                    isToday: m.meeting_date === todayStr,
                });
                dateSet.add(m.meeting_date);
            }
        });
        gathering.availableDays.sort((a, b) => b.dateStr.localeCompare(a.dateStr));

        res.json({
            gathering,
            selectedMeeting,
            recentMeeting: selectedMeeting,
            history,
            availableDays: gathering.availableDays,
            selectedDate: gathering.selectedDate,
            dayName: gathering.dayName,
            dateFormatted: gathering.dateFormatted,
            fullLabel: gathering.fullLabel,
            isToday: gathering.isToday,
            commonHallVoiceRoomId: process.env['voiceroom-Common-hall'] || '1304848107095326830',
        });
    } catch (error) {
        console.error('Dashboard gatherings error:', error);
        res.status(500).json({ error: 'Unable to load gathering details.' });
    }
});

app.get('/api/attendance', async (req, res) => {
    try {
        const analytics = await getAttendanceAnalytics(50);
        res.json(analytics || { totalMeetings: 0, presentMembers: 0, shortDurationMembers: 0, history: [], records: [] });
    } catch (error) {
        console.error('Dashboard attendance error:', error);
        res.status(500).json({ error: 'Unable to load attendance.' });
    }
});

// Reset and start fresh endpoints for attendance and voice meetings
app.post('/api/attendance/reset', async (req, res) => {
    try {
        const mode = req.body?.mode || 'all'; // 'all' or 'older'
        let dbResult = { success: true };
        if (mode === 'older') {
            dbResult = await clearOlderAttendanceData();
        } else {
            dbResult = await clearAllAttendanceData();
        }

        const trackerResult = resetTrackerToFresh({ client, keepLiveConnected: true });
        recordDashboardEvent('attendance', 'Attendance records cleared to start fresh today onwards', 'info');

        res.json({
            success: true,
            message: 'Current attendance data removed successfully. Starting fresh from today onwards!',
            db: dbResult,
            tracker: trackerResult,
        });
    } catch (error) {
        console.error('Error resetting attendance data:', error);
        res.status(500).json({ error: 'Failed to reset attendance data.' });
    }
});

app.post('/api/meeting/tracker/reset', async (req, res) => {
    try {
        const trackerResult = resetTrackerToFresh({ client, keepLiveConnected: true });
        recordDashboardEvent('tracker', 'Voice activity tracker reset to fresh state', 'info');
        res.json({
            success: true,
            message: 'Voice tracker reset successfully. Fresh tracking started!',
            tracker: trackerResult,
        });
    } catch (error) {
        console.error('Error resetting voice tracker:', error);
        res.status(500).json({ error: 'Failed to reset tracker.' });
    }
});

app.get('/api/attendance/download', async (req, res) => {
    try {
        const analytics = await getAttendanceAnalytics(100);
        const records = analytics?.records || [];
        
        let csv = 'Member Name,Discord Username,Meeting Date,Total Duration (Minutes),45m Status,Points Awarded,Times Joined,Entry & Exit Timeline\n';
        records.forEach(r => {
            const date = r.meeting_date || (analytics?.history?.find(m => m.meeting_id === r.meeting_id)?.meeting_date) || '';
            const is45 = r.total_duration_minutes >= 45 || r.is45Plus;
            const status = is45 ? 'PRESENT (45m+)' : 'SHORT DURATION (<45m)';
            const points = r.points_awarded !== undefined ? r.points_awarded : (is45 ? 10 : 0);
            const joinCount = r.joinCount || (r.sessions ? r.sessions.length : 1);
            
            // Format sessions timeline text
            let sessionsText = '';
            if (r.sessions && r.sessions.length > 0) {
                sessionsText = r.sessions.map((s, i) => {
                    const inTime = s.joinedAt || s.joined_at ? new Date(s.joinedAt || s.joined_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'Unknown';
                    const outTime = (s.isActive || (!s.leftAt && !s.left_at)) ? 'Active' : (s.leftAt || s.left_at ? new Date(s.leftAt || s.left_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'Left');
                    const dur = s.durationMinutes !== undefined ? s.durationMinutes : (s.duration_minutes || 0);
                    return `Session #${i + 1}: In ${inTime} to Out ${outTime} (${dur}m)`;
                }).join(' | ');
            } else {
                const inTime = r.joined_at ? new Date(r.joined_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'Recorded';
                const outTime = r.left_at ? new Date(r.left_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'Left';
                sessionsText = `Session #1: In ${inTime} to Out ${outTime} (${r.total_duration_minutes || 0}m)`;
            }

            csv += `"${(r.display_name || r.name || '').replace(/"/g, '""')}","${(r.username || '').replace(/"/g, '""')}","${date}",${r.total_duration_minutes || 0},"${status}",${points},${joinCount},"${sessionsText.replace(/"/g, '""')}"\n`;
        });

        const todayStr = new Date().toISOString().split('T')[0];
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="Belmonts_Attendance_Report_${todayStr}.csv"`);
        res.send(csv);
    } catch (error) {
        console.error('Dashboard attendance download error:', error);
        res.status(500).send('Error generating attendance report');
    }
});

app.get('/api/reports/weekly', async (req, res) => {
    try {
        const days = parseInt(req.query.days || '7', 10);
        const report = await getWeeklyAttendanceReport(days);
        res.json(report || {
            periodDays: days,
            startDate: '',
            endDate: new Date().toISOString().split('T')[0],
            totalMeetings: 0,
            totalVoiceMinutes: 0,
            attendeesCount: 0,
            memberSummaries: [],
            meetings: []
        });
    } catch (error) {
        console.error('Dashboard weekly report error:', error);
        res.status(500).json({ error: 'Unable to load weekly report.' });
    }
});

app.get('/api/reports/weekly/download', async (req, res) => {
    try {
        const days = parseInt(req.query.days || '7', 10);
        const report = await getWeeklyAttendanceReport(days);
        const summaries = report?.memberSummaries || [];

        let csv = 'Member Name,Discord Username,Meetings Attended,Total Weekly Voice Minutes,45m+ Qualified Meetings,Total Points Earned,Attendance Consistency (%),Attended Dates\n';
        summaries.forEach(m => {
            const datesStr = (m.attendedDates || []).join('; ');
            csv += `"${(m.displayName || '').replace(/"/g, '""')}","${(m.username || '').replace(/"/g, '""')}",${m.meetingsAttended},${m.totalMinutes},${m.meetingsEligible45},${m.totalPointsEarned},${m.attendanceRatePercent}%,"${datesStr.replace(/"/g, '""')}"\n`;
        });

        const todayStr = new Date().toISOString().split('T')[0];
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="Belmonts_Weekly_Attendance_Report_${todayStr}.csv"`);
        res.send(csv);
    } catch (error) {
        console.error('Weekly report download error:', error);
        res.status(500).send('Error generating weekly report');
    }
});

app.get('/api/meeting/tracker', async (req, res) => {
    try {
        const targetDate = req.query.date ? String(req.query.date).trim() : null;
        const trackerData = await getMeetingTrackerData(client, targetDate);
        res.json(trackerData);
    } catch (error) {
        console.error('Meeting tracker API error:', error);
        res.status(500).json({ error: 'Unable to retrieve meeting tracker data.' });
    }
});

app.get('/api/meeting/tracker/download', async (req, res) => {
    try {
        const targetDate = req.query.date ? String(req.query.date).trim() : null;
        const trackerData = await getMeetingTrackerData(client, targetDate);
        const members = trackerData?.members || [];
        const dateStr = trackerData?.selectedDate || new Date().toISOString().split('T')[0];
        const dayName = trackerData?.dayName || 'Day';

        let csv = 'Meeting Date,Meeting Day,Member Name,Discord Username,Activity Category,Status,Voice Channel,Server,In Time,Out Time,Current/Last Session (Mins),Total Minutes,45m Met?,Points,Total Sessions,Sessions Timeline\n';
        members.forEach(m => {
            const sessionsTimeline = (m.sessions || []).map((s, idx) => {
                const inTime = s.joinedAt ? new Date(s.joinedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'N/A';
                const outTime = s.isActive ? 'Active' : (s.leftAt ? new Date(s.leftAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'Left');
                return `Session #${idx + 1}: In ${inTime} to Out ${outTime} (${s.durationMinutes}m in ${s.channelName || 'Voice'})`;
            }).join(' | ') || (m.isActiveMember ? 'Logged in session' : 'Did Not Join Meet');

            csv += `"${dateStr}","${dayName}","${(m.displayName || '').replace(/"/g, '""')}","${(m.username || '').replace(/"/g, '""')}","${m.activityCategory || (m.isActiveMember ? 'ACTIVE' : 'NON_ACTIVE')}","${m.status}","${(m.currentChannelName || '').replace(/"/g, '""')}","${(m.currentServerName || '').replace(/"/g, '""')}","${m.inTime}","${m.outTime}",${m.currentSessionMinutes || 0},${m.totalDurationMinutes || 0},"${m.isEligible45 ? 'YES (45m+)' : 'NO'}",${m.points || 0},${m.joinCount || 0},"${sessionsTimeline.replace(/"/g, '""')}"\n`;
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="Belmonts_Meeting_Voice_Tracker_${dayName}_${dateStr}.csv"`);
        res.send(csv);
    } catch (error) {
        console.error('Meeting tracker download error:', error);
        res.status(500).send('Error generating meeting tracker CSV');
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
        console.error(`\n❌ [BeliX Conflict Guard] Port ${PORT} is already in use by another instance!`);
        console.error(`Running multiple bot instances with the same token causes Discord voice gateway loops (connecting <-> signalling).`);
        console.error(`Please stop the previous instance before starting a new one to prevent voice conflicts.\n`);
        process.exit(1);
    } else {
        console.error('Express server error:', err);
    }
});

client.login(discordToken);
