/**
 * resetAttendanceFresh.js
 * CLI script to remove old and current attendance data and start fresh today onwards.
 * Run directly with:
 *   node scripts/resetAttendanceFresh.js
 * Or:
 *   npm run reset:attendance
 */

require('dotenv').config({ path: ['.env', 'utils/.env'] });
const { clearAllAttendanceData, clearOlderAttendanceData } = require('../database/db');
const { resetTrackerToFresh } = require('../features/dailyGatheringscheduler');

async function main() {
    console.log('====================================================');
    console.log('🧹 BeliX Attendance & Meeting Data Fresh Reset');
    console.log('====================================================\n');

    const args = process.argv.slice(2);
    const mode = args.includes('--older-only') ? 'older' : 'all';

    console.log(`Reset Mode: ${mode === 'older' ? 'Remove records prior to today only' : 'Remove all current and past attendance records (Complete Fresh Slate)'}`);
    console.log('Target: Starting completely clean today onwards.\n');

    // 1. Reset in-memory voiceActivityTracker
    console.log('1. Resetting in-memory Voice Activity Tracker...');
    const trackerResult = resetTrackerToFresh({ keepLiveConnected: false });
    console.log(`   ${trackerResult.message}\n`);

    // 2. Clear Supabase / Database attendance records
    console.log('2. Clearing Database Attendance Tables (meetings, meeting_attendance, meeting_voice_sessions)...');
    let dbResult;
    if (mode === 'older') {
        const todayStr = new Date().toISOString().split('T')[0];
        dbResult = await clearOlderAttendanceData(todayStr);
    } else {
        dbResult = await clearAllAttendanceData();
    }

    if (dbResult && dbResult.success) {
        console.log(`   ✓ ${dbResult.message}`);
    } else {
        console.log(`   ⚠ Notice: ${dbResult?.message || dbResult?.error || 'Database operation skipped or credentials not configured.'}`);
    }

    console.log('\n====================================================');
    console.log('✅ FRESH START COMPLETE! Ready for today\'s gathering onwards.');
    console.log('====================================================\n');
    process.exit(0);
}

main().catch(err => {
    console.error('❌ Error during reset:', err);
    process.exit(1);
});

