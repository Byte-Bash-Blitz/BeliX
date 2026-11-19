const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags } = require('discord.js');
const { getDelayUntilNextScheduledTime, getCurrentTimeInTimeZone } = require('../utils/timezoneUtils');
const {
    confirmGathering,
    cancelGathering,
    updateGatheringTime,
    getGatheringStatus,
    createMeeting,
    updateMeetingEnd,
    recordAttendance,
    recordVoiceSession,
    getMeetingVoiceSessions,
    getActiveMeeting,
    awardMeetingPoints,
    getMember,
    getAllMembers,
} = require('../database/db');

// Channel IDs (Primary Belmonts Server)
const TINKERING_CHANNEL_ID = process.env.tinkering || '1361235736774447247';
const COMMON_HALL_CHANNEL_ID = process.env['common-hall'] || '1304848106789015647';
const REPORTS_CHANNEL_ID = '1475575831601610862';
const VOICE_ROOM_ID = process.env['voiceroom-Common-hall'] || '1304848107095326830';
const BELMONTS_ROLE_ID = '1307057022453153813';

// Additional Server Configuration (Byte-Bash-Blitz / Other Server Workspace)
const OTHER_CATEGORY_ID = process.env.OTHER_CATEGORY_ID || '1497643694214352989';
const OTHER_VOICE_ROOM_ID = process.env.OTHER_VOICE_ROOM_ID || '1497644587974394087';
const OTHER_TEXT_CHANNEL_ID = process.env.OTHER_TEXT_CHANNEL_ID || '1497644633390579914';

const BELMONTS_GUILD_ID = process.env.GUILD_ID || '1304848105975578634';
const MEETING_DURATION_MS = 60 * 60 * 1000; // 1 hour meeting duration as specified

function isGatheringVoiceChannel(channel) {
    if (!channel) return false;
    const chId = typeof channel === 'string' ? channel : channel.id;
    const guildId = channel.guild?.id || channel.guildId;

    // Primary Belmonts server (1304848105975578634): trace member in all voice channels!
    if (guildId === BELMONTS_GUILD_ID) {
        if (typeof channel === 'object') {
            return Boolean(channel.isVoiceBased?.() || channel.type === 2);
        }
        return true;
    }

    // For another server: ONLY track the specific channel ID given by the user (1497644587974394087), not others!
    return chId === OTHER_VOICE_ROOM_ID;
}

/**
 * Helper to get a channel by ID, checking cache first and fetching from API if not cached
 */
async function getChannel(client, channelId) {
    try {
        let channel = client.channels.cache.get(channelId);
        if (!channel) {
            channel = await client.channels.fetch(channelId).catch(() => null);
        }
        return channel;
    } catch (error) {
        console.error(`Error fetching channel ${channelId}:`, error.message);
        return null;
    }
}

// Store tracking data
const gatheringSession = {
    isActive: false,
    meetingId: null,
    startTime: null,
    attendees: new Map(), // userId -> {username, displayName, sessions, currentJoinAt}
    messageId: null,
    endTimeout: null,
    reminderTimeout: null,
    liveTimeout: null,
};

// Always-On Voice Activity & Meeting Tracker Store
const voiceActivityTracker = {
    attendees: new Map(), // userId -> { userId, username, displayName, avatar, currentJoinAt, currentChannelId, currentChannelName, currentServerName, sessions: [] }
    events: [],           // Recent chronological in/out/switch event log
};

function getAllTrackedVoiceChannels(client) {
    if (!client) return [];
    const channels = [];
    try {
        const belmonts = client.guilds.cache.get(BELMONTS_GUILD_ID);
        if (belmonts) {
            belmonts.channels.cache.forEach(ch => {
                if (ch.isVoiceBased?.() || ch.type === 2) {
                    channels.push(ch);
                }
            });
        }
        const otherChannel = client.channels.cache.get(OTHER_VOICE_ROOM_ID);
        if (otherChannel && (otherChannel.isVoiceBased?.() || otherChannel.type === 2)) {
            channels.push(otherChannel);
        }
    } catch (e) {
        console.warn('getAllTrackedVoiceChannels warning:', e.message);
    }
    return channels;
}

function addTrackerEvent(evt) {
    voiceActivityTracker.events.unshift({
        id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        ...evt,
    });
    if (voiceActivityTracker.events.length > 100) {
        voiceActivityTracker.events.pop();
    }
}

/**
 * Automatically purges older sessions from in-memory tracker so prior days
 * never linger in memory or combine with today's real-time voice sessions.
 */
function pruneOlderVoiceSessions(targetDateStr = null) {
    const todayStr = targetDateStr || getDateStrInIST(new Date());
    if (!todayStr) return;

    for (const [userId, attendee] of voiceActivityTracker.attendees.entries()) {
        attendee.sessions = (attendee.sessions || []).filter(s => {
            if (!s.joinedAt) return false;
            return getDateStrInIST(s.joinedAt) === todayStr;
        });

        // If member is not currently in voice and has no sessions today, remove them from memory
        if (!attendee.currentJoinAt && attendee.sessions.length === 0) {
            voiceActivityTracker.attendees.delete(userId);
        }
    }

    voiceActivityTracker.events = (voiceActivityTracker.events || []).filter(e => {
        if (!e.timestamp) return false;
        return getDateStrInIST(e.timestamp) === todayStr;
    });
}

function scanInitialVoiceStates(client) {
    if (!client) return;
    try {
        const now = new Date();
        const trackedChannels = getAllTrackedVoiceChannels(client);
        trackedChannels.forEach(channel => {
            if (!channel.members) return;
            channel.members.filter(m => !m.user.bot).forEach(m => {
                const joinTime = m.voice?.joinedAt || now;
                let attendee = voiceActivityTracker.attendees.get(m.id);
                if (!attendee) {
                    attendee = {
                        userId: m.id,
                        username: m.user.username,
                        displayName: m.displayName || m.user.username,
                        avatar: m.user.displayAvatarURL ? m.user.displayAvatarURL({ size: 64 }) : null,
                        currentJoinAt: joinTime,
                        currentChannelId: channel.id,
                        currentChannelName: channel.name,
                        currentServerName: channel.guild?.name || 'Belmonts',
                        sessions: [],
                    };
                    voiceActivityTracker.attendees.set(m.id, attendee);
                } else if (!attendee.currentJoinAt) {
                    attendee.currentJoinAt = joinTime;
                    attendee.currentChannelId = channel.id;
                    attendee.currentChannelName = channel.name;
                    attendee.currentServerName = channel.guild?.name || 'Belmonts';
                }
            });
        });
    } catch (err) {
        console.warn('Initial voice scan notice:', err.message);
    }
}

const TIME_PROMPT_HOUR = 19 //7 pm
const TIME_PROMPT_MINUTE = 0 // 0 mins

/**
 * Date & Timezone Helpers (Asia/Kolkata) for Day-by-Day Partitioning
 */
function getDateStrInIST(date = new Date()) {
    if (!date) return '';
    try {
        const d = (date instanceof Date) ? date : new Date(date);
        if (isNaN(d.getTime())) return '';
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
    } catch (e) {
        return '';
    }
}

function getDayAndDateInfo(date = new Date()) {
    try {
        const d = (date instanceof Date && !isNaN(date)) ? date : new Date(date);
        const dateStr = getDateStrInIST(d);
        const dayName = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long' }).format(d);
        const dateFormatted = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric', year: 'numeric' }).format(d);
        return {
            dateStr,
            dayName,
            dateFormatted,
            fullLabel: `${dayName}, ${dateFormatted}`,
        };
    } catch (e) {
        const fallback = new Date().toISOString().split('T')[0];
        return { dateStr: fallback, dayName: 'Day', dateFormatted: fallback, fullLabel: fallback };
    }
}

function getAvailableMeetingDays() {
    const todayStr = getDateStrInIST(new Date());
    const dateSet = new Set(todayStr ? [todayStr] : []);

    for (const att of voiceActivityTracker.attendees.values()) {
        (att.sessions || []).forEach(s => {
            if (s.joinedAt) {
                const ds = getDateStrInIST(s.joinedAt);
                if (ds) dateSet.add(ds);
            }
        });
        if (att.currentJoinAt) {
            const ds = getDateStrInIST(att.currentJoinAt);
            if (ds) dateSet.add(ds);
        }
    }
    dateSet.delete('');

    const sortedDates = Array.from(dateSet).sort().reverse();
    return sortedDates.map(dateStr => {
        try {
            const [y, m, d] = dateStr.split('-').map(Number);
            const refDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
            const dayInfo = getDayAndDateInfo(refDate);
            return {
                dateStr,
                dayName: dayInfo.dayName,
                dateFormatted: dayInfo.dateFormatted,
                fullLabel: dayInfo.fullLabel,
                isToday: dateStr === todayStr,
            };
        } catch (e) {
            return {
                dateStr,
                dayName: 'Day',
                dateFormatted: dateStr,
                fullLabel: dateStr,
                isToday: dateStr === todayStr,
            };
        }
    });
}

function getGatheringSnapshot(client = null, targetDate = null) {
    const todayStr = getDateStrInIST(new Date());
    const queryDateStr = targetDate || todayStr;
    const isToday = (queryDateStr === todayStr);

    if (isToday) {
        pruneOlderVoiceSessions(todayStr);
    }

    let dayInfo;
    try {
        const [y, m, d] = queryDateStr.split('-').map(Number);
        const refDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
        dayInfo = getDayAndDateInfo(refDate);
    } catch (e) {
        dayInfo = getDayAndDateInfo(new Date());
    }

    let liveVoiceMembers = [];
    if (client && isToday) {
        try {
            const seenUsers = new Set();

            // 1. Belmonts server: scan all voice channels
            const belmontsGuild = client.guilds.cache.get(BELMONTS_GUILD_ID);
            if (belmontsGuild) {
                belmontsGuild.channels.cache.forEach(channel => {
                    if ((channel.isVoiceBased?.() || channel.type === 2) && channel.members) {
                        channel.members.filter(m => !m.user.bot).forEach(m => {
                            if (!seenUsers.has(m.id)) {
                                seenUsers.add(m.id);
                                liveVoiceMembers.push({
                                    userId: m.id,
                                    displayName: m.displayName || m.user.username,
                                    username: m.user.username,
                                    channelName: channel.name,
                                    serverName: belmontsGuild.name,
                                    joinedAt: m.voice?.joinedAt ? m.voice.joinedAt.toISOString() : new Date().toISOString(),
                                    avatar: m.user.displayAvatarURL ? m.user.displayAvatarURL({ size: 64 }) : null,
                                });
                            }
                        });
                    }
                });
            } else {
                const voiceChannel = client.channels.cache.get(VOICE_ROOM_ID);
                if (voiceChannel && voiceChannel.members) {
                    voiceChannel.members.filter(m => !m.user.bot).forEach(m => {
                        if (!seenUsers.has(m.id)) {
                            seenUsers.add(m.id);
                            liveVoiceMembers.push({
                                userId: m.id,
                                displayName: m.displayName || m.user.username,
                                username: m.user.username,
                                channelName: voiceChannel.name,
                                serverName: voiceChannel.guild?.name || 'Belmonts',
                                joinedAt: m.voice?.joinedAt ? m.voice.joinedAt.toISOString() : new Date().toISOString(),
                                avatar: m.user.displayAvatarURL ? m.user.displayAvatarURL({ size: 64 }) : null,
                            });
                        }
                    });
                }
            }

            // 2. Another server: track ONLY the specific channel ID given by the user (1497644587974394087)
            const otherVoiceChannel = client.channels.cache.get(OTHER_VOICE_ROOM_ID);
            if (otherVoiceChannel && otherVoiceChannel.members) {
                otherVoiceChannel.members.filter(m => !m.user.bot).forEach(m => {
                    if (!seenUsers.has(m.id)) {
                        seenUsers.add(m.id);
                        liveVoiceMembers.push({
                            userId: m.id,
                            displayName: m.displayName || m.user.username,
                            username: m.user.username,
                            channelName: otherVoiceChannel.name,
                            serverName: otherVoiceChannel.guild?.name || 'Other Server',
                            joinedAt: m.voice?.joinedAt ? m.voice.joinedAt.toISOString() : new Date().toISOString(),
                            avatar: m.user.displayAvatarURL ? m.user.displayAvatarURL({ size: 64 }) : null,
                        });
                    }
                });
            }
        } catch (err) {
            console.warn('Could not read voiceChannel members for snapshot:', err.message);
        }
    }

    const sourceAttendees = (gatheringSession.isActive && isToday && gatheringSession.attendees.size > 0)
        ? gatheringSession.attendees 
        : voiceActivityTracker.attendees;

    const participants = [];

    for (const [userId, attendee] of sourceAttendees.entries()) {
        // STRICT DAY-BY-DAY FILTER: strictly filter sessions that occurred on queryDateStr!
        const dayPastSessions = (attendee.sessions || []).filter(s => {
            if (!s.joinedAt) return false;
            return getDateStrInIST(s.joinedAt) === queryDateStr;
        });

        let liveSession = null;
        if (isToday && attendee.currentJoinAt) {
            const joinDate = attendee.currentJoinAt instanceof Date ? attendee.currentJoinAt : new Date(attendee.currentJoinAt);
            if (getDateStrInIST(joinDate) === queryDateStr) {
                const currentDurMin = Math.max(0, Math.round((Date.now() - joinDate.getTime()) / 60000));
                liveSession = {
                    joinedAt: joinDate.toISOString(),
                    leftAt: null,
                    durationMinutes: currentDurMin,
                    channelName: attendee.currentChannelName || 'Voice Room',
                    serverName: attendee.currentServerName || 'Belmonts',
                    isActive: true,
                };
            }
        }

        const mappedPastSessions = dayPastSessions.map((s, idx) => {
            const jDate = s.joinedAt instanceof Date ? s.joinedAt : new Date(s.joinedAt);
            const lDate = s.leftAt ? (s.leftAt instanceof Date ? s.leftAt : new Date(s.leftAt)) : null;
            return {
                sessionNumber: idx + 1,
                joinedAt: jDate ? jDate.toISOString() : null,
                leftAt: lDate ? lDate.toISOString() : null,
                durationMinutes: s.durationMinutes !== undefined ? s.durationMinutes : (lDate ? Math.round((lDate.getTime() - jDate.getTime()) / 60000) : 0),
                channelName: s.channelName || 'Voice Room',
                serverName: s.serverName || 'Belmonts',
                isActive: false,
            };
        });

        const allDaySessions = liveSession ? [...mappedPastSessions, { ...liveSession, sessionNumber: mappedPastSessions.length + 1 }] : mappedPastSessions;

        // If member had no voice activity on queryDateStr, they are absent for this day!
        if (allDaySessions.length === 0) continue;

        const totalDurationMinutes = allDaySessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
        const isEligible45 = totalDurationMinutes >= 45;
        const firstSession = allDaySessions[0];
        const lastSession = allDaySessions[allDaySessions.length - 1];

        participants.push({
            userId,
            displayName: attendee.displayName,
            username: attendee.username,
            avatar: attendee.avatar || null,
            active: Boolean(isToday && attendee.currentJoinAt),
            joinedAt: firstSession?.joinedAt || null,
            firstJoinedAt: firstSession?.joinedAt || null,
            lastLeftAt: (isToday && attendee.currentJoinAt) ? null : (lastSession?.leftAt || null),
            totalDurationMinutes,
            isEligible45,
            status: (isToday && attendee.currentJoinAt) ? 'In Voice' : 'Left',
            sessions: allDaySessions,
            joinCount: allDaySessions.length,
            isRejoined: allDaySessions.length > 1,
            dateStr: queryDateStr,
            dayName: dayInfo.dayName,
            dateFormatted: dayInfo.dateFormatted,
        });
    }

    // Sort participants: currently in voice first, then by duration descending
    participants.sort((a, b) => {
        if (a.active && !b.active) return -1;
        if (!a.active && b.active) return 1;
        return b.totalDurationMinutes - a.totalDurationMinutes;
    });

    const baseRoster = getClanProfilesSync();
    const matchedKeys = new Set();
    participants.forEach(p => {
        const pUid = String(p.userId);
        const pUser = (p.username || '').toLowerCase();
        const pDisp = (p.displayName || '').toLowerCase();
        const m = baseRoster.find(r => 
            (r.discordId && r.discordId === pUid) ||
            (r.username && r.username.toLowerCase() === pUser) ||
            (r.displayName && r.displayName.toLowerCase() === pDisp)
        );
        if (m) {
            matchedKeys.add(String(m.id));
            if (m.discordId) matchedKeys.add(String(m.discordId));
            if (m.username) matchedKeys.add(m.username.toLowerCase());
            if (m.displayName) matchedKeys.add(m.displayName.toLowerCase());
        }
    });

    const nonActiveClanMembers = baseRoster.filter(r => 
        !matchedKeys.has(String(r.id)) &&
        (!r.discordId || !matchedKeys.has(String(r.discordId))) &&
        (!r.username || !matchedKeys.has(r.username.toLowerCase())) &&
        (!r.displayName || !matchedKeys.has(r.displayName.toLowerCase()))
    ).map(r => ({
        displayName: r.displayName || r.name,
        username: r.username || 'unlinked',
        status: 'Absent / Not Joined',
        totalDurationMinutes: 0,
        isEligible45: false,
        role: r.team || 'Belmonts Member',
        dateStr: queryDateStr,
        dayName: dayInfo.dayName,
    }));

    const availableDays = getAvailableMeetingDays();

    return {
        isActive: gatheringSession.isActive && isToday,
        meetingId: gatheringSession.meetingId,
        selectedDate: queryDateStr,
        dayName: dayInfo.dayName,
        dateFormatted: dayInfo.dateFormatted,
        fullLabel: dayInfo.fullLabel,
        isToday,
        availableDays,
        startTime: gatheringSession.startTime?.toISOString() || null,
        participantCount: participants.length,
        clanRosterCount: baseRoster.length,
        participants,
        activeParticipants: participants,
        nonActiveMembers: nonActiveClanMembers,
        liveVoiceMembers,
        voiceRoomId: VOICE_ROOM_ID,
    };
}

/**
 * Synchronous profile reader for fast snapshot lookups
 */
function getClanProfilesSync() {
    try {
        const profiles = require('../database/memberProfiles.json');
        if (Array.isArray(profiles)) {
            return profiles.map(p => ({
                id: p.discordId ? String(p.discordId) : String(p.memberId),
                discordId: p.discordId ? String(p.discordId) : null,
                username: p.discordUsername || null,
                displayName: p.fullName,
                name: p.fullName,
                team: p.clanDesignation || p.team || 'Belmonts Member',
            }));
        }
    } catch (e) {}
    return [];
}

/**
 * Complete dynamic clan roster resolver from Supabase and local profiles
 */
async function getFullClanRoster() {
    let roster = [];
    try {
        const dbMembers = await getAllMembers();
        if (dbMembers && dbMembers.length > 0) {
            roster = dbMembers.map(m => ({
                id: m.members_discord_id ? String(m.members_discord_id) : String(m.member_id),
                discordId: m.members_discord_id ? String(m.members_discord_id) : null,
                username: m.discord_username || null,
                displayName: m.display_name || m.name,
                name: m.name,
                team: m.clan_role || m.team || 'Belmonts Member',
            }));
        }
    } catch (e) {
        // Fallback below
    }

    const staticProfiles = getClanProfilesSync();
    staticProfiles.forEach(p => {
        const already = roster.some(r => 
            (p.discordId && r.discordId && String(r.discordId) === String(p.discordId)) ||
            (p.username && r.username && r.username.toLowerCase() === p.username.toLowerCase()) ||
            (p.displayName && r.displayName && r.displayName.toLowerCase() === p.displayName.toLowerCase())
        );
        if (!already) {
            roster.push(p);
        }
    });

    return roster;
}

/**
 * Get comprehensive Always-On Meeting Voice Tracker data with Active and Non-Active member visibility
 */
/**
 * Get comprehensive Always-On Meeting Voice Tracker data partitioned strictly day-by-day
 */
async function getMeetingTrackerData(client = null, targetDate = null) {
    const now = new Date();
    const todayStr = getDateStrInIST(now);
    const queryDateStr = targetDate || todayStr;
    const isToday = (queryDateStr === todayStr);

    if (isToday) {
        pruneOlderVoiceSessions(todayStr);
    }

    let dayInfo;
    try {
        const [y, m, d] = queryDateStr.split('-').map(Number);
        const refDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
        dayInfo = getDayAndDateInfo(refDate);
    } catch (e) {
        dayInfo = getDayAndDateInfo(now);
    }

    if (client && isToday) {
        scanInitialVoiceStates(client);
    }

    const clanRoster = await getFullClanRoster();
    const matchedRosterKeys = new Set();
    const activeMembers = [];
    let totalVoiceMinutes = 0;
    let activeVoiceCount = 0;
    let qualified45Count = 0;

    for (const [userId, att] of voiceActivityTracker.attendees.entries()) {
        const isCurrentlyActive = Boolean(isToday && att.currentJoinAt);
        if (isCurrentlyActive) activeVoiceCount++;

        // STRICT DAY-BY-DAY FILTER: only include sessions belonging to queryDateStr!
        const dayPastSessions = (att.sessions || []).filter(s => {
            if (!s.joinedAt) return false;
            return getDateStrInIST(s.joinedAt) === queryDateStr;
        });

        let liveSession = null;
        let ongoingMinutes = 0;
        if (isToday && att.currentJoinAt) {
            const joinDate = att.currentJoinAt instanceof Date ? att.currentJoinAt : new Date(att.currentJoinAt);
            if (getDateStrInIST(joinDate) === queryDateStr) {
                ongoingMinutes = Math.max(0, Math.floor((now.getTime() - joinDate.getTime()) / 60000));
                liveSession = {
                    joinedAt: joinDate.toISOString(),
                    leftAt: null,
                    durationMinutes: ongoingMinutes,
                    channelName: att.currentChannelName || 'Voice Room',
                    serverName: att.currentServerName || 'Belmonts',
                    isActive: true,
                };
            }
        }

        const mappedPastSessions = dayPastSessions.map((s, idx) => {
            const jDate = s.joinedAt instanceof Date ? s.joinedAt : new Date(s.joinedAt);
            const lDate = s.leftAt ? (s.leftAt instanceof Date ? s.leftAt : new Date(s.leftAt)) : null;
            return {
                sessionNumber: idx + 1,
                joinedAt: jDate ? jDate.toISOString() : null,
                leftAt: lDate ? lDate.toISOString() : null,
                durationMinutes: s.durationMinutes !== undefined ? s.durationMinutes : (lDate ? Math.max(0, Math.floor((lDate.getTime() - jDate.getTime()) / 60000)) : 0),
                channelName: s.channelName || 'Voice Room',
                serverName: s.serverName || 'Belmonts',
                isActive: false,
            };
        });

        const allDaySessions = liveSession ? [...mappedPastSessions, { ...liveSession, sessionNumber: mappedPastSessions.length + 1 }] : mappedPastSessions;

        // If member had no voice activity on this date, skip from active list
        if (allDaySessions.length === 0) continue;

        const totalDurationMinutes = allDaySessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
        totalVoiceMinutes += totalDurationMinutes;

        const isEligible45 = totalDurationMinutes >= 45;
        if (isEligible45) qualified45Count++;

        const firstSession = allDaySessions[0];
        const lastSession = allDaySessions[allDaySessions.length - 1];

        const inTimeStr = firstSession?.joinedAt 
            ? new Date(firstSession.joinedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }) 
            : 'N/A';
        const outTimeStr = isCurrentlyActive 
            ? 'Active Now' 
            : (lastSession?.leftAt ? new Date(lastSession.leftAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : 'Left');

        // Match with clan roster
        const uIdStr = String(userId);
        const uName = (att.username || '').toLowerCase();
        const dName = (att.displayName || '').toLowerCase();
        const matchedRosterMember = clanRoster.find(r => 
            (r.discordId && String(r.discordId) === uIdStr) ||
            (r.username && r.username.toLowerCase() === uName) ||
            (r.displayName && r.displayName.toLowerCase() === dName) ||
            (r.name && r.name.toLowerCase() === dName)
        );
        if (matchedRosterMember) {
            matchedRosterKeys.add(String(matchedRosterMember.id));
            if (matchedRosterMember.discordId) matchedRosterKeys.add(String(matchedRosterMember.discordId));
            if (matchedRosterMember.username) matchedRosterKeys.add(matchedRosterMember.username.toLowerCase());
            if (matchedRosterMember.displayName) matchedRosterKeys.add(matchedRosterMember.displayName.toLowerCase());
        }

        activeMembers.push({
            userId,
            displayName: att.displayName || matchedRosterMember?.displayName || att.username || 'Member',
            username: att.username || matchedRosterMember?.username || 'unlinked',
            avatar: att.avatar || null,
            isActive: isCurrentlyActive,
            isActiveMember: true,
            activityCategory: 'ACTIVE',
            status: isCurrentlyActive ? 'In Voice' : 'Joined',
            currentChannelName: isCurrentlyActive ? (att.currentChannelName || 'Voice Room') : (lastSession?.channelName || 'Voice Room'),
            currentServerName: isCurrentlyActive ? (att.currentServerName || 'Belmonts') : (lastSession?.serverName || 'Belmonts'),
            inTime: inTimeStr,
            outTime: outTimeStr,
            firstJoinedAt: firstSession?.joinedAt || null,
            lastLeftAt: isCurrentlyActive ? null : (lastSession?.leftAt || null),
            currentSessionMinutes: isCurrentlyActive ? ongoingMinutes : (lastSession?.durationMinutes || 0),
            totalDurationMinutes,
            isEligible45,
            points: isEligible45 ? 10 : 0,
            sessions: allDaySessions,
            joinCount: allDaySessions.length,
            isRejoined: allDaySessions.length > 1,
            role: matchedRosterMember?.team || 'Belmonts Member',
            dateStr: queryDateStr,
            dayName: dayInfo.dayName,
            dateFormatted: dayInfo.dateFormatted,
        });
    }

    // Identify Non-Active Members for THIS DATE
    const nonActiveMembers = [];
    for (const member of clanRoster) {
        const mIdStr = member.id ? String(member.id) : null;
        const mDiscIdStr = member.discordId ? String(member.discordId) : null;
        const mUserStr = member.username ? member.username.toLowerCase() : null;
        const mNameStr = member.displayName ? member.displayName.toLowerCase() : null;

        const isMatched = (mIdStr && matchedRosterKeys.has(mIdStr)) ||
            (mDiscIdStr && matchedRosterKeys.has(mDiscIdStr)) ||
            (mUserStr && matchedRosterKeys.has(mUserStr)) ||
            (mNameStr && matchedRosterKeys.has(mNameStr));

        if (!isMatched) {
            nonActiveMembers.push({
                userId: member.discordId || String(member.id),
                displayName: member.displayName || member.name || 'Member',
                username: member.username || 'unlinked',
                avatar: null,
                isActive: false,
                isActiveMember: false,
                activityCategory: 'NON_ACTIVE',
                status: 'Non-Active / Absent',
                currentChannelName: '—',
                currentServerName: 'Belmonts',
                inTime: 'Did Not Join',
                outTime: 'Absent',
                firstJoinedAt: null,
                lastLeftAt: null,
                currentSessionMinutes: 0,
                totalDurationMinutes: 0,
                isEligible45: false,
                points: 0,
                sessions: [],
                joinCount: 0,
                isRejoined: false,
                role: member.team || 'Belmonts Member',
                dateStr: queryDateStr,
                dayName: dayInfo.dayName,
                dateFormatted: dayInfo.dateFormatted,
            });
        }
    }

    activeMembers.sort((a, b) => {
        if (a.isActive && !b.isActive) return -1;
        if (!a.isActive && b.isActive) return 1;
        return b.totalDurationMinutes - a.totalDurationMinutes;
    });

    nonActiveMembers.sort((a, b) => a.displayName.localeCompare(b.displayName));

    const allMembersList = [...activeMembers, ...nonActiveMembers];
    const liveMembers = activeMembers.filter(m => m.isActive);

    const formattedEvents = (voiceActivityTracker.events || [])
        .filter(e => !e.timestamp || getDateStrInIST(e.timestamp) === queryDateStr)
        .slice(0, 50)
        .map(e => ({
            ...e,
            timestampStr: e.timestamp ? new Date(e.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '',
        }));

    const availableDays = getAvailableMeetingDays();

    return {
        trackerActive: true,
        isOfficialMeetingActive: Boolean(gatheringSession.isActive && isToday),
        meetingId: gatheringSession.meetingId || null,
        selectedDate: queryDateStr,
        dayName: dayInfo.dayName,
        dateFormatted: dayInfo.dateFormatted,
        fullLabel: dayInfo.fullLabel,
        isToday,
        availableDays,
        meetingDate: queryDateStr,
        currentTimeStr: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }),
        stats: {
            totalClanMembers: allMembersList.length,
            activeVoiceCount: liveMembers.length,
            totalActiveMembersToday: activeMembers.length,
            nonActiveCount: nonActiveMembers.length,
            totalVoiceMinutes,
            qualified45Count,
        },
        liveMembers,
        activeMembers,
        nonActiveMembers,
        members: allMembersList,
        recentEvents: formattedEvents,
    };
}

/**
 * Ask for gathering time in tinkering channel
 */
async function askForGatheringTime(client) {
    try {
        const channel = await getChannel(client, TINKERING_CHANNEL_ID);
        if (!channel || !channel.isTextBased()) {
            console.warn(`⚠ Tinkering channel not found`);
            return;
        }

        const today = getCurrentTimeInTimeZone();
        const dateStr = today.toLocaleDateString();

        const embed = new EmbedBuilder()
            .setColor('#FF6B9D')
            .setTitle(`📅 Daily Gathering Time - ${dateStr}`)
            .setDescription(`What time should today's daily gathering be held?`)
            .addFields(
                { name: '📝 Instructions', value: 'Use the buttons below to set the gathering time or cancel today\'s gathering.' }
            )
            .setFooter({ text: 'Click on a time or cancel button' })
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('gathering_time_2000')
                    .setLabel('8:00 PM')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('gathering_time_2030')
                    .setLabel('8:30 PM')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('gathering_time_2100')
                    .setLabel('9:00 PM')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('gathering_cancel')
                    .setLabel('Cancel Today')
                    .setStyle(ButtonStyle.Danger)
            );

        await channel.send({ embeds: [embed], components: [row] });
        console.log(`✓ Asked for gathering time in tinkering channel`);
    } catch (error) {
        console.error(`Error asking for gathering time:`, error.message);
    }
}

/**
 * Schedule gathering time prompt
 */
function scheduleGatheringPrompt(client) {
    function scheduleNext() {
        const delay = getDelayUntilNextScheduledTime(TIME_PROMPT_HOUR, TIME_PROMPT_MINUTE);
        const hoursUntil = Math.floor(delay / (1000 * 60 * 60));
        const minutesUntil = Math.floor((delay % (1000 * 60 * 60)) / (1000 * 60));

        console.log(
            `📅 [Belmonts] Next gathering prompt in ${hoursUntil}h${minutesUntil}m`
        );

        setTimeout(async () => {
            await askForGatheringTime(client);
            scheduleNext();
        }, delay);
    }

    scheduleNext();
}

/**
 * Single-line gathering confirmation (Text only, no embed box)
 */
async function postGatheringAnnouncement(client, gatheringTime, confirmedBy = null) {
    try {
        const confirmedText = confirmedBy ? ` • Confirmed by: **${confirmedBy}**` : '';
        const message = `<@&${BELMONTS_ROLE_ID}> 🎙️ **Daily Gathering Confirmed** | ⏰ **${gatheringTime}** | 📍 <#${VOICE_ROOM_ID}>${confirmedText}`;

        const channel = await getChannel(client, COMMON_HALL_CHANNEL_ID);
        if (channel && channel.isTextBased()) {
            await channel.send({ content: message });
            console.log(`✓ Posted gathering announcement to common-hall (${COMMON_HALL_CHANNEL_ID}) at ${gatheringTime}`);
        }

        // Also broadcast to other server workspace text channel
        try {
            const otherChannel = await getChannel(client, OTHER_TEXT_CHANNEL_ID);
            if (otherChannel && otherChannel.isTextBased()) {
                const otherMsg = `🎙️ **Daily Gathering Confirmed** | ⏰ **${gatheringTime}** | 📍 <#${OTHER_VOICE_ROOM_ID}>${confirmedText}`;
                await otherChannel.send({ content: otherMsg });
                console.log(`✓ Posted gathering announcement to other server channel (${OTHER_TEXT_CHANNEL_ID})`);
            }
        } catch (oErr) {
            console.warn('Other server announcement notice:', oErr.message);
        }

        return { success: true };
    } catch (error) {
        console.error(`Error posting announcement to common-hall:`, error.message);
        return { success: false, error: error.code || error.message };
    }
}

/**
 * Single-line 5-minute reminder (Text only, no embed box)
 */
async function sendGatheringReminder(client, gatheringTime) {
    try {
        const message = `<@&${BELMONTS_ROLE_ID}> ⏰ **Daily Gathering starts in 5 minutes!** | ⏰ **${gatheringTime}** | 📍 Join: <#${VOICE_ROOM_ID}>`;

        const commonHall = await getChannel(client, COMMON_HALL_CHANNEL_ID);
        if (commonHall && commonHall.isTextBased()) {
            await commonHall.send({ content: message });
        }

        const tinkering = await getChannel(client, TINKERING_CHANNEL_ID);
        if (tinkering && tinkering.isTextBased()) {
            await tinkering.send({ content: message });
        }

        // Also broadcast to other server workspace text channel
        try {
            const otherChannel = await getChannel(client, OTHER_TEXT_CHANNEL_ID);
            if (otherChannel && otherChannel.isTextBased()) {
                const otherMsg = `⏰ **Daily Gathering starts in 5 minutes!** | ⏰ **${gatheringTime}** | 📍 Join: <#${OTHER_VOICE_ROOM_ID}>`;
                await otherChannel.send({ content: otherMsg });
            }
        } catch (oErr) {
            console.warn('Other server reminder notice:', oErr.message);
        }

        console.log(`✓ Sent 5-minute reminder for gathering at ${gatheringTime}`);
    } catch (error) {
        console.error(`Error sending reminder:`, error.message);
    }
}

/**
 * Single-line LIVE announcement (Text only, no embed box)
 */
async function sendGatheringLiveAnnouncement(client, gatheringTime) {
    try {
        const channel = await getChannel(client, COMMON_HALL_CHANNEL_ID);
        if (channel && channel.isTextBased()) {
            const message = `<@&${BELMONTS_ROLE_ID}> 🔴 **Daily Gathering is LIVE NOW!** | ⏰ **Started:** ${gatheringTime} | 📍 Voice Room: <#${VOICE_ROOM_ID}>`;
            await channel.send({ content: message });
            console.log(`✓ Posted LIVE gathering announcement to common-hall (${COMMON_HALL_CHANNEL_ID}) at ${gatheringTime}`);
        }

        // Also broadcast to other server workspace text channel
        try {
            const otherChannel = await getChannel(client, OTHER_TEXT_CHANNEL_ID);
            if (otherChannel && otherChannel.isTextBased()) {
                const otherMsg = `🔴 **Daily Gathering is LIVE NOW!** | ⏰ **Started:** ${gatheringTime} | 📍 Voice Room: <#${OTHER_VOICE_ROOM_ID}>`;
                await otherChannel.send({ content: otherMsg });
                console.log(`✓ Posted LIVE announcement to other server channel (${OTHER_TEXT_CHANNEL_ID})`);
            }
        } catch (oErr) {
            console.warn('Other server live announcement notice:', oErr.message);
        }
    } catch (error) {
        console.error(`Error sending live announcement:`, error.message);
    }
}

/**
 * Start tracking meeting
 */
async function startMeetingTracking(client, gatheringDate, gatheringTime) {
    try {
        const meetingTitle = `Daily Gathering - ${gatheringDate}`;
        const [hours, minutes] = gatheringTime.split(':');
        const now = getCurrentTimeInTimeZone();
        const startTime = new Date(now);

        const meetingData = {
            title: meetingTitle,
            meeting_date: gatheringDate,
            meeting_time: `${hours}:${minutes}:00`,
            start_time: startTime.toISOString(),
        };

        const meeting = await createMeeting(meetingData);
        const meetingId = meeting?.meeting_id || `meeting_${Date.now()}`;

        if (!meeting) {
            console.warn(`⚠ Could not save meeting to database. Continuing with in-memory session ${meetingId}.`);
        }

        gatheringSession.meetingId = meetingId;
        gatheringSession.isActive = true;
        gatheringSession.startTime = startTime;
        gatheringSession.attendees.clear();

        try {
            const trackedChannels = getAllTrackedVoiceChannels(client);
            for (const voiceChannel of trackedChannels) {
                if (voiceChannel && (voiceChannel.isVoiceBased?.() || voiceChannel.type === 2)) {
                    voiceChannel.members.forEach(m => {
                        if (!m.user.bot) {
                            gatheringSession.attendees.set(m.id, {
                                username: m.user.username,
                                displayName: m.displayName || m.user.username,
                                sessions: [],
                                currentJoinAt: m.voice?.joinedAt || new Date(),
                            });
                            console.log(`✓ ${m.displayName} already in voice channel (${voiceChannel.name}) at gathering start`);
                        }
                    });
                }
            }
        } catch (vcErr) {
            // Ignore if unable to check
        }

        console.log(`✓ Meeting tracking started (ID: ${gatheringSession.meetingId}) at ${startTime.toLocaleTimeString()}`);
    } catch (error) {
        console.error(`Error starting meeting tracking:`, error.message);
    }
}

/**
 * Track voice channel attendance (Always-on for all meetings & general voice activity)
 */
async function trackVoiceActivity(client) {
    if (!client) return;

    // Scan initial members already sitting in voice
    scanInitialVoiceStates(client);

    client.on('voiceStateUpdate', async (oldState, newState) => {
        const member = newState.member || oldState.member;
        if (!member || member.user?.bot) return;

        const userId = member.id;
        const displayName = member.displayName || member.user.username;
        const username = member.user.username;
        const avatar = member.user.displayAvatarURL ? member.user.displayAvatarURL({ size: 64 }) : null;

        const oldChannel = oldState.channel;
        const newChannel = newState.channel;

        const wasInTracked = isGatheringVoiceChannel(oldChannel);
        const isInTracked = isGatheringVoiceChannel(newChannel);

        const now = new Date();

        // 1. Member joined a tracked voice channel
        if (!wasInTracked && isInTracked) {
            let attendee = voiceActivityTracker.attendees.get(userId);
            if (!attendee) {
                attendee = {
                    userId,
                    username,
                    displayName,
                    avatar,
                    currentJoinAt: now,
                    currentChannelId: newChannel.id,
                    currentChannelName: newChannel.name,
                    currentServerName: newChannel.guild?.name || 'Belmonts',
                    sessions: [],
                };
            } else {
                attendee.username = username;
                attendee.displayName = displayName;
                attendee.avatar = avatar || attendee.avatar;
                attendee.currentJoinAt = now;
                attendee.currentChannelId = newChannel.id;
                attendee.currentChannelName = newChannel.name;
                attendee.currentServerName = newChannel.guild?.name || attendee.currentServerName;
            }
            voiceActivityTracker.attendees.set(userId, attendee);

            addTrackerEvent({
                type: 'in',
                userId,
                displayName,
                username,
                channelName: newChannel.name,
                serverName: newChannel.guild?.name || 'Belmonts',
                timestamp: now,
            });

            console.log(`✓ [Voice Tracker] ${displayName} joined ${newChannel.name} (${newChannel.guild?.name || 'Belmonts'}) at ${now.toLocaleTimeString()}`);

            // If official gathering is active, also sync into gatheringSession
            if (gatheringSession.isActive) {
                const gAttendee = gatheringSession.attendees.get(userId) || {
                    username,
                    displayName,
                    sessions: [],
                    currentJoinAt: null,
                };
                gAttendee.currentJoinAt = now;
                gAttendee.username = username;
                gAttendee.displayName = displayName;
                gatheringSession.attendees.set(userId, gAttendee);
            }
        }

        // 2. Member left a tracked voice channel
        else if (wasInTracked && !isInTracked) {
            const attendee = voiceActivityTracker.attendees.get(userId);
            if (attendee?.currentJoinAt) {
                const leftAt = now;
                const durationMs = Math.max(0, leftAt.getTime() - attendee.currentJoinAt.getTime());
                const durationMinutes = Math.floor(durationMs / 60000);

                const sessionNumber = attendee.sessions.length + 1;
                const sessionRecord = {
                    sessionNumber,
                    joinedAt: attendee.currentJoinAt,
                    leftAt,
                    durationMinutes,
                    channelName: attendee.currentChannelName || oldChannel?.name || 'Voice Room',
                    serverName: attendee.currentServerName || oldChannel?.guild?.name || 'Belmonts',
                    isActive: false,
                };
                attendee.sessions.push(sessionRecord);
                attendee.currentJoinAt = null;

                addTrackerEvent({
                    type: 'out',
                    userId,
                    displayName: attendee.displayName,
                    username: attendee.username,
                    channelName: sessionRecord.channelName,
                    serverName: sessionRecord.serverName,
                    timestamp: leftAt,
                    durationMinutes,
                });

                console.log(`✓ [Voice Tracker] ${attendee.displayName} left ${sessionRecord.channelName}; session: ${durationMinutes} mins`);

                // If gathering session is active, sync and save to DB
                if (gatheringSession.isActive && gatheringSession.meetingId) {
                    const gAttendee = gatheringSession.attendees.get(userId);
                    if (gAttendee?.currentJoinAt) {
                        gAttendee.sessions.push({ joinedAt: gAttendee.currentJoinAt, leftAt });
                        gAttendee.currentJoinAt = null;
                        try {
                            const dbMember = await getMember(userId, attendee.username, attendee.displayName);
                            if (dbMember?.member_id) {
                                await recordVoiceSession({
                                    meeting_id: gatheringSession.meetingId,
                                    member_id: dbMember.member_id,
                                    discord_user_id: userId,
                                    display_name: attendee.displayName,
                                    username: attendee.username,
                                    joined_at: sessionRecord.joinedAt.toISOString(),
                                    left_at: leftAt.toISOString(),
                                    duration_minutes: durationMinutes,
                                });
                            }
                        } catch (dbErr) {
                            console.warn('Voice session db save warning:', dbErr.message);
                        }
                    }
                }
            }
        }

        // 3. Member switched between two tracked voice channels
        else if (wasInTracked && isInTracked && oldChannel?.id !== newChannel?.id) {
            const attendee = voiceActivityTracker.attendees.get(userId);
            if (attendee?.currentJoinAt) {
                const switchTime = now;
                const durationMs = Math.max(0, switchTime.getTime() - attendee.currentJoinAt.getTime());
                const durationMinutes = Math.floor(durationMs / 60000);

                const sessionNumber = attendee.sessions.length + 1;
                attendee.sessions.push({
                    sessionNumber,
                    joinedAt: attendee.currentJoinAt,
                    leftAt: switchTime,
                    durationMinutes,
                    channelName: attendee.currentChannelName || oldChannel?.name || 'Voice Room',
                    serverName: attendee.currentServerName || oldChannel?.guild?.name || 'Belmonts',
                    isActive: false,
                });

                addTrackerEvent({
                    type: 'switch',
                    userId,
                    displayName: attendee.displayName,
                    username: attendee.username,
                    fromChannel: oldChannel.name,
                    channelName: newChannel.name,
                    serverName: newChannel.guild?.name || 'Belmonts',
                    timestamp: switchTime,
                    durationMinutes,
                });

                attendee.currentJoinAt = switchTime;
                attendee.currentChannelId = newChannel.id;
                attendee.currentChannelName = newChannel.name;
                attendee.currentServerName = newChannel.guild?.name || attendee.currentServerName;

                console.log(`✓ [Voice Tracker] ${attendee.displayName} moved from ${oldChannel.name} to ${newChannel.name} (${durationMinutes} mins)`);
            }
        }
    });
}

/**
 * End gathering and generate report
 */
async function endGatheringAndReport(client) {
    if (!gatheringSession.isActive || !gatheringSession.meetingId) {
        console.log(`⚠ No active gathering to end`);
        return;
    }

    try {
        if (gatheringSession.endTimeout) {
            clearTimeout(gatheringSession.endTimeout);
            gatheringSession.endTimeout = null;
        }

        const endTime = new Date();
        const startTime = gatheringSession.startTime;
        const totalDurationMs = Math.abs(endTime.getTime() - startTime.getTime());
        const totalDurationMinutes = Math.floor(totalDurationMs / (1000 * 60));
        const hours = Math.floor(totalDurationMinutes / 60);
        const minutes = totalDurationMinutes % 60;

        const attendanceRecords = [];
        let presentCount = 0;
        let shortDurationCount = 0;

        for (const [userId, attendee] of gatheringSession.attendees) {
            if (attendee.currentJoinAt) {
                const session = { joinedAt: attendee.currentJoinAt, leftAt: endTime };
                attendee.sessions.push(session);
                attendee.currentJoinAt = null;
                const databaseMember = await getMember(userId, attendee.username, attendee.displayName);
                if (databaseMember?.member_id) {
                    await recordVoiceSession({
                        meeting_id: gatheringSession.meetingId,
                        member_id: databaseMember.member_id,
                        discord_user_id: userId,
                        display_name: attendee.displayName,
                        username: attendee.username,
                        joined_at: session.joinedAt.toISOString(),
                        left_at: endTime.toISOString(),
                        duration_minutes: Math.floor((endTime - session.joinedAt) / 60000),
                    });
                }
            }

            const joinedAt = attendee.sessions[0]?.joinedAt || endTime;
            const leftAt = attendee.sessions[attendee.sessions.length - 1]?.leftAt || endTime;
            const durationMs = attendee.sessions.reduce((total, session) => (
                total + Math.max(0, session.leftAt.getTime() - session.joinedAt.getTime())
            ), 0);
            const durationMinutes = Math.floor(durationMs / (1000 * 60));
            const attendanceStatus = durationMinutes >= 45 ? 'PRESENT' : 'SHORT DURATION';
            const pointsAwarded = attendanceStatus === 'PRESENT' ? 10 : 0;
            if (attendanceStatus === 'PRESENT') presentCount++;
            else shortDurationCount++;

            attendanceRecords.push({
                userId,
                displayName: attendee.displayName,
                durationMinutes,
                attendanceStatus,
                pointsAwarded,
            });

            try {
                const member = await getMember(userId, attendee.username, attendee.displayName);
                const memberId = member ? member.member_id : null;

                if (!memberId) {
                    console.warn(`Warning: Member ${userId} (${attendee.displayName}) not found in database, skipping attendance record`);
                    continue;
                }

                const attendanceData = {
                    member_id: memberId,
                    username: attendee.username,
                    display_name: attendee.displayName,
                    joined_at: joinedAt.toISOString(),
                    left_at: leftAt.toISOString(),
                    total_duration_minutes: durationMinutes,
                    voice_duration_minutes: durationMinutes,
                    attendance_status: attendanceStatus,
                    attendance_percentage: attendanceStatus === 'PRESENT' ? 100 : 0,
                    points_awarded: pointsAwarded,
                };
                await recordAttendance(gatheringSession.meetingId, attendanceData);

                if (pointsAwarded > 0) {
                    const awarded = await awardMeetingPoints(gatheringSession.meetingId, memberId, pointsAwarded);
                    if (awarded) console.log(`✓ Added ${pointsAwarded} points to ${attendee.displayName}`);
                }
            } catch (error) {
                console.error(`Error recording attendance for ${attendee.displayName}:`, error.message);
            }
        }

        attendanceRecords.sort((a, b) => b.durationMinutes - a.durationMinutes);

        const embed = new EmbedBuilder()
            .setColor('#10B981')
            .setTitle(`📊 Final Meeting Report`)
            .addFields(
                { name: `📅 Daily Gathering - ${getCurrentTimeInTimeZone().toLocaleDateString()}`, value: `🎙️ Channel: Common Hall`, inline: false },
                { name: `⏱️ Meeting Duration`, value: `${hours}h${minutes}m`, inline: true },
                { name: `👥 Total Attendees`, value: `${gatheringSession.attendees.size}`, inline: true }
            );

        if (attendanceRecords.length > 0) {
            const chunkSize = 20;
            for (let i = 0; i < attendanceRecords.length; i += chunkSize) {
                const chunk = attendanceRecords.slice(i, i + chunkSize);
                let attendanceText = ``;
                chunk.forEach((record) => {
                    const statusIcon = record.attendanceStatus === 'PRESENT' ? '✅' : '⏳';
                    attendanceText += `${statusIcon} **${record.displayName}** - ${record.durationMinutes}m (${record.attendanceStatus}) • +${record.pointsAwarded} points\n`;
                });

                const fieldName = i === 0 ? `📋 Attendance List` : `📋 Attendance List (cont'd)`;
                embed.addFields({
                    name: fieldName,
                    value: attendanceText || 'No attendees',
                    inline: false
                });
            }
        }

        embed.addFields({
            name: `✅ PRESENT (45m+)`,
            value: `${presentCount} members`,
            inline: true
        });
        embed.addFields({
            name: `⏳ SHORT DURATION`,
            value: `${shortDurationCount} members`,
            inline: true
        });

        embed.setFooter({ text: 'Meeting concluded' }).setTimestamp();

        const reportsChannel = await getChannel(client, REPORTS_CHANNEL_ID);
        if (reportsChannel && reportsChannel.isTextBased()) {
            await reportsChannel.send({ embeds: [embed] });
            console.log(`✓ Meeting report sent to chamber-of-reckoning`);
        } else {
            console.warn(`⚠ Reports channel not found`);
        }

        try {
            await updateMeetingEnd(gatheringSession.meetingId, {
                end_time: endTime.toISOString(),
                duration_minutes: totalDurationMinutes,
                attended_members: gatheringSession.attendees.size,
            });
        } catch (error) {
            console.error(`Error updating meeting end time:`, error.message);
        }

        gatheringSession.isActive = false;
        gatheringSession.meetingId = null;
        gatheringSession.attendees.clear();
        gatheringSession.endTimeout = null;

        console.log(`✓ Gathering tracking ended and report generated`);
    } catch (error) {
        console.error(`Error ending gathering:`, error.message);
    }
}

/**
 * Handle gathering time selection
 */
async function handleGatheringTimeSelection(client, interaction) {
    try {
        const customId = interaction.customId;
        const userId = interaction.user.id;
        const member = interaction.member;
        const displayName = member?.displayName || interaction.user.username;

        if (!interaction.isButton()) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let gatheringTime = null;
        let isCancellation = false;

        if (customId === 'gathering_cancel') {
            isCancellation = true;
        } else if (customId.startsWith('gathering_time_')) {
            const timeCode = customId.replace('gathering_time_', '');
            if (timeCode.length === 4 && /^\d+$/.test(timeCode)) {
                const hh = parseInt(timeCode.slice(0, 2), 10);
                const mm = parseInt(timeCode.slice(2, 4), 10);
                const hour12 = hh % 12 || 12;
                const ampm = hh >= 12 ? 'PM' : 'AM';
                const minuteStr = mm.toString().padStart(2, '0');
                gatheringTime = `${hh.toString().padStart(2, '0')}:${minuteStr} (${hour12}:${minuteStr}${ampm})`;
            }
        }

        if (!isCancellation && !gatheringTime) {
            await interaction.editReply({ content: `⚠️ Unknown gathering action: \`${customId}\`` });
            return;
        }

        const today = getCurrentTimeInTimeZone().toISOString().split('T')[0];

        if (isCancellation) {
            if (gatheringSession.reminderTimeout) {
                clearTimeout(gatheringSession.reminderTimeout);
                gatheringSession.reminderTimeout = null;
            }
            if (gatheringSession.liveTimeout) {
                clearTimeout(gatheringSession.liveTimeout);
                gatheringSession.liveTimeout = null;
            }
            if (gatheringSession.endTimeout) {
                clearTimeout(gatheringSession.endTimeout);
                gatheringSession.endTimeout = null;
            }
            gatheringSession.isActive = false;
            gatheringSession.meetingId = null;
            gatheringSession.attendees.clear();

            await cancelGathering(today, userId, displayName);

            const channel = await getChannel(client, COMMON_HALL_CHANNEL_ID);
            let sendError = null;
            if (channel && channel.isTextBased()) {
                try {
                    // Send cancellation in clean plain text (no embed card)
                    await channel.send({
                        content: `<@&${BELMONTS_ROLE_ID}> ❌ **Daily Gathering Cancelled** | Cancelled by: **${displayName}**`
                    });
                    console.log(`✓ Posted gathering cancellation to common-hall (${COMMON_HALL_CHANNEL_ID})`);
                } catch (err) {
                    sendError = err;
                    console.error(`Error posting cancellation to common-hall:`, err.message);
                }
            }

            let cancelDesc = `Today's gathering has been cancelled by **${displayName}**.\nNotice has been sent to <#${COMMON_HALL_CHANNEL_ID}>!`;
            if (sendError && (sendError.code === 50001 || sendError.message?.includes('Missing Access'))) {
                cancelDesc = `Today's gathering has been cancelled.\n\n⚠️ **Permission Alert**: Missing **View Channel** access in \`#common-hall\`!`;
            }

            const embed = new EmbedBuilder()
                .setColor('#EF4444')
                .setTitle(`❌ Gathering Cancelled`)
                .setDescription(cancelDesc)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

            try {
                if (interaction.message?.components?.length > 0) {
                    const row = ActionRowBuilder.from(interaction.message.components[0]);
                    row.components.forEach(btn => btn.setDisabled(true));
                    await interaction.message.edit({ components: [row] });
                }
            } catch (err) {}

            console.log(`✓ Gathering cancelled by ${displayName}`);
        } else if (gatheringTime) {
            if (gatheringSession.reminderTimeout) {
                clearTimeout(gatheringSession.reminderTimeout);
                gatheringSession.reminderTimeout = null;
            }
            if (gatheringSession.liveTimeout) {
                clearTimeout(gatheringSession.liveTimeout);
                gatheringSession.liveTimeout = null;
            }
            if (gatheringSession.endTimeout) {
                clearTimeout(gatheringSession.endTimeout);
                gatheringSession.endTimeout = null;
            }

            const timeStr = gatheringTime.split(' ')[0] + ':00';
            await confirmGathering(userId, displayName, today, timeStr);
            await updateGatheringTime(today, gatheringTime.split(' ')[0]);

            const announceResult = await postGatheringAnnouncement(client, gatheringTime, displayName);

            let confirmDesc = `Gathering confirmed for today at **${gatheringTime}**.\nConfirmation announcement has been posted to <#${COMMON_HALL_CHANNEL_ID}>!`;
            if (!announceResult.success && (announceResult.error === 50001 || String(announceResult.error).includes('Missing Access'))) {
                confirmDesc = `Gathering confirmed for today at **${gatheringTime}**.\n\n⚠️ **Permission Alert**: Missing **View Channel** access in \`#common-hall\`!`;
            }

            const embed = new EmbedBuilder()
                .setColor('#10B981')
                .setTitle(`✅ Gathering Time Set`)
                .setDescription(confirmDesc)
                .setFooter({ text: `Set by: ${displayName}` })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

            try {
                if (interaction.message?.components?.length > 0) {
                    const row = ActionRowBuilder.from(interaction.message.components[0]);
                    row.components.forEach(btn => btn.setDisabled(true));
                    await interaction.message.edit({ components: [row] });
                }
            } catch (err) {}

            const [time] = gatheringTime.split(' ');
            const [hours, minutes] = time.split(':');
            const targetHour = parseInt(hours, 10);
            const targetMinute = parseInt(minutes, 10);

            const delayToLiveMs = getDelayUntilNextScheduledTime(targetHour, targetMinute);
            const delayToReminderMs = Math.max(0, delayToLiveMs - (5 * 60 * 1000));

            console.log(`⏰ Gathering scheduled for ${gatheringTime}: Live in ${Math.round(delayToLiveMs / 1000 / 60)}m, Reminder in ${Math.round(delayToReminderMs / 1000 / 60)}m`);

            if (delayToReminderMs > 0) {
                gatheringSession.reminderTimeout = setTimeout(() => {
                    sendGatheringReminder(client, gatheringTime);
                }, delayToReminderMs);
                console.log(`✓ 5-minute reminder scheduled for ${Math.round(delayToReminderMs / 1000 / 60)} minutes from now`);
            }

            const dateStr = getCurrentTimeInTimeZone().toISOString().split('T')[0];
            const startLiveSession = async () => {
                await sendGatheringLiveAnnouncement(client, gatheringTime);
                await startMeetingTracking(client, dateStr, time);

                gatheringSession.endTimeout = setTimeout(() => {
                    endGatheringAndReport(client);
                }, MEETING_DURATION_MS); // 1 hour meeting duration
            };

            if (delayToLiveMs > 0) {
                gatheringSession.liveTimeout = setTimeout(startLiveSession, delayToLiveMs);
                console.log(`✓ LIVE meeting announcement scheduled for ${gatheringTime} (in ${Math.round(delayToLiveMs / 1000 / 60)} minutes)`);
            } else {
                await startLiveSession();
            }

            console.log(`✓ Gathering confirmed for ${gatheringTime}`);
        }
    } catch (error) {
        console.error(`Error handling gathering time selection:`, error.message);
        try {
            if (interaction.deferred) {
                await interaction.editReply({ content: `⚠️ Error processing gathering selection: ${error.message}` });
            } else if (!interaction.replied) {
                await interaction.reply({ content: `⚠️ Error processing gathering selection: ${error.message}`, flags: MessageFlags.Ephemeral });
            }
        } catch (e) {}
    }
}

/**
 * Initialize gathering scheduler
 */
function handleGatheringScheduler(client) {
    const init = async () => {
        console.log('✓ Belmonts - gathering scheduler enabled');
        scheduleGatheringPrompt(client);
        trackVoiceActivity(client);
        const activeMeeting = await getActiveMeeting();
        if (activeMeeting) {
            const sessions = await getMeetingVoiceSessions(activeMeeting.meeting_id);
            gatheringSession.isActive = true;
            gatheringSession.meetingId = activeMeeting.meeting_id;
            gatheringSession.startTime = new Date(activeMeeting.start_time);
            for (const session of sessions) {
                if (!session.discord_user_id) continue;
                const attendee = gatheringSession.attendees.get(session.discord_user_id) || {
                    username: session.username,
                    displayName: session.display_name || session.username || session.discord_user_id,
                    sessions: [],
                    currentJoinAt: null,
                };
                attendee.sessions.push({
                    joinedAt: new Date(session.joined_at),
                    leftAt: new Date(session.left_at),
                });
                gatheringSession.attendees.set(session.discord_user_id, attendee);
            }
            const voiceChannel = await getChannel(client, VOICE_ROOM_ID);
            if (voiceChannel?.isVoiceBased()) {
                voiceChannel.members.forEach(member => {
                    if (member.user.bot) return;
                    const attendee = gatheringSession.attendees.get(member.id) || {
                        username: member.user.username,
                        displayName: member.displayName || member.user.username,
                        sessions: [],
                        currentJoinAt: null,
                    };
                    if (!attendee.currentJoinAt) attendee.currentJoinAt = new Date();
                    gatheringSession.attendees.set(member.id, attendee);
                });
            }
            console.log(`✓ Recovered active gathering ${activeMeeting.meeting_id} from Supabase`);
        }
    };

    if (client.isReady && client.isReady()) {
        init();
    } else {
        client.once('ready', init);
    }

    client.on('interactionCreate', (interaction) => {
        if (interaction.customId?.startsWith('gathering_')) {
            handleGatheringTimeSelection(client, interaction);
        }
    });
}

/**
 * Resets voice tracking and gathering attendance to a fresh state.
 * Wipes past sessions, re-entries, and history, starting clean from today onwards.
 */
function resetTrackerToFresh(options = {}) {
    const { client = null, keepLiveConnected = true } = options;
    const now = new Date();

    // 1. Clear recorded attendees and historical events in memory
    voiceActivityTracker.attendees.clear();
    voiceActivityTracker.events = [];
    gatheringSession.attendees.clear();

    // 2. If members are currently in voice right now, re-initialize them fresh with currentJoinAt = now
    if (keepLiveConnected && client) {
        try {
            const trackedChannels = getAllTrackedVoiceChannels(client);
            for (const ch of trackedChannels) {
                for (const [memberId, member] of ch.members) {
                    if (member.user.bot) continue;
                    const displayName = member.nickname || member.displayName || member.user.displayName || member.user.username;
                    const username = member.user.username;
                    const avatar = member.user.displayAvatarURL ? member.user.displayAvatarURL({ dynamic: true, size: 64 }) : null;

                    voiceActivityTracker.attendees.set(memberId, {
                        userId: memberId,
                        username,
                        displayName,
                        avatar,
                        currentJoinAt: now,
                        currentChannelId: ch.id,
                        currentChannelName: ch.name,
                        currentServerName: ch.guild?.name || 'Belmonts',
                        sessions: []
                    });
                }
            }
        } catch (err) {
            console.warn('Notice re-seeding live members during fresh reset:', err.message);
        }
    }

    console.log('✓ voiceActivityTracker reset to fresh state today onwards.');
    return {
        success: true,
        message: 'Voice activity tracker cleared to fresh state. All past attendance removed, ready today onwards.'
    };
}

module.exports = {
    handleGatheringScheduler,
    endGatheringAndReport,
    getGatheringSnapshot,
    getMeetingTrackerData,
    voiceActivityTracker,
    getDayAndDateInfo,
    getDateStrInIST,
    getAvailableMeetingDays,
    resetTrackerToFresh,
};