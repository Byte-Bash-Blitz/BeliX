const { createClient } = require('@supabase/supabase-js');
const { getCurrentTimeInTimeZone } = require('../utils/timezoneUtils');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

let supabase = null;
let dbAvailable = false;

if (supabaseUrl && supabaseAnonKey && !supabaseUrl.includes('your-supabase')) {
    try {
        supabase = createClient(supabaseUrl, supabaseAnonKey);
        dbAvailable = true;
        console.log('✓ Database connection initialized');
    } catch (error) {
        console.warn('⚠ Database initialization failed:', error.message);
        dbAvailable = false;
    }
} else {
    console.warn('⚠ Supabase credentials not configured. Database features disabled.');
}

// ============ Members Operations ============

async function getMemberByDiscordID(discordId) {
    if (!dbAvailable) return null;
    try {
        const id = parseInt(discordId, 10);
        if (Number.isNaN(id)) return null;

        const { data: byDiscordId, error: discordIdError } = await supabase
            .from('members')
            .select('*')
            .eq('members_discord_id', id)
            .single();

        if (byDiscordId) {
            return byDiscordId;
        }

        if (discordIdError && discordIdError.code !== 'PGRST116') {
            console.error('Error fetching member by members_discord_id:', discordIdError);
        }

        return null;
    } catch (error) {
        console.error('Error getting member by Discord ID:', error);
        return null;
    }
}

async function syncMember(member, guild) {
    if (!dbAvailable) return;
    try {
        const memberId = parseInt(member.id, 10);
        const { data: existing, error: fetchError } = await supabase
            .from('members')
            .select('*')
            .eq('discord_username', member.user.username)
            .single();

        // PGRST116 means no rows found, which is expected when member doesn't exist
        if (fetchError && fetchError.code !== 'PGRST116') {
            console.error('Error querying member:', fetchError);
            return;
        }

        const memberData = {
            member_id: memberId,
            members_discord_id: memberId,
            username: member.user.username,
            display_name: member.displayName || member.user.username,
            role: member.roles.highest?.name || 'Member',
            updated_at: new Date().toISOString(),
        };

        // If discord_username doesn't exist, set it to current username
        if (!existing?.discord_username) {
            memberData.discord_username = member.user.username;
        }

        if (existing) {
            const { error } = await supabase
                .from('members')
                .update({
                    members_discord_id: memberId,
                    display_name: member.displayName || member.user.username,
                    role: member.roles.highest?.name || 'Member',
                    discord_username: member.user.username,
                    updated_at: new Date().toISOString(),
                })
                .eq('discord_username', member.user.username);

            if (error) console.error('Error updating member:', error);
        } else {
            console.log(`⚠ Member ${member.user.username} not found in members table. Skipping sync.`);
        }
    } catch (error) {
        console.error('Error syncing member:', error);
    }
}

async function getMember(memberId) {
    if (!dbAvailable) return null;
    try {
        return await getMemberByDiscordID(memberId);
    } catch (error) {
        console.error('Error getting member:', error);
        return null;
    }
}

async function getMemberByUsername(username) {
    if (!dbAvailable) return null;
    try {
        const { data, error } = await supabase
            .from('members')
            .select('*')
            .or(`name.eq.${username},discord_username.eq.${username}`)
            .single();

        // PGRST116 means no rows found
        if (error && error.code !== 'PGRST116') {
            console.error('Error fetching member by username:', error);
        }
        return data || null;
    } catch (error) {
        console.error('Error getting member by username:', error);
        return null;
    }
}

async function updateMemberBirthday(memberId, birthday) {
    if (!dbAvailable) return false;
    try {
        const id = parseInt(memberId, 10);
        const { error } = await supabase
            .from('members')
            .update({
                birthday: birthday ? birthday.toISOString().split('T')[0] : null,
                updated_at: new Date().toISOString(),
            })
            .eq('member_id', id);

        if (error) console.error('Error updating birthday:', error);
        return !error;
    } catch (error) {
        console.error('Error updating member birthday:', error);
        return false;
    }
}

async function updateMemberRole(memberId, role) {
    if (!dbAvailable) return false;
    try {
        const id = parseInt(memberId, 10);
        const { error } = await supabase
            .from('members')
            .update({
                role,
                updated_at: new Date().toISOString(),
            })
            .eq('member_id', id);

        if (error) console.error('Error updating role:', error);
        return !error;
    } catch (error) {
        console.error('Error updating member role:', error);
        return false;
    }
}

async function getAllMembers() {
    if (!dbAvailable) return [];
    try {
        const { data, error } = await supabase
            .from('members')
            .select('*')
            .order('name', { ascending: true });

        if (error) {
            console.error('Error fetching members:', error);
            return [];
        }

        // Filter out excluded members
        return (data || []).filter(member => 
            !EXCLUDED_MEMBERS.includes(member.display_name) && 
            !EXCLUDED_MEMBERS.includes(member.name) &&
            !EXCLUDED_MEMBERS.includes(member.discord_username)
        );
    } catch (error) {
        console.error('Error getting all members:', error);
        return [];
    }
}

// ============ Points Operations ============

async function initializePoints(memberId) {
    if (!dbAvailable) return;
    try {
        const id = parseInt(memberId, 10);
        const timestamp = new Date().toISOString();
        
        // Check if member exists and has belmonts_points
        const { data: member } = await supabase
            .from('members')
            .select('belmonts_points')
            .eq('member_id', id)
            .single();

        if (!member) {
            return;
        }

        // If belmonts_points is null, set it to 0
        if (member.belmonts_points === null) {
            const { error } = await supabase
                .from('members')
                .update({
                    belmonts_points: 0,
                    updated_at: timestamp,
                })
                .eq('member_id', id);

            if (error) {
                console.error('Error initializing belmonts_points:', error.message);
            }
        }
    } catch (error) {
        console.error('Error in initializePoints:', error);
    }
}

async function addPoints(memberId, pointsToAdd) {
    if (!dbAvailable) return null;
    try {
        const id = parseInt(memberId, 10);
        const timestamp = new Date().toISOString();
        
        // Get current points from members table using member_id
        const { data: member } = await supabase
            .from('members')
            .select('belmonts_points, member_id')
            .eq('member_id', id)
            .single();

        if (!member) {
            console.error('Member not found in members table. Member ID:', id);
            return null;
        }

        const currentPoints = member?.belmonts_points || 0;
        const newPoints = currentPoints + pointsToAdd;

        // Update ONLY the members table with new belmonts_points
        const { error: memberError } = await supabase
            .from('members')
            .update({
                belmonts_points: newPoints,
                updated_at: timestamp,
            })
            .eq('member_id', id);

        if (memberError) {
            console.error('Failed to update members.belmonts_points:', memberError.message);
            return null;
        }

        // Insert a new points log row for each award
        const { error: pointsError } = await supabase
            .from('points')
            .insert({
                member_id: member.member_id,
                points: pointsToAdd,
                last_update: timestamp,
                updated_at: timestamp,
            });

        if (pointsError) {
            console.error('Warning - Failed to insert points log row:', pointsError.message);
        }
        
        return newPoints;
    } catch (error) {
        console.error('Error in addPoints:', error);
        return null;
    }
}

async function getPoints(memberId) {
    if (!dbAvailable) return 0;
    try {
        const id = parseInt(memberId, 10);

        // Get belmonts_points from members table
        const { data: member, error } = await supabase
            .from('members')
            .select('belmonts_points')
            .eq('member_id', id)
            .single();

        // PGRST116 means no rows found
        if (error && error.code !== 'PGRST116') {
            console.error('Failed to fetch member points:', error.message);
        }

        const points = member?.belmonts_points || 0;
        return points;
    } catch (error) {
        console.error('Error in getPoints:', error);
        return 0;
    }
}

async function getLastPointUpdate(memberId) {
    if (!dbAvailable) return null;
    try {
        const id = parseInt(memberId, 10);
        const { data, error } = await supabase
            .from('points')
            .select('last_update')
            .eq('member_id', id)
            .order('last_update', { ascending: false, nullsFirst: false })
            .limit(1)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error('Failed to fetch last point update:', error.message);
        }

        return data?.last_update || null;
    } catch (error) {
        console.error('Error in getLastPointUpdate:', error);
        return null;
    }
}

async function incrementProblemsSolved(memberId) {
    if (!dbAvailable) return false;
    try {
        const id = parseInt(memberId, 10);
        const timestamp = new Date().toISOString();

        // Get current problem_solved count
        const { data: member } = await supabase
            .from('members')
            .select('problem_solved')
            .eq('member_id', id)
            .single();

        if (!member) {
            console.error('Member not found:', id);
            return false;
        }

        const currentCount = Number(member?.problem_solved || 0);
        const newCount = currentCount + 1;

        // Update problem_solved in members table
        const { error } = await supabase
            .from('members')
            .update({
                problem_solved: newCount,
                updated_at: timestamp,
            })
            .eq('member_id', id);

        if (error) {
            console.error('Failed to update problem_solved:', error.message);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error in incrementProblemsSolved:', error);
        return false;
    }
}

async function getAllPoints() {
    if (!dbAvailable) return [];
    try {
        const { data, error } = await supabase
            .from('members')
            .select('member_id, name, discord_username, display_name, belmonts_points')
            .order('belmonts_points', { ascending: false });

        if (error) console.error('Error fetching points:', error);
        return data || [];
    } catch (error) {
        console.error('Error getting all points:', error);
        return [];
    }
}

async function setPoints(memberId, points) {
    if (!dbAvailable) return false;
    try {
        const id = parseInt(memberId, 10);
        const timestamp = new Date().toISOString();

        const { error } = await supabase
            .from('members')
            .update({
                belmonts_points: points,
                updated_at: timestamp,
            })
            .eq('member_id', id);

        if (error) console.error('Error setting points:', error);
        return !error;
    } catch (error) {
        console.error('Error setting points:', error);
        return false;
    }
}

// ============ Leaderboard ============

// Members to exclude from leaderboard and member lists
const EXCLUDED_MEMBERS = ['Haleel Rahman', 'Jerlin Shabi'];

async function getLeaderboard(limit = 100) {
    if (!dbAvailable) return [];
    try {
        // First, get all members
        const { data: membersData, error: membersError } = await supabase
            .from('members')
            .select('*')
            .limit(limit);

        if (membersError) {
            console.error('Error fetching members:', membersError);
            return [];
        }

        // Merge members with their points (default to 0 if no points)
        // Filter out excluded members
        const leaderboard = membersData
            .filter(member => !EXCLUDED_MEMBERS.includes(member.display_name) && !EXCLUDED_MEMBERS.includes(member.name) && !EXCLUDED_MEMBERS.includes(member.discord_username))
            .map(member => {
                return {
                    member_id: member.member_id,
                    points: member?.belmonts_points || 0,
                    members: member
                };
            });

        // Sort by points descending
        leaderboard.sort((a, b) => b.points - a.points);

        return leaderboard;
    } catch (error) {
        console.error('Error getting leaderboard:', error);
        return [];
    }
}

// ============ Birthday Management ============

async function getMembersWithBirthdayToday() {
    if (!dbAvailable) return [];
    try {
        // Get current date in Asia/Kolkata timezone
        const today = getCurrentTimeInTimeZone();
        const todayMonth = today.getMonth() + 1;
        const todayDate = today.getDate();

        // Fetch all members with birthday info
        const { data, error } = await supabase
            .from('members')
            .select('*')
            .not('birthday', 'is', null);

        if (error) {
            console.error('Error fetching members with birthdays:', error);
            return [];
        }

        // Filter for today's month and day
        // Birthday is stored as "YYYY-MM-DD" date string, parse it directly to avoid timezone issues
        const birthdayMembers = (data || []).filter(member => {
            if (!member.birthday) return false;
            
            // Parse "YYYY-MM-DD" format directly without timezone conversion
            const [year, month, day] = member.birthday.split('-').map(Number);
            
            return month === todayMonth && day === todayDate;
        });

        // Filter out excluded members
        return birthdayMembers.filter(member => 
            !EXCLUDED_MEMBERS.includes(member.display_name) && 
            !EXCLUDED_MEMBERS.includes(member.name) &&
            !EXCLUDED_MEMBERS.includes(member.discord_username)
        );
    } catch (error) {
        console.error('Error getting today\'s birthdays:', error);
        return [];
    }
}

// For upcoming birthdays within N days
async function getMembersWithUpcomingBirthdays(daysAhead = 7) {
    if (!dbAvailable) return [];
    try {
        // Get current date in Asia/Kolkata timezone
        const today = getCurrentTimeInTimeZone();
        const todayYear = today.getFullYear();
        const todayMonth = today.getMonth() + 1;
        const todayDate = today.getDate();

        // Fetch all members with birthday info
        const { data, error } = await supabase
            .from('members')
            .select('*')
            .not('birthday', 'is', null);

        if (error) {
            console.error('Error fetching members with birthdays:', error);
            return [];
        }

        const upcoming = [];

        for (const member of data) {
            // Skip excluded members
            if (EXCLUDED_MEMBERS.includes(member.display_name) || EXCLUDED_MEMBERS.includes(member.name) || EXCLUDED_MEMBERS.includes(member.discord_username)) {
                continue;
            }

            if (!member.birthday) continue;

            // Parse "YYYY-MM-DD" format directly without timezone conversion
            const [bYear, bMonth, bDate] = member.birthday.split('-').map(Number);

            // Calculate this year's birthday
            let thisYearBirthday = new Date(todayYear, bMonth - 1, bDate);
            
            // If birthday has already passed this year, look at next year
            if (thisYearBirthday < today) {
                thisYearBirthday = new Date(todayYear + 1, bMonth - 1, bDate);
            }

            // Calculate days until birthday
            const daysUntilBirthday = Math.ceil((thisYearBirthday - today) / (1000 * 60 * 60 * 24));

            if (daysUntilBirthday <= daysAhead && daysUntilBirthday >= 0) {
                upcoming.push({ 
                    ...member, 
                    daysUntilBirthday,
                    birthdayDate: `${bMonth}/${bDate}` 
                });
            }
        }

        return upcoming.sort((a, b) => a.daysUntilBirthday - b.daysUntilBirthday);
    } catch (error) {
        console.error('Error getting upcoming birthdays:', error);
        return [];
    }
}

// ============ Discord Activity Tracking ============

async function trackDiscordActivity(activityData) {
    if (!dbAvailable) return false;
    try {
        const {
            memberId,
            discordUsername,
            displayName = null,
            activityType,
            channelId = null,
            channelName = null,
            messageCount = 0,
            voiceDurationMinutes = 0,
            reactionCount = 0,
            metadata = null
        } = activityData;

        // Validate required fields
        if (!discordUsername || !activityType) {
            console.error('Error: discordUsername and activityType are required for activity tracking');
            return false;
        }

        const memberId_int = memberId ? parseInt(memberId, 10) : null;
        const activityDate = new Date().toISOString().split('T')[0];

        const activityRecord = {
            member_id: memberId_int,
            discord_username: discordUsername,
            activity_type: activityType,
            channel_id: channelId,
            channel_name: channelName,
            message_count: messageCount || 0,
            voice_duration_minutes: voiceDurationMinutes || 0,
            reaction_count: reactionCount || 0,
            activity_date: activityDate,
            activity_timestamp: new Date().toISOString(),
            metadata: metadata || null
        };

        // Only add display_name if it's provided (handle missing column gracefully)
        if (displayName) {
            activityRecord.display_name = displayName;
        }

        const { data, error } = await supabase
            .from('discord_activity')
            .insert([activityRecord]);

        if (error) {
            console.error('Error tracking discord activity:', error.message);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error tracking discord activity:', error);
        return false;
    }
}

async function getDiscordActivity(memberId, startDate = null, endDate = null) {
    if (!dbAvailable) return [];
    try {
        const id = parseInt(memberId, 10);
        let query = supabase
            .from('discord_activity')
            .select('*')
            .eq('member_id', id);

        if (startDate) {
            query = query.gte('activity_date', startDate);
        }

        if (endDate) {
            query = query.lte('activity_date', endDate);
        }

        const { data, error } = await query.order('activity_timestamp', { ascending: false });

        if (error) {
            console.error('Error fetching discord activity:', error);
            return [];
        }

        return data || [];
    } catch (error) {
        console.error('Error getting discord activity:', error);
        return [];
    }
}

async function getDiscordActivityByUsername(discordUsername, startDate = null, endDate = null) {
    if (!dbAvailable) return [];
    try {
        let query = supabase
            .from('discord_activity')
            .select('*')
            .eq('discord_username', discordUsername);

        if (startDate) {
            query = query.gte('activity_date', startDate);
        }

        if (endDate) {
            query = query.lte('activity_date', endDate);
        }

        const { data, error } = await query.order('activity_timestamp', { ascending: false });

        if (error) {
            console.error('Error fetching discord activity by username:', error);
            return [];
        }

        return data || [];
    } catch (error) {
        console.error('Error getting discord activity by username:', error);
        return [];
    }
}

async function getDiscordActivitySummary(memberId, days = 30) {
    if (!dbAvailable) return null;
    try {
        const id = parseInt(memberId, 10);
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString().split('T')[0];

        const { data, error } = await supabase
            .from('discord_activity')
            .select('*')
            .eq('member_id', id)
            .gte('activity_date', startDateStr);

        if (error) {
            console.error('Error fetching activity summary:', error);
            return null;
        }

        const summary = {
            totalMessages: 0,
            totalVoiceMinutes: 0,
            totalReactions: 0,
            activitiesByType: {},
            activeDays: new Set(),
        };

        data.forEach(activity => {
            summary.totalMessages += activity.message_count || 0;
            summary.totalVoiceMinutes += activity.voice_duration_minutes || 0;
            summary.totalReactions += activity.reaction_count || 0;
            summary.activitiesByType[activity.activity_type] = (summary.activitiesByType[activity.activity_type] || 0) + 1;
            summary.activeDays.add(activity.activity_date);
        });

        summary.activeDays = summary.activeDays.size;

        return summary;
    } catch (error) {
        console.error('Error getting discord activity summary:', error);
        return null;
    }
}

async function getMemberByDiscordUsername(discordUsername) {
    if (!dbAvailable) return null;
    try {
        const { data, error } = await supabase
            .from('members')
            .select('*')
            .eq('discord_username', discordUsername)
            .single();

        if (data) {
            return data;
        }

        if (error && error.code !== 'PGRST116') {
            console.error('Error fetching member by discord username:', error);
        }

        const { data: byName, error: nameError } = await supabase
            .from('members')
            .select('*')
            .eq('name', discordUsername)
            .single();

        if (byName) {
            return byName;
        }

        if (nameError && nameError.code !== 'PGRST116') {
            console.error('Error fetching member by name:', nameError);
        }

        const { data: byDisplayName, error: displayNameError } = await supabase
            .from('members')
            .select('*')
            .eq('display_name', discordUsername)
            .single();

        if (displayNameError && displayNameError.code !== 'PGRST116') {
            console.error('Error fetching member by display name:', displayNameError);
        }

        return byDisplayName;
    } catch (error) {
        console.error('Error getting member by discord username:', error);
        return null;
    }
}

async function addBelmontsPointsByDiscordUsername(discordUsername, pointsToAdd) {
    if (!dbAvailable) return null;
    try {
        const member = await getMemberByDiscordUsername(discordUsername);
        if (!member) return null;

        const currentPoints = Number(member.belmonts_points || 0);
        const newPoints = currentPoints + pointsToAdd;

        const { error } = await supabase
            .from('members')
            .update({
                belmonts_points: newPoints,
                updated_at: new Date().toISOString(),
            })
            .eq('member_id', member.member_id);

        if (error) {
            console.error('Error updating belmonts_points:', error);
            return null;
        }

        return newPoints;
    } catch (error) {
        console.error('Error updating belmonts_points:', error);
        return null;
    }
}

// ============ Meetings Operations ============

async function createMeeting(meetingData) {
    if (!dbAvailable) return null;
    try {
        const {
            title,
            meeting_date,
            meeting_time,
            start_time,
        } = meetingData;

        const { data, error } = await supabase
            .from('meetings')
            .insert({
                title,
                meeting_date,
                meeting_time,
                start_time,
                attended_members: 0,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .select();

        if (error) {
            console.error('Error creating meeting:', error);
            return null;
        }

        return data?.[0] || null;
    } catch (error) {
        console.error('Error creating meeting:', error);
        return null;
    }
}

async function updateMeetingEnd(meetingId, endData) {
    if (!dbAvailable) return null;
    try {
        const {
            end_time,
            duration_minutes,
            attended_members,
        } = endData;

        const { data, error } = await supabase
            .from('meetings')
            .update({
                end_time,
                duration_minutes,
                attended_members,
                updated_at: new Date().toISOString(),
            })
            .eq('meeting_id', meetingId)
            .select();

        if (error) {
            console.error('Error updating meeting:', error);
            return null;
        }

        return data?.[0] || null;
    } catch (error) {
        console.error('Error ending meeting:', error);
        return null;
    }
}

async function recordAttendance(meetingId, attendanceData) {
    if (!dbAvailable) return null;
    try {
        const dataToInsert = Array.isArray(attendanceData) 
            ? attendanceData.map(d => ({ ...d, meeting_id: meetingId }))
            : [{ ...attendanceData, meeting_id: meetingId }];
        const results = [];
        for (const attendance of dataToInsert) {
            const { data: existing, error: lookupError } = await supabase
                .from('meeting_attendance')
                .select('*')
                .eq('meeting_id', attendance.meeting_id)
                .eq('member_id', attendance.member_id)
                .limit(1)
                .maybeSingle();
            if (lookupError) throw lookupError;

            const query = existing
                ? supabase.from('meeting_attendance').update(attendance)
                    .eq('meeting_id', attendance.meeting_id)
                    .eq('member_id', attendance.member_id)
                : supabase.from('meeting_attendance').insert(attendance);
            const { data, error } = await query.select().single();
            if (error) throw error;
            results.push(data);
        }
        return results;
    } catch (error) {
        console.error('Error recording attendance:', error);
        return null;
    }
}

async function recordVoiceSession(sessionData) {
    if (!dbAvailable) return null;
    try {
        const { data, error } = await supabase
            .from('meeting_voice_sessions')
            .upsert(sessionData, { onConflict: 'meeting_id,member_id,joined_at' })
            .select()
            .single();
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('Error recording voice session:', error);
        return null;
    }
}

async function getMeetingVoiceSessions(meetingId) {
    if (!dbAvailable) return [];
    try {
        const { data, error } = await supabase
            .from('meeting_voice_sessions')
            .select('*')
            .eq('meeting_id', meetingId)
            .order('joined_at', { ascending: true });
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Error getting voice sessions:', error);
        return [];
    }
}

async function awardMeetingPoints(meetingId, memberId, pointsToAdd = 10) {
    if (!dbAvailable) return false;
    try {
        const { data, error } = await supabase
            .from('meeting_point_awards')
            .insert({ meeting_id: meetingId, member_id: memberId, points: pointsToAdd })
            .select()
            .single();
        if (error) {
            if (error.code === '23505') return false;
            throw error;
        }
        if (data && await addPoints(memberId, pointsToAdd) === null) {
            await supabase
                .from('meeting_point_awards')
                .delete()
                .eq('meeting_id', meetingId)
                .eq('member_id', memberId);
            console.error(`Meeting point award recorded but points update failed for member ${memberId}`);
            return false;
        }
        return Boolean(data);
    } catch (error) {
        console.error('Error awarding meeting points:', error);
        return false;
    }
}

async function getAttendanceAnalytics(limit = 30) {
    if (!dbAvailable) return null;
    try {
        const { data: meetings, error: meetingsError } = await supabase
            .from('meetings')
            .select('meeting_id, meeting_date, meeting_time, start_time, end_time')
            .order('meeting_date', { ascending: false })
            .limit(limit);
        if (meetingsError) throw meetingsError;

        const meetingIds = (meetings || []).map(meeting => meeting.meeting_id);
        if (meetingIds.length === 0) {
            return { totalMeetings: 0, totalUniqueAttendees: 0, presentMembers: 0, shortDurationMembers: 0, totalVoiceMinutes: 0, averageAttendanceMinutes: 0, history: [], records: [] };
        }

        const { data: attendance, error: attendanceError } = await supabase
            .from('meeting_attendance')
            .select('meeting_attendance_id, meeting_id, member_id, display_name, username, total_duration_minutes, voice_duration_minutes, attendance_status, points_awarded, joined_at, left_at')
            .in('meeting_id', meetingIds);
        if (attendanceError) throw attendanceError;

        let voiceSessionsData = [];
        try {
            const { data: vSessions } = await supabase
                .from('meeting_voice_sessions')
                .select('*')
                .in('meeting_id', meetingIds);
            voiceSessionsData = vSessions || [];
        } catch (vErr) {
            console.warn('Voice sessions query notice:', vErr.message);
        }

        const meetingDateMap = new Map();
        (meetings || []).forEach(m => meetingDateMap.set(m.meeting_id, m.meeting_date));

        const rows = (attendance || []).map(row => {
            const duration = Number(row.total_duration_minutes || row.voice_duration_minutes || 0);
            const is45Plus = duration >= 45;
            const status = row.attendance_status || (is45Plus ? 'PRESENT' : 'SHORT DURATION');

            // Find all voice intervals (entry and exit) for this member in this meeting
            const matchedSessions = voiceSessionsData
                .filter(vs => vs.meeting_id === row.meeting_id && (
                    (row.member_id && vs.member_id === row.member_id) ||
                    (row.display_name && vs.display_name === row.display_name) ||
                    (row.username && vs.username === row.username)
                ))
                .sort((a, b) => new Date(a.joined_at) - new Date(b.joined_at));

            const sessions = matchedSessions.length > 0
                ? matchedSessions.map((s, idx) => ({
                    sessionNumber: idx + 1,
                    joinedAt: s.joined_at,
                    leftAt: s.left_at,
                    durationMinutes: Number(s.duration_minutes || 0)
                }))
                : (row.joined_at ? [{
                    sessionNumber: 1,
                    joinedAt: row.joined_at,
                    leftAt: row.left_at,
                    durationMinutes: duration
                }] : []);

            return {
                ...row,
                total_duration_minutes: duration,
                attendance_status: status,
                is45Plus,
                meeting_date: meetingDateMap.get(row.meeting_id) || '',
                points_awarded: row.points_awarded !== undefined ? row.points_awarded : (is45Plus ? 10 : 0),
                sessions,
                joinCount: Math.max(1, sessions.length),
                isRejoined: sessions.length > 1
            };
        });

        const totalVoiceMinutes = rows.reduce((total, row) => total + row.total_duration_minutes, 0);
        return {
            totalMeetings: meetings.length,
            totalUniqueAttendees: new Set(rows.map(row => row.member_id)).size,
            presentMembers: rows.filter(row => row.is45Plus).length,
            shortDurationMembers: rows.filter(row => !row.is45Plus).length,
            totalVoiceMinutes,
            averageAttendanceMinutes: rows.length ? Math.round(totalVoiceMinutes / rows.length) : 0,
            history: meetings.map(meeting => ({ ...meeting, attendance: rows.filter(row => row.meeting_id === meeting.meeting_id) })),
            records: rows,
        };
    } catch (error) {
        console.error('Error getting attendance analytics:', error);
        return null;
    }
}

async function getActiveMeeting() {
    if (!dbAvailable) return null;
    try {
        const { data, error } = await supabase
            .from('meetings')
            .select('*')
            .is('end_time', null)
            .order('start_time', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        return data || null;
    } catch (error) {
        console.error('Error getting active meeting:', error);
        return null;
    }
}

async function getMeetingAttendance(meetingId) {
    if (!dbAvailable) return [];
    try {
        const { data, error } = await supabase
            .from('meeting_attendance')
            .select('*')
            .eq('meeting_id', meetingId)
            .order('total_duration_minutes', { ascending: false });

        if (error) {
            console.error('Error fetching attendance:', error);
            return [];
        }

        return data || [];
    } catch (error) {
        console.error('Error getting meeting attendance:', error);
        return [];
    }
}

async function getMeetings(limit = 30) {
    if (!dbAvailable) return [];
    try {
        const { data, error } = await supabase
            .from('meetings')
            .select('*')
            .order('meeting_date', { ascending: false })
            .limit(limit);

        if (error) {
            console.error('Error fetching meetings:', error);
            return [];
        }

        return data || [];
    } catch (error) {
        console.error('Error getting meetings:', error);
        return [];
    }
}

// ============ Gathering Confirmation functions ============

async function confirmGathering(memberId, username, gatheringDate, gatheringTime = '20:00:00') {
    if (!dbAvailable) return null;
    try {
        const dateStr = gatheringDate ? new Date(gatheringDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
        const timeStr = typeof gatheringTime === 'number' ? `${gatheringTime}:00:00` : gatheringTime;
        
        // Check if user exists in members table by Discord ID
        const member = await getMember(memberId);
        // Only set confirmed_by_id if user is synced (store their actual member_id from DB, not Discord ID)
        const confirmedById = member ? member.member_id : null;
        
        // Check if gathering confirmation already exists for today
        const { data: existing } = await supabase
            .from('gathering_confirmations')
            .select('*')
            .eq('gathering_date', dateStr)
            .single();

        if (existing) {
            // Update existing confirmation
            const { data, error } = await supabase
                .from('gathering_confirmations')
                .update({
                    gathering_time: timeStr,
                    is_confirmed: true,
                    confirmed_by_id: confirmedById,
                    confirmed_by_username: username,
                    confirmed_at: new Date().toISOString(),
                    cancelled_by_id: null,
                    cancelled_by_username: null,
                    cancelled_at: null,
                    updated_at: new Date().toISOString(),
                })
                .eq('gathering_date', dateStr)
                .select();

            if (error) {
                console.error('Error confirming gathering:', error);
                return null;
            }
            return data?.[0] || null;
        } else {
            // Create new confirmation
            const { data, error } = await supabase
                .from('gathering_confirmations')
                .insert({
                    gathering_date: dateStr,
                    gathering_time: timeStr,
                    is_confirmed: true,
                    confirmed_by_id: confirmedById,
                    confirmed_by_username: username,
                    confirmed_at: new Date().toISOString(),
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .select();

            if (error) {
                console.error('Error creating gathering confirmation:', error);
                return null;
            }
            return data?.[0] || null;
        }
    } catch (error) {
        console.error('Error confirming gathering:', error);
        return null;
    }
}

async function cancelGathering(gatheringDate, cancelledById = null, cancelledByUsername = null) {
    if (!dbAvailable) return null;
    try {
        const dateStr = gatheringDate ? new Date(gatheringDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
        
        // Check if user is synced and store their actual member_id (not Discord ID)
        let finalCancelledById = null;
        if (cancelledById) {
            const member = await getMember(cancelledById);
            finalCancelledById = member ? member.member_id : null;
        }
        
        const { data, error } = await supabase
            .from('gathering_confirmations')
            .update({
                is_confirmed: false,
                confirmed_by_id: null,
                confirmed_by_username: null,
                confirmed_at: null,
                cancelled_by_id: finalCancelledById,
                cancelled_by_username: cancelledByUsername,
                cancelled_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq('gathering_date', dateStr)
            .select();

        if (error) {
            console.error('Error cancelling gathering:', error);
            return null;
        }
        return data?.[0] || null;
    } catch (error) {
        console.error('Error cancelling gathering:', error);
        return null;
    }
}

async function updateGatheringTime(gatheringDate, newGatheringTime) {
    if (!dbAvailable) return null;
    try {
        const dateStr = gatheringDate ? new Date(gatheringDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
        const timeStr = typeof newGatheringTime === 'number' ? `${newGatheringTime}:00:00` : newGatheringTime;
        
        // Check if gathering confirmation exists for today
        const { data: existing } = await supabase
            .from('gathering_confirmations')
            .select('*')
            .eq('gathering_date', dateStr)
            .single();

        if (existing) {
            // Update existing confirmation with new time
            const { data, error } = await supabase
                .from('gathering_confirmations')
                .update({
                    gathering_time: timeStr,
                    updated_at: new Date().toISOString(),
                })
                .eq('gathering_date', dateStr)
                .select();

            if (error) {
                console.error('Error updating gathering time:', error);
                return null;
            }
            return data?.[0] || null;
        } else {
            // Create new gathering confirmation with time
            const { data, error } = await supabase
                .from('gathering_confirmations')
                .insert({
                    gathering_date: dateStr,
                    gathering_time: timeStr,
                    is_confirmed: false,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .select();

            if (error) {
                console.error('Error creating gathering with time:', error);
                return null;
            }
            return data?.[0] || null;
        }
    } catch (error) {
        console.error('Error updating gathering time:', error);
        return null;
    }
}

async function getGatheringStatus(gatheringDate) {
    if (!dbAvailable) return null;
    try {
        const dateStr = gatheringDate ? new Date(gatheringDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
        
        const { data, error } = await supabase
            .from('gathering_confirmations')
            .select('*')
            .eq('gathering_date', dateStr)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error('Error fetching gathering status:', error);
        }
        return data || null;
    } catch (error) {
        console.error('Error getting gathering status:', error);
        return null;
    }
}

async function getGatheringHistory(days = 30) {
    if (!dbAvailable) return [];
    try {
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - days);
        const dateStr = fromDate.toISOString().split('T')[0];

        const { data, error } = await supabase
            .from('gathering_confirmations')
            .select('*')
            .gte('gathering_date', dateStr)
            .order('gathering_date', { ascending: false });

        if (error) {
            console.error('Error fetching gathering history:', error);
            return [];
        }
        return data || [];
    } catch (error) {
        console.error('Error getting gathering history:', error);
        return [];
    }
}

async function getMeetingStats() {
    if (!dbAvailable) return null;
    try {
        const { data, error } = await supabase
            .from('meetings')
            .select('count()');

        if (error) {
            console.error('Error fetching meeting stats:', error);
            return null;
        }

        return data;
    } catch (error) {
        console.error('Error getting meeting stats:', error);
        return null;
    }
}

// ============ Member Knowledge Operations (Feature 19) ============

const fs = require('fs');
const path = require('path');

function loadMemberProfiles() {
    try {
        const filePath = path.join(__dirname, 'memberProfiles.json');
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.warn('Could not read memberProfiles.json:', e.message);
    }
    return [];
}

/**
 * Dynamically queries member knowledge from database (JSON store + Supabase live enrichment).
 *
 * @param {string|number} query Name, alias/nickname, discord_username, or member_id
 * @returns {Promise<Object|null>}
 */
async function getMemberKnowledge(query) {
    if (!query) return null;
    const profiles = loadMemberProfiles();
    const q = String(query).toLowerCase().trim();

    // Check if query is a Discord mention (<@123456789> / <@!123456789>) or snowflake ID
    const mentionMatch = q.match(/<@!?([0-9]{15,22})>/);
    const discordId = mentionMatch ? mentionMatch[1] : (q.match(/^[0-9]{15,22}$/) ? q : null);

    // 1. Search in memberProfiles.json
    let match = null;
    if (discordId) {
        match = profiles.find(p => p.discordId && String(p.discordId) === String(discordId));
    }

    if (!match) {
        match = profiles.find(p => {
            if (p.memberId && String(p.memberId) === q) return true;
            if (p.discordId && String(p.discordId) === q) return true;
            if (p.discordUsername && p.discordUsername.toLowerCase() === q) return true;
            if (p.fullName && p.fullName.toLowerCase() === q) return true;
            if (p.aliases && p.aliases.some(a => a.toLowerCase() === q)) return true;
            // Word boundary or inclusion match
            if (p.fullName && (p.fullName.toLowerCase().includes(q) || q.includes(p.fullName.toLowerCase()))) return true;
            if (p.aliases && p.aliases.some(a => a.toLowerCase().includes(q) || q.includes(a.toLowerCase()))) return true;
            return false;
        });
    }

    // 2. Query Supabase for live data enrichment
    let liveMember = null;
    if (dbAvailable) {
        try {
            if (discordId) {
                const { data: byDiscordId } = await supabase
                    .from('members')
                    .select('*')
                    .eq('members_discord_id', discordId)
                    .single();
                if (byDiscordId) liveMember = byDiscordId;
            }
            if (!liveMember && match?.memberId) {
                const { data } = await supabase
                    .from('members')
                    .select('*')
                    .eq('member_id', match.memberId)
                    .single();
                liveMember = data;
            }
            if (!liveMember && match?.discordId) {
                const { data: byMatchDiscordId } = await supabase
                    .from('members')
                    .select('*')
                    .eq('members_discord_id', match.discordId)
                    .single();
                if (byMatchDiscordId) liveMember = byMatchDiscordId;
            }
            if (!liveMember) {
                const { data: byName } = await supabase.from('members').select('*').ilike('name', `%${q}%`).limit(1);
                if (byName && byName.length > 0) liveMember = byName[0];
            }
            if (!liveMember) {
                const { data: byDisplay } = await supabase.from('members').select('*').ilike('display_name', `%${q}%`).limit(1);
                if (byDisplay && byDisplay.length > 0) liveMember = byDisplay[0];
            }
            if (!liveMember) {
                const { data: byDiscord } = await supabase.from('members').select('*').ilike('discord_username', `%${q}%`).limit(1);
                if (byDiscord && byDiscord.length > 0) liveMember = byDiscord[0];
            }
        } catch (err) {
            console.warn('Error fetching live member for knowledge:', err.message);
        }
    }

    // If no match in profiles, but found in Supabase, build profile dynamically
    if (!match && liveMember) {
        match = profiles.find(p => p.memberId === liveMember.member_id) || {
            memberId: liveMember.member_id,
            fullName: liveMember.name || liveMember.display_name || liveMember.discord_username,
            aliases: [liveMember.display_name, liveMember.discord_username].filter(Boolean),
            clanDesignation: liveMember.role || 'Belmonts Member',
            team: liveMember.domain || 'Belmonts Clan',
            professionalDescription: liveMember.testimony || `${liveMember.role || 'Belmonts'} team member`,
            responsibilities: 'Participating in clan technical projects and daily gatherings.',
            funnyPersonality: null,
            achievements: liveMember.belmonts_points ? `${liveMember.belmonts_points} points earned` : null
        };
    }

    if (!match) return null;

    // Merge live data with knowledge record
    return {
        memberId: match.memberId,
        fullName: match.fullName,
        aliases: match.aliases || [],
        clanDesignation: match.clanDesignation || liveMember?.role || 'Belmonts Member',
        team: match.team || liveMember?.domain || 'Belmonts Clan',
        professionalDescription: match.professionalDescription || liveMember?.testimony || '',
        responsibilities: match.responsibilities || '',
        funnyPersonality: match.funnyPersonality || null,
        achievements: match.achievements || (liveMember?.belmonts_points ? `${liveMember.belmonts_points} points earned` : ''),
        // Enriched live stats from Supabase
        liveStats: liveMember ? {
            points: liveMember.belmonts_points || 0,
            problemsSolved: liveMember.problem_solved || 0,
            batch: liveMember.batch || '',
            gpa: liveMember.gpa || null,
            testimony: liveMember.testimony || '',
            github: liveMember.github_username || null,
            leetcode: liveMember.leetcode_username || null,
            linkedin: liveMember.linkedin_url || null,
            portfolio: liveMember.portfolio_url || null,
            discordUsername: liveMember.discord_username || ''
        } : null
    };
}

function getAllMemberKnowledge() {
    return loadMemberProfiles();
}

module.exports = {
    syncMember,
    getMember,
    getMemberByDiscordID,
    getMemberByUsername,
    updateMemberBirthday,
    updateMemberRole,
    getAllMembers,
    initializePoints,
    addPoints,
    getPoints,
    getLastPointUpdate,
    getAllPoints,
    setPoints,
    getLeaderboard,
    incrementProblemsSolved,
    getMembersWithBirthdayToday,
    getMembersWithUpcomingBirthdays,
    // Discord Activity functions
    trackDiscordActivity,
    getDiscordActivity,
    getDiscordActivityByUsername,
    getDiscordActivitySummary,
    getMemberByDiscordUsername,
    addBelmontsPointsByDiscordUsername,
    // Meetings functions
    createMeeting,
    updateMeetingEnd,
    recordAttendance,
    recordVoiceSession,
    getMeetingVoiceSessions,
    awardMeetingPoints,
    getAttendanceAnalytics,
    getActiveMeeting,
    getMeetingAttendance,
    getMeetings,
    getMeetingStats,
    // Gathering Confirmation functions
    confirmGathering,
    cancelGathering,
    updateGatheringTime,
    getGatheringStatus,
    getGatheringHistory,
    // Member Knowledge functions (Feature 19)
    getMemberKnowledge,
    getAllMemberKnowledge,
};
