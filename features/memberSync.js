const { getMemberByDiscordUsername, trackDiscordActivity, updateMemberRole, syncMember } = require('../database/db');

async function updateMemberRoleInDatabase(member, { silent = false } = {}) {
    try {
        const discordUsername = member.user.username;
        
        // Get the highest role from Discord (excluding @everyone)
        const highestRole = member.roles.highest;
        const roleName = highestRole?.name !== '@everyone' ? highestRole?.name : 'Member';
        
        // Check if member exists in database by discord_username
        const existingMember = await getMemberByDiscordUsername(discordUsername);
        
        if (existingMember) {
            // Update the role in members table
            await updateMemberRole(existingMember.member_id, roleName);
            if (!silent) {
                console.log(`✓ Updated role for ${discordUsername}: ${roleName}`);
            }
        } else {
            if (!silent) {
                console.log(`⚠ Member ${discordUsername} not found in members table. Skipping role update.`);
            }
        }
    } catch (error) {
        console.error('Error updating member role:', error);
    }
}

async function trackMemberJoin(member) {
    try {
        const discordUsername = member.user.username;
        const displayName = member.displayName || member.user.username;

        await syncMember(member, member.guild);
        
        // Check if member exists in database by discord_username
        const existingMember = await getMemberByDiscordUsername(discordUsername);
        
        // Track the join event in discord_activity regardless of whether member exists in members table
        await trackDiscordActivity({
            memberId: existingMember?.member_id.toString() || null,  // Can be null for new users
            discordUsername: discordUsername,
            displayName: displayName,
            activityType: 'join',
            channelId: null,
            channelName: 'server-join',
            metadata: {
                joinedAt: new Date().toISOString(),
                guild: member.guild.name,
                isNewMember: !existingMember  // Flag if this is a new user not in members table
            }
        });
        console.log(`✓ Tracked join for: ${discordUsername} (${displayName})${!existingMember ? ' [NEW USER]' : ''}`);
    } catch (error) {
        console.error('Error tracking member join:', error);
    }
}

async function trackMemberUpdate(member) {
    try {
        const discordUsername = member.user.username;
        const displayName = member.displayName || member.user.username;

        await syncMember(member, member.guild);
        
        // Check if member exists in database by discord_username
        const existingMember = await getMemberByDiscordUsername(discordUsername);
        
        // Track profile update event in discord_activity regardless of whether member exists in members table
        await trackDiscordActivity({
            memberId: existingMember?.member_id.toString() || null,  // Can be null for new users
            discordUsername: discordUsername,
            displayName: displayName,
            activityType: 'profile_update',
            channelId: null,
            channelName: 'profile-sync',
            metadata: {
                displayName: displayName,
                roles: member.roles.cache.map(r => r.name),
                joinedAt: member.joinedAt?.toISOString(),
                isNewMember: !existingMember  // Flag if this is a new user not in members table
            }
        });
    } catch (error) {
        console.error('Error tracking member update:', error);
    }
}

function handleMemberSync(client) {
    client.once('ready', async () => {
        console.log('✓ Member synchronization listeners initialized');
    });

    // Track member when they join
    client.on('guildMemberAdd', async (member) => {
        if (!member.user.bot) {
            await trackMemberJoin(member);
        }
    });

    // Track member when they update (role change, nickname, etc.)
    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        if (!newMember.user.bot) {
            // Update role if it changed
            if (oldMember.roles.highest.id !== newMember.roles.highest.id) {
                await updateMemberRoleInDatabase(newMember);
            }
            // Track activity
            await trackMemberUpdate(newMember);
        }
    });

    // Track member when they update their user profile
    client.on('userUpdate', async (oldUser, newUser) => {
        if (!newUser.bot) {
            for (const guild of client.guilds.cache.values()) {
                const member = await guild.members.fetch(newUser.id).catch(() => null);
                if (member) {
                    await trackMemberUpdate(member);
                }
            }
        }
    });
}

module.exports = { handleMemberSync };
