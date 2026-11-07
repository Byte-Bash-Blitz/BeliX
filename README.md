# BeliX - Discord Bot

A comprehensive Discord bot designed to enhance community engagement with automated features, gamification, and educational content delivery.

## 🌟 Features

### 📚 Educational Content
- **Daily Programming Questions** - Browse 129 programming questions with difficulty levels and explanations
- **Daily Terminology** - Automated daily tech term posting to keep members learning
- **Question Browsing** - Paginated navigation through questions with `/dailyquestions` command

### 🎮 Gamification
- **Points System** - Members earn points through interactions and achievements
- **Leaderboard** - Real-time leaderboard showing top 10 performers with pagination
- **Personal Statistics** - Check your personal points and last activity with `/mypoints`

### 👥 Community Management
- **Member Synchronization** - Automatic member data sync with Discord roles and metadata
- **Welcome Messages** - Personalized welcome messages for new members
- **Birthday Announcements** - Automated birthday announcements for community members
- **Progress Updates** - Track member progress and milestones

### ⏰ Scheduling & Automation
- **Scheduled Reminders** - Customizable reminders for important events
- **Daily Posts** - Automated posting of terminologies and questions at scheduled times
- **Auto Synchronization** - Periodic member data synchronization

### 🛠️ Admin Features
- **Channel Setup** - Quick setup commands for bot channels and permissions
- **Database Management** - Integrated SQLite database for data persistence
- **Slash Commands** - Modern Discord slash commands for all functionality
- **Permission Control** - Role-based access control for commands

---

## 🔄 Automation Features

### Daily Automation
- **Daily Terminology Poster** - Posts a new terminology term every day at 8:00 PM
- **Daily Question Updates** - Tracks and cycles through programming questions
- **Scheduled Reminders** - Automatically sends reminders at configured times

### Real-Time Automation
- **Member Sync** - Automatically syncs member data when they join/leave
- **Points Tracking** - Tracks and updates member points automatically
- **Leaderboard Updates** - Real-time leaderboard calculations

### Background Tasks
- **Message Handlers** - Processes all member interactions
- **Activity Logging** - Logs all member activities for analytics
- **State Management** - Maintains synchronization state between Discord and database

---

## 📋 Slash Commands

### General & Gamification Commands
| Command | Description | Usage |
|---------|-------------|-------|
| `/help` | Show all available commands | `/help` |
| `/leaderboard` | Display top 10 users with pagination | `/leaderboard` |
| `/mypoints` | Show your personal points and statistics | `/mypoints` |
| `/terminology` | Show today's tech terminology | `/terminology` |
| `/next` | Preview the next terminology | `/next` |
| `/prev` | Preview the previous terminology | `/prev` |
| `/dailyquestions` | Browse 129 programming questions | `/dailyquestions` |
| `/question <number>` | View a specific question (1-129) | `/question number:1` |
| `/qd <difficulty>` | Filter questions by difficulty (Easy/Medium) | `/qd difficulty:Easy` |

### 🎙️ AI Voice Meeting Assistant Commands
| Command | Description | Usage |
|---------|-------------|-------|
| `/belix-join` | Connect BeliX to your current voice channel | `/belix-join` |
| `/belix-leave` | Disconnect BeliX from the voice channel | `/belix-leave` |
| `/belix-mode` | Set conversation mode (`wake-word` or `active-meeting`) | `/belix-mode mode:wake-word` |
| `/belix-mute` | Mute BeliX voice output | `/belix-mute` |
| `/belix-unmute` | Unmute BeliX voice output | `/belix-unmute` |
| `/belix-voice-status` | View voice session latency, state, and metrics | `/belix-voice-status` |
| `/belix-clear-context` | Clear meeting conversation memory | `/belix-clear-context` |
| `/belix-test` | Run diagnostics on Groq AI & voice synthesis | `/belix-test` |

### 💬 Natural Text Mentions (No `/` Slash Command Required!)
You can also invite and manage BeliX simply by **@mentioning the bot** in any text channel:

| Mention Phrase | Action |
|---|---|
| `@BeliX join` / `@BeliX please join` | BeliX joins your current voice channel and introduces itself |
| `@BeliX leave` / `@BeliX disconnect` / `@BeliX bye` | BeliX leaves the voice channel and ends the session |
| `@BeliX <your doubt or question>` | BeliX analyzes your question with Groq and **replies by voice** in the meeting voice channel while posting the transcript in chat! |
| `@BeliX status` | Displays active voice session status, channel, and metrics |
| `@BeliX mute` | Mutes voice output |
| `@BeliX unmute` | Unmutes voice output |
| `@BeliX` | Shows a quick guide on how to invite and speak with BeliX |

---

## 🎙️ AI Voice Meeting Assistant Architecture

BeliX features a real-time, ultra-fast AI voice assistant powered by **Groq** (Llama 3.3 & Whisper):

```
Participant Speaks
      ↓ (Discord Voice UDP)
@discordjs/voice (Opus Stream)
      ↓
prism-media (Opus Decoder -> 48kHz Stereo PCM)
      ↓
audioProcessor (Resample 3:1 -> 16kHz Mono 16-bit WAV)
      ↓
Groq Whisper STT (whisper-large-v3: Speech Recognition)
      ↓
Groq Llama 3.3 (llama-3.3-70b-versatile: Technical Reasoning & Context)
      ↓
Speech Generator (Natural Voice Audio MP3)
      ↓
Audio Player (@discordjs/voice -> Voice Channel Playback)
```

- **Wake Word Detection:** Responds to `"Hey BeliX"`, `"Hey Blix"`, and `"BeliX"` with clean question extraction and barge-in / interruption handling.
- **Two Operating Modes:**
  - `wake-word` (Default): Responds only when explicitly addressed.
  - `active-meeting`: Actively listens and contributes helpful insights to technical discussions.
- **Privacy & Security:** All incoming voice streams are processed in-memory for speech understanding. No raw audio is permanently stored on disk.
- **Ultra-Fast Performance:** Groq LPU inference provides near-instantaneous speech transcription and reasoning.

---

## 📦 Project Structure

```
BeliX/
├── index.js                          # Main bot entry point
├── package.json                      # Dependencies and metadata
├── README.md                         # This file
│
├── database/
│   ├── db.js                        # Database operations (SQLite)
│   ├── insertMembers.js             # Member data insertion
│   └── schema.sql                   # Database schema
│
├── json/
│   ├── dailyQuestion.json           # Daily coding questions
│   └── terminologies.json           # Daily tech terminologies
│
├── features/
│   ├── birthdayAnnouncement.js      # Birthday announcements
│   ├── channelSetup.js              # Channel configuration
│   ├── dailyGatheringScheduler.js   # Daily gathering coordination & tracking
│   ├── dailyQuestionPoster.js       # Question posting automation
│   ├── dailyTerminology.js          # Terminology management
│   ├── leaderboard.js               # Leaderboard display logic
│   ├── memberSync.js                # Member synchronization
│   ├── progressupdate.js            # Progress updates
│   ├── scheduledReminders.js        # Reminder scheduling
│   ├── slashCommands.js             # Slash command handlers
│   └── welcome.js                   # Welcome messages
│
├── json/
│   ├── dailyQuestion.json           # 129 programming questions (Days 1-129)
│   └── terminologies.json           # Tech terminology database
│
├── prompts/
│   └── botInstructions.txt          # Bot behavior guidelines
│
└── text/
    └── [Various text assets]        # Text resources
```

---

## 🚀 Installation & Setup

### Prerequisites
- Node.js (v16 or higher)
- Discord Bot Token
- SQLite3

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd BeliX
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   Create a `.env` file in the root directory:
   ```env
   TOKEN=your_discord_bot_token
   GUILD_ID=your_guild_id
   DATABASE_URL=./database.db
   ```

4. **Initialize the database**
   ```bash
   sqlite3 database.db < database/schema.sql
   ```

5. **Start the bot**
   ```bash
   node index.js
   ```

---

## 💾 Database

The bot uses **SQLite** for persistent data storage with the following main tables:

### Members
- User ID, Username, Join Date
- Role Information
- Member Metadata

### Points
- User ID, Points Balance
- Transaction History
- Last Update Timestamp

### Sync State
- Member sync status
- Last synchronization time
- Sync error tracking

---

## 📊 Data Files

### dailyQuestion.json
Contains 129 programming questions organized by day (Day 1-129), including:
- Question title
- Input example
- Expected output
- Detailed explanation
- Formula (where applicable)

### terminologies.json
Tech terminology database with:
- Term name
- Definition
- Category
- Current index pointer

---

## 🔐 Permissions, Intents & Voice Configuration

### Discord Developer Portal Intents
Enable the following Privileged Gateway Intents under **Bot -> Privileged Gateway Intents**:
- [x] **Server Members Intent** (for member synchronization and welcoming)
- [x] **Message Content Intent** (for reading messages and command triggers)

### Voice Permissions Required in Voice Channels
Ensure BeliX has a role or channel overwrite with:
- `Connect` (Permission to join the voice channel)
- `Speak` (Permission to transmit voice audio)
- `Use Voice Activity` (Detect participant speaking)
- `View Channel` (See the voice and text channels)

### Environment Configuration (.env)
```env
DISCORD_TOKEN=your_discord_bot_token
GUILD_ID=your_guild_id

# AI Engine: Groq API (Ultra-fast LLM & Whisper STT: https://console.groq.com/keys)
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=llama-3.3-70b-versatile
GROQ_WHISPER_MODEL=whisper-large-v3
VOICE_MODE=wake-word
```
- Token security via environment variables
- Rate limiting on API calls

---

## 🎯 Key Features Explained

### Points System
Members accumulate points through:
- Message interactions
- Command usage
- Event participation
- Achievement milestones

### Leaderboard
- Updated in real-time
- Top 10 players displayed
- Pagination support for browsing
- Personal rank visibility

### Member Synchronization
- Automatic sync on member join/leave
- Periodic bulk synchronization
- State tracking to prevent duplicates
- Metadata preservation

### Daily Terminology
- Scheduled posting at 8:00 PM
- Automatic rotation through terminologies
- Category-based organization
- Preview functionality

---

## 📈 Statistics & Metrics

The bot tracks:
- Total member points
- Leaderboard rankings
- Daily active members
- Command usage statistics
- Sync success/failure rates

---

## 🛡️ Error Handling

- Comprehensive error logging
- Graceful fallbacks for API failures
- Database transaction rollback on errors
- User-friendly error messages
- Retry mechanisms for failed operations

---

## 🔄 Update & Maintenance

### Regular Updates
- Daily terminology rotation
- Question of the day selection
- Member points synchronization
- Leaderboard recalculation

### Maintenance Tasks
- Database optimization
- Old data archival
- Sync state cleanup
- Cache management

---

## 📝 Configuration

### Bot Instructions
Edit `prompts/botInstructions.txt` to customize bot behavior

### Questions
Add new questions to `json/dailyQuestion.json` following the format:
```json
{
  "Day": 1,
  "Question": "Question title",
  "Input": "Sample input",
  "Output": "Expected output",
  "Explain": "Explanation",
  "Formula": "Optional formula"
}
```

### Terminologies
Add new terms to `json/terminologies.json`

### Reminders
Configure reminders through the bot's reminder system with time and message

---

## 🚦 Getting Started for Developers

1. Review the main entry point: [index.js](index.js)
2. Check slash command handlers: [features/slashCommands.js](features/slashCommands.js)
3. Explore database operations: [database/db.js](database/db.js)
4. Study automation features: [features/](features/)

---

## 📞 Support & Contribution

For issues, feature requests, or contributions:
1. Check existing documentation
2. Review code comments
3. Follow Discord.js best practices
4. Test thoroughly before submitting

---

## 📜 Technology Stack

- **Discord.js** - Discord API wrapper
- **SQLite3** - Database management
- **Node.js** - Runtime environment
- **JSON** - Data storage format

---

## 📅 Version Info

- **Current Version**: 1.0.0
- **Last Updated**: February 2026
- **Status**: Active & Maintained

---

## 🎓 Questions Database

The bot includes a comprehensive **129-day programming question bank** covering:
- Basic Programming Concepts
- Arithmetic & Logic Operations
- String & Number Manipulation
- Geometric Calculations
- Pattern Recognition
- Data Structures
- Object-Oriented Programming
- Advanced Algorithms

Perfect for daily learning and coding practice!

---

## 🌐 Community Features

- **Real-time Leaderboard** - See who's leading
- **Personal Statistics** - Track your progress
- **Daily Learning** - 129 programming questions
- **Tech Insights** - Daily terminology posts
- **Community Events** - Meeting tracking & announcements

---

**Made with ❤️ for the Community**
