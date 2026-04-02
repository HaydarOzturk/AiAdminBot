# Testing Guide — AiAdminBot

## Setting Up a Test Environment

**NEVER test on your production server.** Follow these steps to create a safe, isolated test environment.

---

### Step 1: Create a Test Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **"New Application"** → name it `AiAdminBot-Test`
3. Go to **Bot** tab → click **"Add Bot"**
4. Copy the **Bot Token** (you'll need this)
5. Enable these **Privileged Intents**:
   - ✅ Presence Intent
   - ✅ Server Members Intent
   - ✅ Message Content Intent
6. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Permissions: `Administrator`
   - Copy the invite URL

### Step 2: Create a Test Discord Server

1. Open Discord → click **"+"** to create a new server
2. Choose **"Create My Own"** → **"For me and my friends"**
3. Name it `AiAdminBot Test Server`
4. Paste the invite URL from Step 1 into your browser → add the bot to the test server

### Step 3: Create a Test `.env` File

```bash
# Copy your .env and modify it for testing
cp .env .env.test
```

Edit `.env.test`:
```env
# Use your TEST bot token (NOT the production one!)
DISCORD_TOKEN=your_test_bot_token_here

# Use a different database to avoid corrupting production data
DATABASE_PATH=./data/test-bot.db

# Use a different web port
WEB_PORT=3001
WEB_PASSWORD=testpassword

# Use your existing AI keys (safe — they're read-only APIs)
GEMINI_API_KEY=your_existing_key
# OPENROUTER_API_KEY=your_existing_key

# Enable all features for testing
AI_CHAT_ENABLED=true
AI_MODERATION_ENABLED=true
STREAMING_ENABLED=false
LINK_FILTER_ENABLED=false

# Set yourself as the debug owner for moderation testing
DEBUG_OWNER_ID=your_discord_user_id

# Locale for testing
LOCALE=en
```

### Step 4: Run in Test Mode

```bash
# Option A: Use the test env file directly
# On Windows:
copy .env.test .env
npm start

# Option B: Use the environment variable override
# On Linux/Mac:
DATABASE_PATH=./data/test-bot.db DISCORD_TOKEN=your_test_token node src/index.js
```

### Step 5: When Done Testing

```bash
# Restore your production .env
copy .env.production .env
# Or simply replace the DISCORD_TOKEN with your production bot token
```

---

## Test Checklist

### Critical Bug Fixes
- [ ] **XP Duplicate Fix**: Go to web dashboard → Leveling → Award XP to a user → Check leaderboard shows only ONE entry
- [ ] **Dedup Migration**: If you had duplicates, restart bot → check logs for "Migration: merged X duplicate user entries"

### AI Admin Agent
- [ ] `/ai-agent enable` → creates agent settings
- [ ] `/ai-agent enable #admin` → sets dedicated channel
- [ ] Type "show me the leaderboard" in agent channel → bot responds with leaderboard
- [ ] Type "create a voice channel called Team 1" → bot creates the channel
- [ ] Type "warn @user for spamming" → bot issues a warning
- [ ] Type "ban @user" → bot shows confirmation buttons (DO NOT confirm on production!)
- [ ] Click "Cancel" → action is cancelled
- [ ] Type "mute that user" → bot asks "which user?" (multi-turn)
- [ ] Non-admin types in agent channel → gets permission error
- [ ] `/ai-agent status` → shows current settings
- [ ] `/ai-agent disable` → disables agent

### Knowledge System
- [ ] `/knowledge add game "Raid nights are Tuesdays at 9 PM"` → stores knowledge
- [ ] `/knowledge add-faq "When are raids?" "Every Tuesday at 9 PM"` → stores FAQ
- [ ] `/knowledge search "raid schedule"` → finds matching entries
- [ ] `/knowledge list` → shows all entries
- [ ] `/knowledge delete <id>` → removes entry
- [ ] Send 10+ messages in a channel → `/what-did-i-miss` → AI summary
- [ ] `/what-did-i-miss hours:2 channel:#general` → summary for specific time/channel

### AutoMod
- [ ] `/automod enable` → activates all automod features
- [ ] `/automod status` → shows all settings
- [ ] `/automod toggle feature:anti_spam` → toggles spam detection
- [ ] Send 5+ rapid messages → automod deletes and warns
- [ ] Send @everyone spam → automod catches it
- [ ] `/automod disable` → deactivates

### Starboard
- [ ] `/starboard enable` → activates starboard
- [ ] React with ⭐ to a message 3+ times → appears in starboard channel
- [ ] `/starboard config threshold:5` → changes threshold

### Polls
- [ ] `/poll create question:"Best game?" option1:"Valorant" option2:"CS2" option3:"Apex"` → creates poll
- [ ] Click a vote button → vote recorded
- [ ] Click same button → vote removed
- [ ] `/poll ai topic:"What should we play tonight?"` → AI generates poll

### Giveaways
- [ ] `/giveaway start prize:"Nitro" duration:1 winners:1` → creates 1-minute giveaway
- [ ] Click "Enter" → entry recorded
- [ ] Wait 1 minute → winner auto-selected
- [ ] `/giveaway reroll message-id:<id>` → re-rolls winner

### Custom Commands
- [ ] `/custom-command add name:rules response:"Server rules: Be kind!"` → creates command
- [ ] Type `!rules` → bot responds with "Server rules: Be kind!"
- [ ] `/custom-command add name:roast response:"You are a witty roast master" ai:true` → creates AI command
- [ ] Type `!roast @user` → bot generates AI roast
- [ ] `/custom-command list` → shows all commands
- [ ] `/custom-command remove name:rules` → deletes command

### Web Dashboard
- [ ] Open `http://localhost:3001` → login with test password
- [ ] Go to Settings → Channels tab → verify channel list with found/missing status
- [ ] Change AI Chat channel name → save → verify .env updated
- [ ] Go to Leveling → Award XP → verify NO duplicate entries
- [ ] Go to Moderation → verify mod actions from agent appear in logs

### Multi-Language
- [ ] `/language` → select Turkish → verify all bot messages in Turkish
- [ ] Trigger automod → messages appear in Turkish
- [ ] Use AI Agent → responds in Turkish
- [ ] `/language` → select English → verify back to English

---

## Quick Start (TL;DR)

```bash
# 1. Create test bot at https://discord.com/developers/applications
# 2. Create test server, invite bot
# 3. Copy .env to .env.test, change DISCORD_TOKEN and DATABASE_PATH
# 4. Run:
copy .env.test .env
npm start
# 5. Test everything, then restore production .env when done
```
