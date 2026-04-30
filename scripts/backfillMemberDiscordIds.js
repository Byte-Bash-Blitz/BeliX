require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const token = process.env.DISCORD_TOKEN;
const guildId = process.env.GUILD_ID;

if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('your-supabase')) {
    console.error('SUPABASE_URL and SUPABASE_ANON_KEY are required.');
    process.exit(1);
}

if (!token || !guildId) {
    console.error('DISCORD_TOKEN and GUILD_ID are required.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function backfillMemberDiscordIds() {
    const client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    });

    client.once('ready', async () => {
        try {
            const guild = await client.guilds.fetch(guildId);
            const members = await guild.members.fetch();

            const membersByUsername = new Map();
            for (const member of members.values()) {
                if (!member.user.bot) {
                    membersByUsername.set(member.user.username.toLowerCase(), member.id);
                }
            }

            const { data: dbMembers, error } = await supabase
                .from('members')
                .select('member_id, discord_username, members_discord_id')
                .not('discord_username', 'is', null);

            if (error) {
                throw error;
            }

            let updatedCount = 0;
            let skippedCount = 0;

            for (const row of dbMembers || []) {
                const discordUsername = String(row.discord_username || '').toLowerCase();
                const discordId = membersByUsername.get(discordUsername);

                if (!discordId) {
                    skippedCount++;
                    continue;
                }

                if (String(row.members_discord_id || '') === String(discordId)) {
                    skippedCount++;
                    continue;
                }

                const { error: updateError } = await supabase
                    .from('members')
                    .update({
                        members_discord_id: discordId,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('member_id', row.member_id);

                if (updateError) {
                    console.error(`Failed to update ${row.discord_username}:`, updateError.message);
                    continue;
                }

                updatedCount++;
                console.log(`✓ Backfilled ${row.discord_username} -> ${discordId}`);
            }

            console.log(`\nDone. Updated: ${updatedCount}, Skipped: ${skippedCount}`);
        } catch (error) {
            console.error('Backfill failed:', error);
            process.exitCode = 1;
        } finally {
            client.destroy();
        }
    });

    client.login(token);
}

backfillMemberDiscordIds();