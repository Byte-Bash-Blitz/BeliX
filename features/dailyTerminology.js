const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { getDelayUntilNextScheduledTime } = require('../utils/timezoneUtils');

const TERMINOLOGY_FILE = path.join(__dirname, '..', 'json', 'terminologies.json');

/**
 * Load terminologies from file
 */
function loadTerminologies() {
    try {
        const data = fs.readFileSync(TERMINOLOGY_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Failed to load terminologies:', error);
        return { terminologies: [], currentIndex: 0, lastPostedDate: '' };
    }
}

/**
 * Save terminologies to file
 */
function saveTerminologies(data) {
    try {
        fs.writeFileSync(TERMINOLOGY_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Failed to save terminologies:', error);
    }
}

/**
 * Find the specific channel by ID
 */
function findTerminologyChannel(client) {
    const channelId = '1304848106789015648';
    const channel = client.channels.cache.get(channelId);
    if (channel && channel.isTextBased()) {
        return channel;
    }
    return null;
}

/**
 * Post daily terminology
 */
async function postDailyTerminology(client) {
    // Automation disabled: posting of daily terminology is commented per request.
    // To re-enable, uncomment the implementation above.
    console.log('Daily terminology posting is disabled (commented out).');
}

/**
 * Schedule daily terminology posting at 8:00 AM
 */
function scheduleDailyTerminology(client) {
    // Scheduling disabled: daily terminology automation commented per request.
    // To re-enable, uncomment the scheduleNext implementation that uses getDelayUntilNextScheduledTime and setTimeout.
    console.log('Daily terminology scheduler is disabled (commented out).');
}

/**
 * Initialize daily terminology feature
 */
function handleDailyTerminology(client) {
    // Automation disabled: keep handler to avoid breaking imports but do not schedule.
    client.once('ready', () => {
        console.log('Daily terminology feature is disabled (handler commented out).');
    });
}

module.exports = { 
    handleDailyTerminology, 
    postDailyTerminology,
    loadTerminologies,
    saveTerminologies
};
