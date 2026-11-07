const { EmbedBuilder } = require('discord.js');

function buildAttendanceAnalyticsEmbed(analytics) {
    return new EmbedBuilder()
        .setColor('#5B9BD5')
        .setTitle('📈 Common Hall Attendance Analytics')
        .addFields(
            { name: 'Total meetings', value: String(analytics.totalMeetings), inline: true },
            { name: 'Unique attendees', value: String(analytics.totalUniqueAttendees), inline: true },
            { name: '✅ PRESENT', value: String(analytics.presentMembers), inline: true },
            { name: '⏳ SHORT DURATION', value: String(analytics.shortDurationMembers), inline: true },
            { name: 'Total voice minutes', value: String(analytics.totalVoiceMinutes), inline: true },
            { name: 'Average duration', value: `${analytics.averageAttendanceMinutes} minutes`, inline: true },
        )
        .setDescription(
            analytics.history.length
                ? analytics.history.slice(0, 10).map(meeting => {
                    const date = meeting.meeting_date || 'Unknown date';
                    const count = meeting.attendance?.length || 0;
                    return `**${date}** — ${count} recorded attendees`;
                }).join('\n')
                : 'No attendance history is available.'
        )
        .setFooter({ text: 'Based on the latest 30 meetings' })
        .setTimestamp();
}

module.exports = { buildAttendanceAnalyticsEmbed };
