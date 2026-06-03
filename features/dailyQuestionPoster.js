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
  // Automation disabled: daily question posting commented per request.
  // To re-enable, uncomment the implementation below.
  console.log('Daily question posting is disabled (commented out).');
}

function scheduleQuestionPost(client) {
  // Scheduling disabled: daily question automation commented per request.
  // To re-enable, uncomment the implementation that uses getDelayUntilNextScheduledTime and setTimeout.
  console.log('Daily question scheduler is disabled (commented out).');
}

function setupDailyQuestion(client) {
  // Automation disabled: setup is commented out. Keep function to avoid breaking imports.
  client.once('ready', () => {
    console.log('Daily question feature is disabled (setup commented out).');
  });
}

module.exports = {
  setupDailyQuestion
};
