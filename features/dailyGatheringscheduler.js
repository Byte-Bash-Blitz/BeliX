const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags } = require('discord.js');
const { getDelayUntilNextScheduledTime, getCurrentTimeInTimeZone } = require('../utils/timezoneUtils');
const {
    confirmGathering,
    cancelGathering,
    updateGatheringTime,
    getGatheringStatus,
    createMeeting,
    updateMeetingEnd,
    recordAttendance,
    getMember,
    addPoints
} = require('../database/db');

// Channel IDs
const TINKERING_CHANNEL_ID = process.env.tinkering || '1361235736774447247';
const COMMON_HALL_CHANNEL_ID = process.env['common-hall'] || '1304848106789015647';
const REPORTS_CHANNEL_ID = '1475575831601610862';
const VOICE_ROOM_ID = process.env['voiceroom-Common-hall'] || '1304848107095326830';
const BELMONTS_ROLE_ID = '1307057022453153813';

/**
 * Helper to get a channel by ID, checking cache first and fetching from API if not cached
 */
async function getChannel(client, channelId) {
    try {
        let channel = client.channels.cache.get(channelId);
        if (!channel) {
            channel = await client.channels.fetch(channelId).catch(() => null);
        }
        return channel;
    } catch (error) {
        console.error(`Error fetching channel ${channelId}:`, error.message);
        return null;
    }
}

// Store tracking data
const gatheringSession = {
    isActive: false,
    meetingId: null,
    startTime: null,
    attendees: new Map(), // userId -> {username, displayName, joinedAt, leftAt}
    messageId: null,
    endTimeout: null, // Store timeout ID so we can clear it if needed
};

const TIME_PROMPT_HOUR = 19; // 6 PM
const TIME_PROMPT_MINUTE = 0; // 00 minutes

/**
 * Ask for gathering time in tinkering channel
 */
async function askForGatheringTime(client) {
    try {
        const channel = await getChannel(client, TINKERING_CHANNEL_ID);
        if (!channel || !channel.isTextBased()) {
            console.warn(`⚠ Tinkering channel not found`);
            return;
        }

        const today = getCurrentTimeInTimeZone();
        const dateStr = today.toLocaleDateString();

        const embed = new EmbedBuilder()
            .setColor('#FF6B9D')
            .setTitle(`📅 Daily Gathering Time - ${dateStr}`)
            .setDescription(`What time should today's daily gathering be held?`)
            .addFields(
                { name: '📝 Instructions', value: 'Use the buttons below to set the gathering time or cancel today\'s gathering.' }
            )
            .setFooter({ text: 'Click on a time or cancel button' })
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('gathering_time_2000')
                    .setLabel('8:00 PM')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('gathering_time_2030')
                    .setLabel('8:30 PM')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('gathering_time_2100')
                    .setLabel('9:00 PM')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('gathering_cancel')
                    .setLabel('Cancel Today')
                    .setStyle(ButtonStyle.Danger)
            );

        await channel.send({ embeds: [embed], components: [row] });
        console.log(`✓ Asked for gathering time in tinkering channel`);
    } catch (error) {
        console.error(`Error asking for gathering time:`, error.message);
    }
}

/**
 * Schedule gathering time prompt
 */
function scheduleGatheringPrompt(client) {
    function scheduleNext() {
        const delay = getDelayUntilNextScheduledTime(TIME_PROMPT_HOUR, TIME_PROMPT_MINUTE);
        const hoursUntil = Math.floor(delay / (1000 * 60 * 60));
        const minutesUntil = Math.floor((delay % (1000 * 60 * 60)) / (1000 * 60));

        console.log(
            `📅 [Belmonts] Next gathering prompt in ${hoursUntil}h ${minutesUntil}m`
        );

        setTimeout(async () => {
            await askForGatheringTime(client);
            scheduleNext();
        }, delay);
    }

    scheduleNext();
}

/**
 * Post gathering announcement to common-hall
 */
async function postGatheringAnnouncement(client, gatheringTime, confirmedBy = null) {
    try {
        const channel = await getChannel(client, COMMON_HALL_CHANNEL_ID);
        if (!channel || !channel.isTextBased()) {
            console.warn(`⚠ Common hall channel (${COMMON_HALL_CHANNEL_ID}) not found or not text-based`);
            return { success: false, error: 'CHANNEL_NOT_FOUND' };
        }

        const embed = new EmbedBuilder()
            .setColor('#10B981')
            .setTitle(`🎙️ Today's Daily Gathering Confirmed`)
            .setDescription(`<@&${BELMONTS_ROLE_ID}> Daily Gathering has been scheduled for today!`)
            .addFields(
                { name: '⏰ Time', value: `**${gatheringTime}**`, inline: true },
                { name: '🎙️ Location', value: 'Voice Channel: Common Hall', inline: true }
            );

        if (confirmedBy) {
            embed.addFields({ name: '👤 Confirmed by', value: `**${confirmedBy}**`, inline: true });
        }

        embed.addFields(
            { name: '📌 Note', value: 'Please join on time and participate actively!', inline: false }
        );

        embed.setFooter({ text: confirmedBy ? `Confirmed by: ${confirmedBy} • See you there!` : 'See you there!' })
            .setTimestamp();

        await channel.send({
            content: `<@&${BELMONTS_ROLE_ID}> 🎙️ **Daily Gathering Confirmed for ${gatheringTime}!**`,
            embeds: [embed]
        });
        console.log(`✓ Posted gathering announcement to common-hall (${COMMON_HALL_CHANNEL_ID}) at ${gatheringTime}`);
        return { success: true };
    } catch (error) {
        console.error(`Error posting announcement to common-hall:`, error.message);
        if (error.code === 50001 || error.message?.includes('Missing Access')) {
            console.error(`🚨 DISCORD PERMISSION ERROR: The bot does not have access to view or send messages in #common-hall (${COMMON_HALL_CHANNEL_ID})!`);
            console.error(`👉 ACTION REQUIRED: In Discord, edit #common-hall channel settings -> Permissions -> Add role 'BliX' (or assign the '@Belmonts' role to the bot).`);
        }
        return { success: false, error: error.code || error.message };
    }
}

/**
 * Send reminder 5 minutes before gathering
 */
async function sendGatheringReminder(client, gatheringTime) {
    try {
        const channel = await getChannel(client, TINKERING_CHANNEL_ID);
        if (!channel || !channel.isTextBased()) return;

        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle(`⏰ Reminder: Gathering Starting Soon!`)
            .setDescription(`<@&${BELMONTS_ROLE_ID}> Daily Gathering will start in **5 minutes**!`)
            .addFields(
                { name: '⏰ Time', value: `**${gatheringTime}**`, inline: false },
                { name: '🎙️ Channel', value: 'Join: Common Hall Voice Room', inline: false }
            )
            .setColor('#FFD700')
            .setFooter({ text: 'Get ready! ⏱️' })
            .setTimestamp();

        await channel.send({ embeds: [embed] });
        console.log(`✓ Sent 5-minute reminder for gathering at ${gatheringTime}`);
    } catch (error) {
        console.error(`Error sending reminder:`, error.message);
    }
}

/**
 * Start tracking meeting
 */
async function startMeetingTracking(client, gatheringDate, gatheringTime) {
    try {
        const meetingTitle = `Daily Gathering - ${gatheringDate}`;
        const [hours, minutes] = gatheringTime.split(':');

        // Use current time as the actual start_time when meeting begins
        const now = getCurrentTimeInTimeZone();
        const startTime = new Date(now);

        const meetingData = {
            title: meetingTitle,
            meeting_date: gatheringDate,
            meeting_time: `${hours}:${minutes}:00`,
            start_time: startTime.toISOString(),
        };

        // Create meeting in database
        const meeting = await createMeeting(meetingData);
        const meetingId = meeting?.meeting_id || `meeting_${Date.now()}`;
        if (!meeting) {
            console.warn(`⚠ Could not save meeting to database. Continuing with in-memory session ${meetingId}.`);
        }

        gatheringSession.meetingId = meetingId;
        gatheringSession.isActive = true;
        gatheringSession.startTime = startTime;
        gatheringSession.attendees.clear();

        console.log(`✓ Meeting tracking started (ID: ${gatheringSession.meetingId}) at ${startTime.toLocaleTimeString()}`);
    } catch (error) {
        console.error(`Error starting meeting tracking:`, error.message);
    }
}

/**
 * Track voice channel attendance
 */
async function trackVoiceActivity(client) {
    client.on('voiceStateUpdate', async (oldState, newState) => {
        if (!gatheringSession.isActive || !gatheringSession.meetingId) return;

        const voiceChannelId = VOICE_ROOM_ID;
        const userId = newState.id;
        const member = newState.member;

        // User joined the gathering voice channel
        if (!oldState.channel && newState.channel?.id === voiceChannelId) {
            const displayName = member?.displayName || member?.user.username;
            gatheringSession.attendees.set(userId, {
                username: member?.user.username,
                displayName: displayName,
                joinedAt: new Date(),
                leftAt: null,
            });
            console.log(`✓ ${displayName} joined gathering`);
        }

        // User left the gathering voice channel
        if (oldState.channel?.id === voiceChannelId && !newState.channel) {
            const attendee = gatheringSession.attendees.get(userId);
            if (attendee) {
                attendee.leftAt = new Date();
                console.log(`✓ ${attendee.displayName} left gathering`);
            }

            // Check if voice channel is now empty
            const voiceChannel = client.channels.cache.get(voiceChannelId);
            if (voiceChannel && voiceChannel.isVoiceBased()) {
                const members = voiceChannel.members.filter(m => !m.user.bot);

                if (members.size === 0 && gatheringSession.isActive) {
                    console.log(`📢 Voice channel is empty! Ending gathering and sending report...`);

                    // Clear the 2-hour timeout
                    if (gatheringSession.endTimeout) {
                        clearTimeout(gatheringSession.endTimeout);
                        gatheringSession.endTimeout = null;
                    }

                    // End gathering immediately
                    await endGatheringAndReport(client);
                }
            }
        }
    });
}

/**
 * End gathering and generate report
 */
async function endGatheringAndReport(client) {
    if (!gatheringSession.isActive || !gatheringSession.meetingId) {
        console.log(`⚠ No active gathering to end`);
        return;
    }

    try {
        // Clear any pending timeout
        if (gatheringSession.endTimeout) {
            clearTimeout(gatheringSession.endTimeout);
            gatheringSession.endTimeout = null;
        }

        const endTime = new Date();
        const startTime = gatheringSession.startTime;
        const totalDurationMs = Math.abs(endTime - startTime);
        const totalDurationMinutes = Math.floor(totalDurationMs / (1000 * 60));
        const hours = Math.floor(totalDurationMinutes / 60);
        const minutes = totalDurationMinutes % 60;

        // Calculate attendance for each member
        const attendanceRecords = [];
        let fullyAttendedCount = 0;

        for (const [userId, attendee] of gatheringSession.attendees) {
            if (!attendee.leftAt) {
                attendee.leftAt = endTime;
            }

            const durationMs = attendee.leftAt - attendee.joinedAt;
            const durationMinutes = Math.floor(durationMs / (1000 * 60));
            const attendancePercentage = Math.round((durationMinutes / totalDurationMinutes) * 100);

            // Award points: 10 points for 50%+ attendance
            let pointsAwarded = 0;
            if (attendancePercentage >= 50) {
                pointsAwarded = 10;
                if (attendancePercentage >= 95) {
                    fullyAttendedCount++;
                }
            }

            attendanceRecords.push({
                userId,
                displayName: attendee.displayName,
                durationMinutes,
                attendancePercentage,
                pointsAwarded,
            });

            // Record attendance in database
            try {
                // Get the database member_id by looking up the Discord ID
                const member = await getMember(userId);
                const memberId = member ? member.member_id : null;

                if (!memberId) {
                    console.warn(`Warning: Member ${userId} (${attendee.displayName}) not found in database, skipping attendance record`);
                    continue;
                }

                const attendanceData = {
                    member_id: memberId,
                    username: attendee.username,
                    display_name: attendee.displayName,
                    joined_at: attendee.joinedAt.toISOString(),
                    left_at: attendee.leftAt.toISOString(),
                    total_duration_minutes: durationMinutes,
                    attendance_percentage: attendancePercentage,
                    points_awarded: pointsAwarded,
                };
                await recordAttendance(gatheringSession.meetingId, attendanceData);

                // Add points to member if they earned any
                if (pointsAwarded > 0) {
                    await addPoints(memberId, pointsAwarded);
                    console.log(`✓ Added ${pointsAwarded} points to ${attendee.displayName}`);
                }
            } catch (error) {
                console.error(`Error recording attendance for ${attendee.displayName}:`, error.message);
            }
        }

        // Sort by attendance percentage (descending)
        attendanceRecords.sort((a, b) => b.attendancePercentage - a.attendancePercentage);

        // Build report embed
        const embed = new EmbedBuilder()
            .setColor('#10B981')
            .setTitle(`📊 Final Meeting Report`)
            .addFields({
                name: `📅 Daily Gathering - ${getCurrentTimeInTimeZone().toLocaleDateString()}`,
                value: `🎙️ Channel: Common Hall`,
                inline: false
            })
            .addFields({
                name: `⏱️ Meeting Duration`,
                value: `${hours}h ${minutes}m`,
                inline: true
            })
            .addFields({
                name: `👥 Total Attendees`,
                value: `${gatheringSession.attendees.size}`,
                inline: true
            });

        // Add attendance details in chunks to avoid Discord field limit
        if (attendanceRecords.length > 0) {
            const chunkSize = 20; // Split attendees into chunks of 20
            for (let i = 0; i < attendanceRecords.length; i += chunkSize) {
                const chunk = attendanceRecords.slice(i, i + chunkSize);
                let attendanceText = ``;
                chunk.forEach((record) => {
                    const medal = record.attendancePercentage >= 95 ? `⭐` : ``;
                    attendanceText += `${medal} **${record.displayName}** - ${record.durationMinutes}m (${record.attendancePercentage}%)\n`;
                });

                const fieldName = i === 0 ? `📋 Attendance List` : `📋 Attendance List (cont'd)`;
                embed.addFields({
                    name: fieldName,
                    value: attendanceText || 'No attendees',
                    inline: false
                });
            }
        }

        embed.addFields({
            name: `⭐ Full Attendance (95%+)`,
            value: `${fullyAttendedCount} members`,
            inline: true
        });

        embed.setFooter({ text: 'Meeting concluded' })
            .setTimestamp();

        // Send report to chamber-of-reckoning (reports channel)
        const reportsChannel = await getChannel(client, REPORTS_CHANNEL_ID);
        if (reportsChannel && reportsChannel.isTextBased()) {
            await reportsChannel.send({ embeds: [embed] });
            console.log(`✓ Meeting report sent to chamber-of-reckoning`);
        } else {
            console.warn(`⚠ Reports channel not found`);
        }

        // Update meeting end time in database
        try {
            await updateMeetingEnd(gatheringSession.meetingId, {
                end_time: endTime.toISOString(),
                duration_minutes: totalDurationMinutes,
                attended_members: gatheringSession.attendees.size,
            });
        } catch (error) {
            console.error(`Error updating meeting end time:`, error.message);
        }

        // Reset session
        gatheringSession.isActive = false;
        gatheringSession.meetingId = null;
        gatheringSession.attendees.clear();
        gatheringSession.endTimeout = null;

        console.log(`✓ Gathering tracking ended and report generated`);
    } catch (error) {
        console.error(`Error ending gathering:`, error.message);
    }
}

/**
 * Handle gathering time selection
 */
async function handleGatheringTimeSelection(client, interaction) {
    try {
        const customId = interaction.customId;
        const userId = interaction.user.id;
        const member = interaction.member;
        const displayName = member?.displayName || interaction.user.username;

        if (!interaction.isButton()) return;

        let gatheringTime = null;
        let isCancellation = false;

        if (customId === 'gathering_time_2000' || customId === 'gathering_time_1900') {
            gatheringTime = '20:00 (8:00 PM)';
        } else if (customId === 'gathering_time_2030' || customId === 'gathering_time_1930') {
            gatheringTime = '20:30 (8:30 PM)';
        } else if (customId === 'gathering_time_2100') {
            gatheringTime = '21:00 (9:00 PM)';
        } else if (customId === 'gathering_cancel') {
            isCancellation = true;
        }

        const today = getCurrentTimeInTimeZone().toISOString().split('T')[0];

        if (isCancellation) {
            // Cancel gathering in database
            await cancelGathering(today, userId, displayName);

            // Send cancellation notification to common-hall
            const channel = await getChannel(client, COMMON_HALL_CHANNEL_ID);
            let sendError = null;
            if (channel && channel.isTextBased()) {
                try {
                    const cancelEmbed = new EmbedBuilder()
                        .setColor('#EF4444')
                        .setTitle(`❌ Daily Gathering Cancelled`)
                        .setDescription(`<@&${BELMONTS_ROLE_ID}> Today's Daily Gathering has been cancelled.`)
                        .addFields(
                            { name: 'Status', value: `❌ Cancelled for today`, inline: true },
                            { name: 'Cancelled by', value: `**${displayName}**`, inline: true }
                        )
                        .setFooter({ text: `Cancelled by: ${displayName}` })
                        .setTimestamp();

                    await channel.send({
                        content: `<@&${BELMONTS_ROLE_ID}> ❌ **Today's Daily Gathering has been cancelled.**`,
                        embeds: [cancelEmbed]
                    });
                    console.log(`✓ Posted gathering cancellation to common-hall (${COMMON_HALL_CHANNEL_ID})`);
                } catch (err) {
                    sendError = err;
                    console.error(`Error posting cancellation to common-hall:`, err.message);
                    if (err.code === 50001 || err.message?.includes('Missing Access')) {
                        console.error(`🚨 DISCORD PERMISSION ERROR: The bot lacks permission to view or send messages in #common-hall (${COMMON_HALL_CHANNEL_ID})!`);
                        console.error(`👉 ACTION REQUIRED: In Discord, edit #common-hall channel settings -> Permissions -> Add role 'BliX' (or assign the '@Belmonts' role to the bot).`);
                    }
                }
            } else {
                console.warn(`⚠ Common hall channel (${COMMON_HALL_CHANNEL_ID}) not found or not text-based`);
            }

            // Ephemeral confirmation to the user who clicked
            let cancelDesc = `Today's gathering has been cancelled by **${displayName}**.\nNotice has been sent to <#${COMMON_HALL_CHANNEL_ID}>!`;
            if (sendError && (sendError.code === 50001 || sendError.message?.includes('Missing Access'))) {
                cancelDesc = `Today's gathering has been cancelled.\n\n⚠️ **Permission Alert**: The bot could not post to <#${COMMON_HALL_CHANNEL_ID}> because the bot is missing **View Channel** access in \`#common-hall\`! Please assign the **@Belmonts** role to the bot in Discord.`;
            }

            const embed = new EmbedBuilder()
                .setColor('#EF4444')
                .setTitle(`❌ Gathering Cancelled`)
                .setDescription(cancelDesc)
                .setTimestamp();

            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

            // Disable buttons on the original tinkering prompt message to avoid duplicate clicks
            try {
                if (interaction.message?.components?.length > 0) {
                    const row = ActionRowBuilder.from(interaction.message.components[0]);
                    row.components.forEach(btn => btn.setDisabled(true));
                    await interaction.message.edit({ components: [row] });
                }
            } catch (err) {
                // Ignore if unable to edit prompt message
            }

            console.log(`✓ Gathering cancelled by ${displayName}`);
        } else if (gatheringTime) {
            // Confirm gathering with time in database
            const timeStr = gatheringTime.split(' ')[0] + ':00';
            await confirmGathering(userId, displayName, today, timeStr);
            await updateGatheringTime(today, gatheringTime.split(' ')[0]);

            // Send confirmation announcement to common-hall
            const announceResult = await postGatheringAnnouncement(client, gatheringTime, displayName);

            // Ephemeral confirmation to the user who clicked
            let confirmDesc = `Gathering confirmed for today at **${gatheringTime}**.\nConfirmation announcement has been posted to <#${COMMON_HALL_CHANNEL_ID}>!`;
            if (!announceResult.success && (announceResult.error === 50001 || String(announceResult.error).includes('Missing Access'))) {
                confirmDesc = `Gathering confirmed for today at **${gatheringTime}**.\n\n⚠️ **Permission Alert**: The bot could not post to <#${COMMON_HALL_CHANNEL_ID}> because the bot is missing **View Channel** access in \`#common-hall\`! Please assign the **@Belmonts** role to the bot in Discord.`;
            }

            const embed = new EmbedBuilder()
                .setColor('#10B981')
                .setTitle(`✅ Gathering Time Set`)
                .setDescription(confirmDesc)
                .setFooter({ text: `Set by: ${displayName}` })
                .setTimestamp();

            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

            // Disable buttons on the original tinkering prompt message to avoid duplicate clicks
            try {
                if (interaction.message?.components?.length > 0) {
                    const row = ActionRowBuilder.from(interaction.message.components[0]);
                    row.components.forEach(btn => btn.setDisabled(true));
                    await interaction.message.edit({ components: [row] });
                }
            } catch (err) {
                // Ignore if unable to edit prompt message
            }

            // Schedule reminder (5 minutes before)
            const [time] = gatheringTime.split(' ');
            const [hours, minutes] = time.split(':');
            const targetHour = parseInt(hours);
            const targetMinute = parseInt(minutes);

            // Calculate delay to gathering time using timezone-aware functions
            const now = getCurrentTimeInTimeZone();
            const gatheringTimeToday = new Date(now);
            gatheringTimeToday.setHours(targetHour, targetMinute, 0, 0);

            // If gathering time has passed, it's for tomorrow
            let gatheringDateTime = gatheringTimeToday;
            if (gatheringTimeToday <= now) {
                gatheringDateTime = new Date(gatheringTimeToday);
                gatheringDateTime.setDate(gatheringDateTime.getDate() + 1);
            }

            // Calculate reminder time (5 minutes before)
            const reminderDateTime = new Date(gatheringDateTime.getTime() - 5 * 60 * 1000);

            // Calculate delay accounting for timezone offset
            const systemNow = new Date();
            const tzOffset = systemNow.getTime() - now.getTime();
            const adjustedReminderTime = reminderDateTime.getTime() + tzOffset;
            const delayMs = Math.max(0, adjustedReminderTime - systemNow.getTime());

            console.log(`⏰ Reminder scheduled: gathering=${gatheringDateTime.toLocaleTimeString()}, reminder=${reminderDateTime.toLocaleTimeString()}, delay=${delayMs}ms`);

            if (delayMs > 0) {
                setTimeout(() => sendGatheringReminder(client, gatheringTime), delayMs);
                console.log(`✓ 5-minute reminder will be sent in ${Math.round(delayMs / 1000 / 60)} minutes`);
            } else {
                console.warn(`⚠ Reminder time is in the past. Not scheduling.`);
            }

            // Start meeting tracking
            const dateStr = getCurrentTimeInTimeZone().toISOString().split('T')[0];
            await startMeetingTracking(client, dateStr, time);

            // Schedule end after 2 hours (or earlier if everyone leaves)
            gatheringSession.endTimeout = setTimeout(() => {
                endGatheringAndReport(client);
            }, 2 * 60 * 60 * 1000);

            console.log(`✓ Gathering confirmed for ${gatheringTime}`);
        }
    } catch (error) {
        console.error(`Error handling gathering time selection:`, error.message);
    }
}

/**
 * Initialize gathering scheduler
 */
function handleGatheringScheduler(client) {
    const init = () => {
        console.log('✓ Belmonts - gathering scheduler enabled');
        scheduleGatheringPrompt(client);
        trackVoiceActivity(client);
    };

    if (client.isReady && client.isReady()) {
        init();
    } else {
        client.once('ready', init);
    }

    // Handle button interactions
    client.on('interactionCreate', (interaction) => {
        if (interaction.customId?.startsWith('gathering_')) {
            handleGatheringTimeSelection(client, interaction);
        }
    });
}

module.exports = {
    handleGatheringScheduler,
    endGatheringAndReport
};
