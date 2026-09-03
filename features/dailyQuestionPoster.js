const fs = require('fs');
const path = require('path');
const { getDelayUntilNextScheduledTime, getCurrentTimeInTimeZone } = require('../utils/timezoneUtils');

let questionScheduler = null;

function getTodayInTimeZone() {
  const nowInTz = getCurrentTimeInTimeZone();
  return new Date(nowInTz.getFullYear(), nowInTz.getMonth(), nowInTz.getDate());
}

function resolveQuestionNumber({ questions, totalDays }) {
  if (!questions || questions.length === 0 || !totalDays) {
    return null;
  }

  const today = getTodayInTimeZone();
  const dayOfMonth = today.getDate();
  
  // Cycle through days 1 to totalDays based on day of month
  const normalizedNumber = ((dayOfMonth - 1) % totalDays) + 1;
  
  return { dayOfMonth, normalizedNumber, maxDay: totalDays };
}

function getQuestionForDay() {
  try {
    const questionsPath = path.join(__dirname, '../json/dailyQuestion.json');
    const data = JSON.parse(fs.readFileSync(questionsPath, 'utf-8'));
    const questions = data.Questions || data;
    
    const resolution = resolveQuestionNumber({
      questions,
      totalDays: data.totalDays,
    });

    let questionObj = null;
    let displayDay = null;

    if (resolution) {
      questionObj = questions.find(q => q.Day === resolution.normalizedNumber);
      displayDay = resolution.normalizedNumber;
      const cycleNumber = Math.floor((resolution.dayOfMonth - 1) / resolution.maxDay) + 1;
      
      console.log(`ℹ️ Question for today (Day ${resolution.dayOfMonth}): Day ${displayDay} | Cycle: ${cycleNumber}`);
    } else {
      console.log(`⚠️ Could not resolve question`);
      return null;
    }
    
    if (!questionObj) {
      console.log(`⚠️  No question found for Day ${displayDay ?? 'unknown'}`);
      return null;
    }

    return { ...questionObj, DisplayDay: displayDay };
  } catch (error) {
    console.error('Error reading daily questions:', error);
    return null;
  }
}

function createQuestionEmbed(question) {
  const { EmbedBuilder } = require('discord.js');
  
  const embed = new EmbedBuilder()
    .setColor('#FF6B9D')
    .setTitle(`📝 Day ${question.DisplayDay ?? question.Day}: ${question.Question}`)
    .addFields(
      { name: '📥 Input', value: `\`\`\`${question.Input}\`\`\``, inline: false },
      { name: '📤 Output', value: `\`\`\`${question.Output}\`\`\``, inline: false },
      { name: '💡 Explanation', value: question.Explain, inline: false }
    )
    .setFooter({ text: 'Daily Coding Challenge | 151 Days Total' })
    .setTimestamp();
  
  if (question.Formula) {
    embed.addFields({ name: '🔢 Formula', value: `\`${question.Formula}\``, inline: false });
  }
  
  return embed;
}

async function postDailyQuestion(client) {
  try {
    const question = getQuestionForDay();
    if (!question) {
      console.warn('⚠️ No question available for today');
      return;
    }
    
    const embed = createQuestionEmbed(question);
    
    // Post to all guilds in the vibe-code channel
    if (client.guilds.cache.size === 0) {
      console.warn('⚠️ Bot not connected to any guilds');
      return;
    }

    let postedCount = 0;
    for (const guild of client.guilds.cache.values()) {
      const channelId = process.env['vibe-coding'];
      let channel = null;
      
      if (channelId) {
        channel = guild.channels.cache.get(channelId);
      }
      
      // Fallback: search for channel containing "vibe-coding" or similar pattern
      if (!channel) {
        channel = guild.channels.cache.find(ch => 
          (ch.name.toLowerCase().includes('vibe-coding') ||
           (ch.name.toLowerCase().includes('vibe') && ch.name.toLowerCase().includes('coding'))) &&
          ch.isTextBased()
        );
      }
      
      if (channel) {
        try {
          await channel.send({
            content: '<@&1307057022453153813> Daily Coding Challenge! 🚀', // @Belmonts role
            embeds: [embed]
          });
          console.log(`✓ Posted daily question to ${guild.name}`);
          postedCount++;
        } catch (error) {
          console.error(`Error posting to ${guild.name}:`, error.message);
        }
      } else {
        console.warn(`⚠️ vibe-coding channel not found in guild: ${guild.name}`);
      }
    }
    
    if (postedCount === 0) {
      console.error('❌ Failed to post daily question to any guild');
    }
  } catch (error) {
    console.error('Error in postDailyQuestion:', error);
  }
}

function scheduleQuestionPost(client) {
  const timeUntilRun = getDelayUntilNextScheduledTime(15, 0); // 8:00 AM
  
  // Clear existing scheduler
  if (questionScheduler) {
    clearTimeout(questionScheduler);
  }
  
  // Schedule the question post
  questionScheduler = setTimeout(() => {
    postDailyQuestion(client);
    // Reschedule for the next day
    scheduleQuestionPost(client);
  }, timeUntilRun);
  
  const hoursLeft = Math.floor(timeUntilRun / (1000 * 60 * 60));
  const minutesLeft = Math.floor((timeUntilRun % (1000 * 60 * 60)) / (1000 * 60));
  
  console.log(`📅 Daily question scheduler initialized (Next: ${hoursLeft}h ${minutesLeft}m at 8:00 AM Asia/Kolkata)`);
}

function setupDailyQuestion(client) {
  client.once('ready', () => {
    console.log('✓ Daily question scheduler initialized');
    scheduleQuestionPost(client);
  });
}

module.exports = {
  setupDailyQuestion
};
