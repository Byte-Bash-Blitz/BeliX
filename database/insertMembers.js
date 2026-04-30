const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('your-supabase')) {
    console.error('Error: SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required');
    console.error('Please update your .env file with your real Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function toDateOnly(value) {
    if (!value) return null;

    if (typeof value === 'string') {
        return value.slice(0, 10);
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0];
}

function toInteger(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

async function insertMembers() {
    try {
        // Read user.json file
        const userDataPath = path.join(__dirname, '..', 'user.json');
        const userData = JSON.parse(fs.readFileSync(userDataPath, 'utf8'));

        console.log(`Found ${userData.length} members in user.json\n`);

        let successCount = 0;
        let errorCount = 0;

        // Insert members data
        for (const user of userData) {
            try {
                // Map user.json fields to members table columns
                const memberData = {
                    member_id: user.member_id,
                    username: user.discord_username || user.username || user.name,
                    display_name: user.display_name || user.name || user.discord_username || user.username,
                    role: user.role || null,
                    birthday: toDateOnly(user.birthday || user.date_of_birth),
                    discord_username: user.discord_username,
                    name: user.name,
                    personal_email: user.personal_email,
                    academic_email: user.academic_email,
                    mobile_number: user.mobile_number,
                    whatsapp_number: user.whatsapp_number,
                    github_username: user.github_username,
                    hackerrank_username: user.hackerrank_username,
                    leetcode_username: user.leetcode_username,
                    instagram_username: user.instagram_username,
                    duolingo_username: user.duolingo_username,
                    linkedin_url: user.linkedin_url,
                    portfolio_url: user.portfolio_url,
                    resume_url: user.resume_url,
                    title: user.title,
                    belmonts_points: toInteger(user.belmonts_points, 0),
                    basher_no: user.basher_no,
                    joined_as_basher_date: toDateOnly(user.joined_as_basher_date),
                    dailyprogress: toInteger(user.dailyprogress, 0),
                    gpa: user.gpa,
                    testimony: user.testimony,
                    hobbies: Array.isArray(user.hobbies) ? user.hobbies.join(', ') : user.hobbies,
                    roll_number: user.roll_number,
                    batch: user.batch,
                    problem_solved: toInteger(user.problem_solved, null),
                    members_discord_id: user.members_discord_id || user.discord_id || user.member_id,
                    domain: user.domain || user.primary_domain || user.secondary_domain || null,
                };

                // Insert into members table
                const { data, error } = await supabase
                    .from('members')
                    .insert([memberData]);

                if (error) {
                    console.error(`✗ Error inserting ${user.name} (ID: ${user.member_id}):`, error.message);
                    errorCount++;
                } else {
                    console.log(`✓ Successfully inserted: ${user.name} (ID: ${user.member_id})`);
                    successCount++;
                }
            } catch (error) {
                console.error(`✗ Exception for ${user.name}:`, error.message);
                errorCount++;
            }
        }

        console.log(`\n📊 Insertion Summary:`);
        console.log(`   ✓ Successfully inserted: ${successCount}`);
        console.log(`   ✗ Failed: ${errorCount}`);
        console.log(`   Total: ${userData.length}`);

        if (errorCount === 0) {
            console.log('\n✅ All members inserted successfully!');
        }
    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

// Run the insertion script
insertMembers();
