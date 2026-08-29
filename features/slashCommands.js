const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildLeaderboardEmbed, getLeaderboardButtons, buildMyPointsEmbed } = require('./leaderboard');
const { loadTerminologies, postDailyTerminology } = require('./dailyTerminology');
const { getLeaderboard, getMember, getMemberByUsername, getMemberByDiscordID, getMemberByDiscordUsername, getPoints, initializePoints, syncMember } = require('../database/db');
const fs = require('fs');
const path = require('path');

const BASHER_ROLE_NAME = (process.env.BASHER_ROLE_NAME || 'basher').trim().toLowerCase();

function normalizeRoleName(name) {
    return String(name || '').trim().toLowerCase();
}

async function isBasherMember(guild, userId, username) {
    const databaseMember = await getMemberByDiscordID(userId) || await getMemberByDiscordUsername(username) || await getMemberByUsername(username);
    if (databaseMember && normalizeRoleName(databaseMember.role) === BASHER_ROLE_NAME) {
        return true;
    }

    if (guild) {
        try {
            const member = await guild.members.fetch(userId);
            if (member) {
                const hasRole = member.roles.cache.some((role) => normalizeRoleName(role.name) === BASHER_ROLE_NAME);
                if (hasRole) return true;
            }
        } catch (error) {
            console.error('Error checking basher role:', error.message);
        }
    }

    return false;
}

// Cache for guild members to avoid rate limiting
const memberCache = new Map();

function buildHelpEmbed() {
    return new EmbedBuilder()
        .setColor('#5b9bd5')
        .setTitle('🤖 Bot Commands')
        .setDescription('Here are all available slash commands and what they do:')
        .addFields(
            { name: '/help', value: 'Show all commands and their usage.' },
            { name: '/leaderboard', value: 'Show top 10 users.' },
            { name: '/mypoints', value: 'Show your personal points and last update.' },
            { name: '/terminology', value: 'Show today\'s terminology.' },
            { name: '/next', value: 'Preview the next terminology (without changing today\'s).' },
            { name: '/prev', value: 'Preview the previous terminology.' },
            { name: '/dailyquestions', value: 'View today\'s daily programming question.' },
            { name: '/question <number>', value: 'View a specific question (1-129) with full details.' },
            { name: '/qd <difficulty>', value: 'Filter questions by difficulty level (Easy/Medium).' }
        )
        .setTimestamp();
}

function buildBasherHelpEmbed() {
    return new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🎯 Basher Commands')
        .setDescription('As a basher member, here are your available commands:')
        .addFields(
            { name: '/dailyquestions', value: 'View today\'s daily programming question with full details and explanation.' },
            { name: '/leaderboard', value: 'Show the leaderboard (top 10 users).' }
        )
        .setFooter({ text: '🚀 Focus on learning and growth!' })
        .setTimestamp();
}

function getTerminologyEmbed() {
    const data = loadTerminologies();

    if (!data.terminologies || data.terminologies.length === 0) {
        return null;
    }

    const terminology = data.terminologies[data.currentIndex];

    return new EmbedBuilder()
        .setColor('#4a90e2')
        .setTitle(`📚 Today's Tech Term: ${terminology.term}`)
        .setDescription(terminology.definition)
        .addFields(
            { name: '📂 Category', value: terminology.category, inline: true },
            { name: '📅 Term #', value: `${data.currentIndex + 1}/${data.terminologies.length}`, inline: true }
        )
        .setFooter({ text: 'Posted daily at 8:00 PM' })
        .setTimestamp();
}

function getNextTerminologyEmbed() {
    const data = loadTerminologies();

    if (!data.terminologies || data.terminologies.length === 0) {
        return null;
    }

    const nextIndex = (data.currentIndex + 1) % data.terminologies.length;
    const terminology = data.terminologies[nextIndex];

    return new EmbedBuilder()
        .setColor('#4a90e2')
        .setTitle(`📚 Next Tech Term: ${terminology.term}`)
        .setDescription(terminology.definition)
        .addFields(
            { name: '📂 Category', value: terminology.category, inline: true },
            { name: '📅 Term #', value: `${nextIndex + 1}/${data.terminologies.length}`, inline: true }
        )
        .setFooter({ text: 'Preview only - use /nextterm to post' })
        .setTimestamp();
}

function getPreviousTerminologyEmbed() {
    const data = loadTerminologies();

    if (!data.terminologies || data.terminologies.length === 0) {
        return null;
    }

    const prevIndex = (data.currentIndex - 1 + data.terminologies.length) % data.terminologies.length;
    const terminology = data.terminologies[prevIndex];

    return new EmbedBuilder()
        .setColor('#4a90e2')
        .setTitle(`📚 Previous Tech Term: ${terminology.term}`)
        .setDescription(terminology.definition)
        .addFields(
            { name: '📂 Category', value: terminology.category, inline: true },
            { name: '📅 Term #', value: `${prevIndex + 1}/${data.terminologies.length}`, inline: true }
        )
        .setFooter({ text: 'Previous terminology' })
        .setTimestamp();
}

function loadQuestionsData() {
    const questionsPath = path.join(__dirname, '../json/dailyQuestion.json');
    const data = fs.readFileSync(questionsPath, 'utf-8');
    return JSON.parse(data);
}

function loadQuestions() {
    const data = loadQuestionsData();
    return data.Questions || data;
}

function getTodaysQuestion() {
    const data = loadQuestionsData();
    const questions = data.Questions || data;
    const startDate = new Date(data.startDate);
    const today = new Date();
    
    // Calculate days elapsed since start date
    const timeDiff = today - startDate;
    const daysDiff = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
    
    // Get the current index (starting point) and add days elapsed
    const currentDayNumber = data.currentIndex + daysDiff;
    
    // Find the question with matching Day number
    const todayQuestion = questions.find(q => q.Day === currentDayNumber);
    return todayQuestion || questions[0];
}

function buildQuestionsEmbed(questions, startIndex = 0, itemsPerPage = 5) {
    const questions_list = questions.slice(startIndex, startIndex + itemsPerPage);
    
    const embed = new EmbedBuilder()
        .setColor('#f39c12')
        .setTitle('📝 Daily Programming Questions')
        .setDescription('Select a question to view details')
        .setFooter({ text: `Showing ${startIndex + 1}-${Math.min(startIndex + itemsPerPage, questions.length)} of ${questions.length} questions` });
    
    questions_list.forEach(q => {
        const value = `**Input:** ${q.Input}\n**Output:** ${q.Output}`;
        embed.addFields({ name: `Day ${q.Day}: ${q.Question}`, value: value, inline: false });
    });
    
    return embed;
}

function getQuestionsNavigationButtons(currentPage, totalPages) {
    const buttons = new ActionRowBuilder();
    
    if (currentPage > 1) {
        buttons.addComponents(
            new ButtonBuilder()
                .setCustomId(`questions_back_${currentPage - 1}`)
                .setLabel('⬅️ Previous')
                .setStyle(ButtonStyle.Primary)
        );
    }
    
    buttons.addComponents(
        new ButtonBuilder()
            .setCustomId('questions_page')
            .setLabel(`Page ${currentPage}/${totalPages}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
    );
    
    if (currentPage < totalPages) {
        buttons.addComponents(
            new ButtonBuilder()
                .setCustomId(`questions_next_${currentPage + 1}`)
                .setLabel('Next ➡️')
                .setStyle(ButtonStyle.Primary)
        );
    }
    
    return buttons;
}

function buildQuestionDetailEmbed(question) {
    const embed = new EmbedBuilder()
        .setColor('#27ae60')
        .setTitle(`📝 ${question.Question}`)
        .addFields(
            { name: '📥 Input', value: `\`\`\`\n${question.Input}\n\`\`\``, inline: false },
            { name: '📤 Output', value: `\`\`\`\n${String(question.Output)}\n\`\`\``, inline: false },
            { name: '💡 Explanation', value: question.Explain, inline: false }
        );
    
    if (question.Difficulty) {
        embed.addFields({ name: '⭐ Difficulty', value: question.Difficulty, inline: true });
    }
    
    if (question.Formula) {
        embed.addFields({ name: '📐 Formula', value: question.Formula, inline: false });
    }
    
    if (question.Method) {
        embed.addFields(
            { name: '🔧 Method', value: question.Method, inline: true },
            { name: '📞 Main Call', value: question['Main Call'], inline: true }
        );
    }
    
    embed.setTimestamp();
    
    return embed;
}

function buildDifficultyQuestionsEmbed(questions, difficulty, startIndex = 0, itemsPerPage = 5) {
    const filteredQuestions = questions.filter(q => q.Difficulty === difficulty);
    const questions_list = filteredQuestions.slice(startIndex, startIndex + itemsPerPage);
    
    const embed = new EmbedBuilder()
        .setColor('#f39c12')
        .setTitle(`📝 ${difficulty} Difficulty Questions`)
        .setDescription(`Showing ${difficulty} level programming questions`)
        .setFooter({ text: `Showing ${startIndex + 1}-${Math.min(startIndex + itemsPerPage, filteredQuestions.length)} of ${filteredQuestions.length} questions` });
    
    if (questions_list.length === 0) {
        embed.setDescription(`No ${difficulty} questions found.`);
        return embed;
    }
    
    questions_list.forEach(q => {
        const value = `**Input:** ${q.Input}\n**Output:** ${q.Output}`;
        embed.addFields({ name: `Day ${q.Day}: ${q.Question}`, value: value, inline: false });
    });
    
    return embed;
}

function getDifficultyQuestionsNavigationButtons(difficulty, currentPage, totalPages) {
    const buttons = new ActionRowBuilder();
    
    if (currentPage > 1) {
        buttons.addComponents(
            new ButtonBuilder()
                .setCustomId(`qd_back_${difficulty}_${currentPage - 1}`)
                .setLabel('⬅️ Previous')
                .setStyle(ButtonStyle.Primary)
        );
    }
    
    buttons.addComponents(
        new ButtonBuilder()
            .setCustomId('qd_page')
            .setLabel(`Page ${currentPage}/${totalPages}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
    );
    
    if (currentPage < totalPages) {
        buttons.addComponents(
            new ButtonBuilder()
                .setCustomId(`qd_next_${difficulty}_${currentPage + 1}`)
                .setLabel('Next ➡️')
                .setStyle(ButtonStyle.Primary)
        );
    }
    
    return buttons;
}

function buildCommands() {
    return [
        new SlashCommandBuilder()
            .setName('help')
            .setDescription('Show all available commands.'),
        new SlashCommandBuilder()
            .setName('leaderboard')
            .setDescription('Show the leaderboard (top 10 users).'),
        new SlashCommandBuilder()
            .setName('mypoints')
            .setDescription('Show your personal points.'),
        new SlashCommandBuilder()
            .setName('terminology')
            .setDescription('Show today\'s terminology.'),
        new SlashCommandBuilder()
            .setName('next')
            .setDescription('Preview the next terminology (without changing today\'s).'),
        new SlashCommandBuilder()
            .setName('prev')
            .setDescription('Preview the previous terminology.'),
        new SlashCommandBuilder()
            .setName('dailyquestions')
            .setDescription('View today\'s daily programming question.'),
        new SlashCommandBuilder()
            .setName('question')
            .setDescription('Get a specific programming question by number (1-129).')
            .addIntegerOption(option =>
                option.setName('number')
                    .setDescription('Question number (1-129)')
                    .setRequired(true)
                    .setMinValue(1)
                    .setMaxValue(129)
            ),
        new SlashCommandBuilder()
            .setName('qd')
            .setDescription('Get questions filtered by difficulty level.')
            .addStringOption(option =>
                option.setName('difficulty')
                    .setDescription('Choose difficulty: Easy or Medium')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Easy', value: 'Easy' },
                        { name: 'Medium', value: 'Medium' }
                    )
            )
    ].map(cmd => cmd.toJSON());
}

function handleSlashCommands(client) {
    client.once('ready', async () => {
        try {
            const commands = buildCommands();
            const guildId = process.env.GUILD_ID;
            if (guildId) {
                const guild = client.guilds.cache.get(guildId);
                if (guild) {
                    await guild.commands.set(commands);
                    await client.application.commands.set([]);
                    console.log(`✓ Slash commands registered for guild ${guildId}`);
                    
                    // Fetch and cache all guild members once at startup
                    try {
                        const members = await guild.members.fetch({ limit: 0 });
                        memberCache.set(guildId, Array.from(members.values()));
                        console.log(`✓ Cached ${members.size} guild members`);
                    } catch (error) {
                        console.warn('Could not cache guild members:', error.message);
                    }
                } else {
                    await client.application.commands.set(commands);
                }
            } else {
                await client.application.commands.set(commands);
            }
        } catch (error) {
            console.error('Failed to register slash commands:', error);
        }
    });

    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;
        const content = message.content.trim().toLowerCase();
        if (content === '/help') {
            return message.reply({ embeds: [buildHelpEmbed()] });
        }
    });

    client.on('interactionCreate', async (interaction) => {
        // Handle leaderboard pagination buttons
        if (interaction.isButton()) {
            if (interaction.customId.startsWith('leaderboard_')) {
                const [, direction, page] = interaction.customId.split('_');
                const currentPage = parseInt(page);
                const leaderboardData = await getLeaderboard();
                const totalPages = Math.ceil(leaderboardData.length / 10);
                
                let newPage = currentPage;
                if (direction === 'next') newPage = Math.min(currentPage + 1, totalPages);
                if (direction === 'back') newPage = Math.max(currentPage - 1, 1);

                const embed = buildLeaderboardEmbed(leaderboardData, newPage);
                const buttons = getLeaderboardButtons(newPage, totalPages);

                return interaction.update({ embeds: [embed], components: [buttons] });
            }
            
            // Handle questions pagination buttons
            if (interaction.customId.startsWith('questions_')) {
                const [, direction, page] = interaction.customId.split('_');
                const currentPage = parseInt(page);
                const questions = loadQuestions();
                const totalPages = Math.ceil(questions.length / 5);
                
                let newPage = currentPage;
                if (direction === 'next') newPage = Math.min(currentPage + 1, totalPages);
                if (direction === 'back') newPage = Math.max(currentPage - 1, 1);

                const startIndex = (newPage - 1) * 5;
                const embed = buildQuestionsEmbed(questions, startIndex);
                const buttons = getQuestionsNavigationButtons(newPage, totalPages);

                return interaction.update({ embeds: [embed], components: [buttons] });
            }
            
            // Handle difficulty filter questions pagination buttons
            if (interaction.customId.startsWith('qd_')) {
                const parts = interaction.customId.split('_');
                const direction = parts[1];
                const difficulty = parts[2];
                const page = parseInt(parts[3]);
                
                const questions = loadQuestions();
                const filteredQuestions = questions.filter(q => q.Difficulty === difficulty);
                const totalPages = Math.ceil(filteredQuestions.length / 5);
                
                let newPage = page;
                if (direction === 'next') newPage = Math.min(newPage + 1, totalPages);
                if (direction === 'back') newPage = Math.max(newPage - 1, 1);

                const startIndex = (newPage - 1) * 5;
                const embed = buildDifficultyQuestionsEmbed(questions, difficulty, startIndex);
                const buttons = getDifficultyQuestionsNavigationButtons(difficulty, newPage, totalPages);

                return interaction.update({ embeds: [embed], components: [buttons] });
            }
            return;
        }

        if (!interaction.isCommand()) return;

        // Defer reply immediately to prevent interaction timeout (3-second window)
        await interaction.deferReply({ ephemeral: false }).catch(e => console.error('Deferral error:', e));

        const { commandName } = interaction;
        
        // Check if user is a basher
        const userId = interaction.user.id;
        const username = interaction.user.username;
        const isBasher = await isBasherMember(interaction.guild, userId, username);
        
        // Bashers can use /dailyquestions, /leaderboard, and /help commands
        if (isBasher && commandName !== 'dailyquestions' && commandName !== 'leaderboard' && commandName !== 'help') {
            return interaction.editReply({
                content: '⚠️ As a basher member, you only have access to the `/dailyquestions` and `/leaderboard` commands. Focus on learning and solving problems! 🚀'
            });
        }

        if (commandName === 'help') {
            if (isBasher) {
                return interaction.editReply({ embeds: [buildBasherHelpEmbed()] });
            }
            return interaction.editReply({ embeds: [buildHelpEmbed()] });
        }

        if (commandName === 'leaderboard') {
            const leaderboardData = await getLeaderboard();
            
            const totalPages = Math.ceil(leaderboardData.length / 10);
            const embed = buildLeaderboardEmbed(leaderboardData, 1);
            const buttons = getLeaderboardButtons(1, totalPages);

            return interaction.editReply({ embeds: [embed], components: [buttons] });
        }

        if (commandName === 'mypoints') {
            const userId = interaction.user.id;
            const username = interaction.user.username;
            const displayName = interaction.member?.displayName || username;

                // Check if user is a basher
            const isBasher = await isBasherMember(interaction.guild, userId, username);

            if (isBasher) {
                // Bashers don't see points
                const embed = new EmbedBuilder()
                    .setColor('#ffa500')
                    .setTitle('🎯 Basher Member')
                    .setDescription(`Hey ${displayName}! As a basher member, your progress is being tracked separately. Keep learning and solving problems! 🚀`)
                    .setFooter({ text: 'Focus on learning and growth!' })
                    .setTimestamp();
                return interaction.editReply({ embeds: [embed] });
            } else {
                // Get member data from database using Discord ID (members_discord_id)
                let memberData = await getMemberByDiscordID(userId);
                
                // Fallback: try to find by username if Discord ID lookup fails
                if (!memberData) {
                    memberData = await getMemberByUsername(username);
                }
                
                // Fallback: try to find by member_id if all else fails
                if (!memberData) {
                    memberData = await getMember(userId);
                }
                
                if (!memberData) {
                    // User not found in database
                    const notFoundEmbed = new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('❌ Member Not Found')
                        .setDescription(`Sorry ${displayName}, you are not found in the members database. Please contact an admin to add you.`)
                        .setTimestamp();
                    return interaction.editReply({ embeds: [notFoundEmbed] });
                }
                
                // Get points for existing user
                const pointsData = await getPoints(memberData.member_id);

                const embed = buildMyPointsEmbed(memberData, { 
                    points: pointsData, 
                    last_update: new Date().toISOString() 
                });
                return interaction.editReply({ embeds: [embed] });
            }
        }

        if (commandName === 'terminology') {
            const embed = getTerminologyEmbed();

            if (!embed) {
                return interaction.editReply({ content: 'No terminologies available.' });
            }

            return interaction.editReply({ embeds: [embed] });
        }

        if (commandName === 'next') {
            const embed = getNextTerminologyEmbed();

            if (!embed) {
                return interaction.editReply({ content: 'No terminologies available.' });
            }

            return interaction.editReply({ embeds: [embed] });
        }

        if (commandName === 'prev') {
            const embed = getPreviousTerminologyEmbed();

            if (!embed) {
                return interaction.editReply({ content: 'No terminologies available.' });
            }

            return interaction.editReply({ embeds: [embed] });
        }

        if (commandName === 'dailyquestions') {
            const todayQuestion = getTodaysQuestion();
            
            if (!todayQuestion) {
                return interaction.editReply({
                    content: '❌ No question available for today.'
                });
            }
            
            const embed = buildQuestionDetailEmbed(todayQuestion);
            return interaction.editReply({ embeds: [embed] });
        }

        if (commandName === 'question') {
            const questionNumber = interaction.options.getInteger('number');
            const questions = loadQuestions();
            
            // Find question by Day number
            const question = questions.find(q => q.Day === questionNumber);
            
            if (!question) {
                return interaction.editReply({
                    content: `❌ Question #${questionNumber} not found. Available questions: 1-129`
                });
            }
            
            const embed = buildQuestionDetailEmbed(question);
            return interaction.editReply({ embeds: [embed] });
        }

        if (commandName === 'qd') {
            const difficulty = interaction.options.getString('difficulty');
            const questions = loadQuestions();
            const filteredQuestions = questions.filter(q => q.Difficulty === difficulty);
            
            if (filteredQuestions.length === 0) {
                return interaction.editReply({
                    content: `❌ No ${difficulty} difficulty questions found.`
                });
            }
            
            const totalPages = Math.ceil(filteredQuestions.length / 5);
            const embed = buildDifficultyQuestionsEmbed(questions, difficulty, 0);
            const buttons = getDifficultyQuestionsNavigationButtons(difficulty, 1, totalPages);

            return interaction.editReply({ embeds: [embed], components: [buttons] });
        }
    });
}

module.exports = { handleSlashCommands };

