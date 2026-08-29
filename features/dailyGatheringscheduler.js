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
    reminderTimeout: null,
    liveTimeout: null,
};

const TIME_PROMPT_HOUR = 19; // 6 PM
const TIME_PROMPT_MINUTE = 00; // 00 minutes

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
        const commonHall = await getChannel(client, COMMON_HALL_CHANNEL_ID);
        if (commonHall && commonHall.isTextBased()) {
            const embed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle(`⏰ Reminder: Daily Gathering Starting in 5 Minutes!`)
                .setDescription(`<@&${BELMONTS_ROLE_ID}> Daily Gathering will start in **5 minutes**! Get ready to join the voice room: <#${VOICE_ROOM_ID}>`)
                .addFields(
                    { name: '⏰ Time', value: `**${gatheringTime}**`, inline: true },
                    { name: '🎙️ Voice Channel', value: `<#${VOICE_ROOM_ID}>`, inline: true }
                )
                .setFooter({ text: 'Get ready! ⏱️' })
                .setTimestamp();

            await commonHall.send({
                content: `<@&${BELMONTS_ROLE_ID}> ⏰ **Daily Gathering starts in 5 minutes in <#${VOICE_ROOM_ID}>!**`,
                embeds: [embed]
            });
        }

        const tinkering = await getChannel(client, TINKERING_CHANNEL_ID);
        if (tinkering && tinkering.isTextBased()) {
            await tinkering.send({
                content: `<@&${BELMONTS_ROLE_ID}> ⏰ **Daily Gathering starts in 5 minutes in <#${VOICE_ROOM_ID}>!**`
            });
        }

        console.log(`✓ Sent 5-minute reminder for gathering at ${gatheringTime}`);
    } catch (error) {
        console.error(`Error sending reminder:`, error.message);
    }
}

/**
 * Send announcement when gathering goes LIVE at the exact scheduled time
 */
async function sendGatheringLiveAnnouncement(client, gatheringTime) {
    try {
        const channel = await getChannel(client, COMMON_HALL_CHANNEL_ID);
        if (!channel || !channel.isTextBased()) {
            console.warn(`⚠ Common hall channel (${COMMON_HALL_CHANNEL_ID}) not found`);
            return;
        }

        const embed = new EmbedBuilder()
            .setColor('#EF4444')
            .setTitle(`🔴 Daily Gathering is Live Now!`)
            .setDescription(`<@&${BELMONTS_ROLE_ID}> Today's daily gathering has started!\n\n👉 **Join the voice channel now**: <#${VOICE_ROOM_ID}>`)
            .addFields(
                { name: '⏰ Started At', value: `**${gatheringTime}**`, inline: true },
                { name: '🎙️ Voice Channel', value: `<#${VOICE_ROOM_ID}>`, inline: true },
                { name: '📌 Note', value: 'Please join on time, participate actively, and share your daily updates! 💪✨', inline: false }
            )
            .setFooter({ text: 'Belmonts Daily Gathering • Happening Now 🎙️' })
            .setTimestamp();

        await channel.send({
            content: `<@&${BELMONTS_ROLE_ID}> 🔴 **The Daily Gathering is LIVE NOW! Click to join:** <#${VOICE_ROOM_ID}>`,
            embeds: [embed]
        });
        console.log(`✓ Posted LIVE gathering announcement to common-hall (${COMMON_HALL_CHANNEL_ID}) at ${gatheringTime}`);
    } catch (error) {
        console.error(`Error sending live announcement:`, error.message);
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

        // Check if any members are already in the voice channel
        try {
            const voiceChannel = await getChannel(client, VOICE_ROOM_ID);
            if (voiceChannel && voiceChannel.isVoiceBased()) {
                voiceChannel.members.forEach(m => {
                    if (!m.user.bot) {
                        gatheringSession.attendees.set(m.id, {
                            username: m.user.username,
                            displayName: m.displayName || m.user.username,
                            joinedAt: new Date(),
                            leftAt: null,
                        });
                        console.log(`✓ ${m.displayName} already in voice channel at gathering start`);
                    }
                });
            }
        } catch (vcErr) {
            // Ignore if unable to check
        }

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

        // Acknowledge interaction immediately to prevent "BliX didn't respond in time"
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let gatheringTime = null;
        let isCancellation = false;

        if (customId === 'gathering_cancel') {
            isCancellation = true;
        } else if (customId.startsWith('gathering_time_')) {
            const timeCode = customId.replace('gathering_time_', '');
            if (timeCode.length === 4 && /^\d+$/.test(timeCode)) {
                const hh = parseInt(timeCode.slice(0, 2), 10);
                const mm = parseInt(timeCode.slice(2, 4), 10);
                const hour12 = hh % 12 || 12;
                const ampm = hh >= 12 ? 'PM' : 'AM';
                const minuteStr = mm.toString().padStart(2, '0');
                gatheringTime = `${hh.toString().padStart(2, '0')}:${minuteStr} (${hour12}:${minuteStr} ${ampm})`;
            }
        }

        if (!isCancellation && !gatheringTime) {
            await interaction.editReply({ content: `⚠️ Unknown gathering action: \`${customId}\`` });
            return;
        }

        const today = getCurrentTimeInTimeZone().toISOString().split('T')[0];

        if (isCancellation) {
            // Cancel any pending scheduled timeouts
            if (gatheringSession.reminderTimeout) {
                clearTimeout(gatheringSession.reminderTimeout);
                gatheringSession.reminderTimeout = null;
            }
            if (gatheringSession.liveTimeout) {
                clearTimeout(gatheringSession.liveTimeout);
                gatheringSession.liveTimeout = null;
            }
            if (gatheringSession.endTimeout) {
                clearTimeout(gatheringSession.endTimeout);
                gatheringSession.endTimeout = null;
            }
            gatheringSession.isActive = false;
            gatheringSession.meetingId = null;
            gatheringSession.attendees.clear();

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

            await interaction.editReply({ embeds: [embed] });

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
            // Clear any previously scheduled timeouts if rescheduling
            if (gatheringSession.reminderTimeout) {
                clearTimeout(gatheringSession.reminderTimeout);
                gatheringSession.reminderTimeout = null;
            }
            if (gatheringSession.liveTimeout) {
                clearTimeout(gatheringSession.liveTimeout);
                gatheringSession.liveTimeout = null;
            }
            if (gatheringSession.endTimeout) {
                clearTimeout(gatheringSession.endTimeout);
                gatheringSession.endTimeout = null;
            }

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

            await interaction.editReply({ embeds: [embed] });

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

            // Calculate delay to exact meeting time using timezone utility
            const [time] = gatheringTime.split(' ');
            const [hours, minutes] = time.split(':');
            const targetHour = parseInt(hours, 10);
            const targetMinute = parseInt(minutes, 10);

            const delayToLiveMs = getDelayUntilNextScheduledTime(targetHour, targetMinute);
            const delayToReminderMs = Math.max(0, delayToLiveMs - 5 * 60 * 1000);

            console.log(`⏰ Gathering scheduled for ${gatheringTime}: Live in ${Math.round(delayToLiveMs / 1000 / 60)}m, Reminder in ${Math.round(delayToReminderMs / 1000 / 60)}m`);

            // Schedule 5-minute reminder if more than 5 minutes away
            if (delayToReminderMs > 0) {
                gatheringSession.reminderTimeout = setTimeout(() => {
                    sendGatheringReminder(client, gatheringTime);
                }, delayToReminderMs);
                console.log(`✓ 5-minute reminder scheduled for ${Math.round(delayToReminderMs / 1000 / 60)} minutes from now`);
            }

            // Schedule LIVE announcement and session start at the exact chosen time (e.g. 8:30 PM)
            const dateStr = getCurrentTimeInTimeZone().toISOString().split('T')[0];
            const startLiveSession = async () => {
                await sendGatheringLiveAnnouncement(client, gatheringTime);
                await startMeetingTracking(client, dateStr, time);

                // Schedule meeting conclusion after 2 hours (or earlier if everyone leaves once active)
                gatheringSession.endTimeout = setTimeout(() => {
                    endGatheringAndReport(client);
                }, 2 * 60 * 60 * 1000);
            };

            if (delayToLiveMs > 0) {
                gatheringSession.liveTimeout = setTimeout(startLiveSession, delayToLiveMs);
                console.log(`✓ LIVE meeting announcement scheduled for ${gatheringTime} (in ${Math.round(delayToLiveMs / 1000 / 60)} minutes)`);
            } else {
                // Scheduled for right now
                await startLiveSession();
            }

            console.log(`✓ Gathering confirmed for ${gatheringTime}`);
        }
    } catch (error) {
        console.error(`Error handling gathering time selection:`, error.message);
        try {
            if (interaction.deferred) {
                await interaction.editReply({ content: `⚠️ Error processing gathering selection: ${error.message}` });
            } else if (!interaction.replied) {
                await interaction.reply({ content: `⚠️ Error processing gathering selection: ${error.message}`, flags: MessageFlags.Ephemeral });
            }
        } catch (e) {
            // Ignore secondary failure
        }
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
