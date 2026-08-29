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
    
   const data = loadTerminologies();
    
    if (!data.terminologies || data.terminologies.length === 0) {
        console.log('No terminologies available to post.');
        return;
    }
    
    // Get current terminology
    const terminology = data.terminologies[data.currentIndex];
    
    // Create embed
    const embed = new EmbedBuilder()
        .setColor('#4a90e2')
        .setTitle(`📚 Daily Tech Term: ${terminology.term}`)
        .setDescription(terminology.definition)
        .addFields(
            { name: '📂 Category', value: terminology.category, inline: true },
            { name: '📅 Term #', value: `${data.currentIndex + 1}/${data.terminologies.length}`, inline: true },
            { name: '📖 Description', value: `**${terminology.description || 'No description available'}**` }
        )
        .setFooter({ text: 'Learn something new every day! 🚀' })
        .setTimestamp();
    
    // Post to specific channel
    const channel = findTerminologyChannel(client);
    
    if (channel) {
        try {
            await channel.send({ embeds: [embed] });
            console.log(`✓ Posted daily terminology to ${channel.name}`);
        } catch (error) {
            console.error(`Failed to post terminology:`, error.message);
        }
    } else {
        console.log(`⚠ Terminology channel not found`);
    }
    
    // Update index for next day (continue incrementing)
    data.currentIndex = data.currentIndex + 1;
    data.lastPostedDate = new Date().toISOString();
    saveTerminologies(data);
    
    console.log(`Next terminology index: ${data.currentIndex}`);
}

/**
 * Schedule daily terminology posting at 8:00 AM
 */
function scheduleDailyTerminology(client) {
    // Schedule the first posting
    function scheduleNext() {
        const delay = getDelayUntilNextScheduledTime(11, 17); // 8:00 AM
        console.log(`📅 Next terminology post scheduled in ${Math.round(delay / 1000 / 60)} minutes (9:00 AM Asia/Kolkata)`);
        
        setTimeout(async () => {
            await postDailyTerminology(client);
            // Schedule the next one (24 hours later)
            scheduleNext();
        }, delay);
    }
    
    scheduleNext();
}

/**
 * Initialize daily terminology feature
 */
function handleDailyTerminology(client) {
    client.once('ready', () => {
        console.log('✓ Daily terminology scheduler initialized');
        scheduleDailyTerminology(client);
    });
}

module.exports = { 
    handleDailyTerminology, 
    postDailyTerminology,
    loadTerminologies,
    saveTerminologies
};

