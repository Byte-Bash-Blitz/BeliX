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
            .or(`username.eq.${username},discord_username.eq.${username}`)
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
            .order('username', { ascending: true });

        if (error) {
            console.error('Error fetching members:', error);
            return [];
        }

        // Filter out excluded members
        return (data || []).filter(member => !EXCLUDED_MEMBERS.includes(member.display_name) && !EXCLUDED_MEMBERS.includes(member.username));
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
            .select('member_id, username, display_name, belmonts_points')
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
            .filter(member => !EXCLUDED_MEMBERS.includes(member.display_name) && !EXCLUDED_MEMBERS.includes(member.username))
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
            !EXCLUDED_MEMBERS.includes(member.username)
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
            if (EXCLUDED_MEMBERS.includes(member.display_name) || EXCLUDED_MEMBERS.includes(member.username)) {
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

        const { data: byUsername, error: usernameError } = await supabase
            .from('members')
            .select('*')
            .eq('username', discordUsername)
            .single();

        if (byUsername) {
            return byUsername;
        }

        if (usernameError && usernameError.code !== 'PGRST116') {
            console.error('Error fetching member by username:', usernameError);
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
};
