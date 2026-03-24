# AiAdminBot v1.4.0

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2.svg)](https://discord.js.org)

AI-powered Discord server administration bot with a full web dashboard, multi-language support, leveling system, and moderation tools.

## Features

### Discord Bot Commands (33 slash commands)

**Moderation** — ban, kick, mute, timeout, warn, warnings, clear, blocklist, mod-history, mod-stats, case

**Roles** — give-role, remove-role, role-menu

**Leveling** — rank, leaderboard, award (owner-only, max 30 XP), reset-xp (user or server)

**Setup** — setup (auto-create channels, roles, verification), fix-permissions, language, template-export, template-import, server-reset

**AI** — ai-chat, ai-setup, ai-setup-apply, ai-setup-cancel (Google Gemini or OpenRouter)

**Utility** — help, ping, suggest, sync, verify

### Web Dashboard

A full admin panel accessible at `http://your-server:PORT` with password authentication.

**Home** — Server stats, member count, uptime, bot info

**Moderation** — Actions log with filtering/pagination, warnings management, ban/kick/timeout users, clear messages by channel, manage word blocklist, moderation statistics with top moderators

**Roles** — View all server roles with member counts, create new roles (name, color, hoist, mentionable), edit existing roles, delete roles, give/remove roles to users

**Channels** — Visual channel tree organized by categories, create channels (text, voice, category, announcement, forum, stage), edit channel info (name, topic, NSFW, category), delete channels, permission editor with Allow/Inherit/Deny toggles per role, quick setup for private channels

**Leveling** — Leaderboard with usernames and tier badges, award XP (1-30), reset user XP, reset all server XP (double confirmation), system statistics

**Config** — Language selector (8 languages with flags), JSON configuration editor, environment variables viewer (read-only, secrets hidden)

**Logs** — Real-time log viewer with level filtering (Error, Warn, Info, Debug), auto-refresh mode, line count selector, download logs

### XP Economy

- Voice XP: 3 XP per hour, daily max 50 XP
- Message XP: 0.1-0.3 per message, daily max 20 XP
- Award command: Owner can give max 30 XP at a time, bypasses daily caps
- Fractional XP stored as REAL, rounded for display
- Tier roles assigned automatically based on level

### Multi-Language Support

8 languages: English, Turkce, Deutsch, Espanol, Francais, Portugues, Russkij, Arabic

Per-guild language setting via `/language` command or dashboard.

## Quick Start

### Option 1: Run from Source (Linux Server / Development)

```bash
# Clone and install
git clone <your-repo-url>
cd discord-admin-bot
npm install

# Configure
cp .env.example .env
# Edit .env with your DISCORD_TOKEN and settings

# Deploy slash commands (first time only)
npm run deploy

# Start
npm start
```

### Option 2: Standalone Windows Executable

1. Download `AiAdminBot.exe` from the dist/ folder
2. Place it in its own folder
3. Double-click to run — setup wizard will create `.env` on first run
4. The exe starts both the Discord bot and the web dashboard
5. Your browser opens automatically to the dashboard

The exe bundles Node.js and all dependencies — no installation needed.

## Environment Variables

```env
# Required
DISCORD_TOKEN=your_bot_token

# Optional
DATABASE_PATH=./data/bot.db
LOCALE=en                        # Default language (en/tr/de/es/fr/pt/ru/ar)
LOG_LEVEL=info

# AI Provider (pick one)
GEMINI_API_KEY=your_key          # Google Gemini (recommended)
OPENROUTER_API_KEY=your_key      # OpenRouter

# AI Features
AI_CHAT_ENABLED=false
AI_MODERATION_ENABLED=false

# Web Dashboard
WEB_PORT=3000                    # Set to enable dashboard
WEB_PASSWORD=your_password       # Dashboard login password
```

## Project Structure

```
src/
  commands/          # 33 slash commands in 7 categories
    ai/              # AI chat and setup commands
    leveling/        # rank, leaderboard, award, reset-xp
    moderation/      # ban, kick, warn, timeout, clear, blocklist...
    roles/           # give-role, remove-role, role-menu
    setup/           # server setup, language, templates, permissions
    utility/         # help, ping, suggest, sync
    verification/    # verify command
  events/            # Discord event handlers
  handlers/          # Command and event loaders
  systems/           # Core systems (leveling, voiceXp, serverSetup...)
  utils/             # Database, locale, logger, paths
  web/               # Express web dashboard
    api/             # REST API routes (guilds, stats, logs)
    public/          # Frontend (HTML, CSS, JS)
    auth.js          # Token-based authentication
    server.js        # Express server entry
  index.js           # Main entry point
  exe-entry.js       # Standalone exe entry point
scripts/
  build.js           # Build script for pkg
locales/             # 8 language files
config/              # Configuration templates
```

## Building the Executable

```bash
# Install dev dependencies
npm install

# Build for Windows
npm run build:win

# Build for all platforms
npm run build:all
```

Output: `dist/AiAdminBot-v{version}-{timestamp}-{platform}.exe`

## Server Deployment (Linux / Oracle Cloud)

```bash
# On the server
cd /bots/AiAdminBot
git pull
npm install
pm2 restart AiAdminBot

# First time PM2 setup
pm2 start src/index.js --name AiAdminBot
pm2 save
pm2 startup
```

Dashboard access requires port forwarding (e.g. port 3000 in firewall/security list).

## Database

SQLite via sql.js (in-memory with disk persistence). Tables: warnings, levels, mod_actions, verified_users, blocked_words, guild_settings, daily_xp.

## License

MIT
