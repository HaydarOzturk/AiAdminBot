# AiAdminBot — AI-Powered Discord Server Administration Bot

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2.svg)](https://discord.js.org)
[![Languages](https://img.shields.io/badge/Languages-8-orange.svg)](#localization)

**AiAdminBot** is a free, open-source, AI-powered Discord administration bot that handles everything from server setup to moderation, leveling, and smart content filtering. Built with discord.js v14 and designed for gaming and streaming communities.

**Supports 8 languages** with fully localized channel names, roles, and bot messages.

> **Keywords:** discord bot, discord admin bot, ai discord bot, discord moderation bot, discord server setup bot, discord verification bot, discord leveling bot, discord role bot, free discord bot, open source discord bot, aiadminbot, ai admin bot, discord bot multilingual, discord bot turkish, discord bot german, discord bot spanish, discord bot arabic, discord server management, discord auto setup, ai moderation, openrouter discord bot

---

## Download

### Standalone (.exe) — No coding required

Download the latest release from the [Releases page](../../releases/latest), run it, and follow the setup wizard.

### From Source

```bash
git clone https://github.com/HaydarOzturk/AiAdminBot.git
cd discord-admin-bot
npm install
npm run setup     # Interactive setup wizard
npm run deploy    # Register slash commands
npm start         # Start the bot
```

Or use the launcher scripts: `start.bat` (Windows) / `start.sh` (Linux/Mac).

---

## Features

### 11 Modules, 30 Slash Commands

**1. Verification System** — New members must click a button to get verified. Unverified users see only the verification channel; verified users get full access.

**2. Role Management** — Interactive button-based role menus for games, platforms, and colors. Single-select support for color roles. Admins can also assign/remove roles manually via slash commands.

**3. Moderation** — Full moderation toolkit: warn (with DM notifications), mute (timeout-based), kick, ban, bulk message clear, timeout, and custom word blocklist. AI moderation auto-deletes flagged messages and timeouts offenders. `/mod-stats` for server-wide dashboards, `/case` to look up any action by ID, and `/mod-history` with pagination, filters, and export.

**4. Logging** — Automatic logging across 7 dedicated channels: message edits/deletes, join/leave, role changes, nickname changes, channel changes, punishments, and bans. Logs auto-clear every 72 hours. All bot activity is also saved to daily log files in the `logs/` directory for debugging.

**5. Server Setup Automation** — One command (`/setup`) creates your entire server structure: roles, categories, channels with correct permissions, verification messages, and role menus. Fully idempotent — running it again only creates what's missing. Use `/server-reset` to wipe all channels and roles while keeping members, perfect for starting fresh before a new setup.

**6. Leveling & XP** — Members earn XP by chatting (with cooldowns to prevent spam) and 1 XP per hour in voice channels. 6 rank tiers from Wood to Gold with auto-assigned roles. Includes `/rank` and `/leaderboard` commands.

**7. AI Setup Interview** — Two modes: **Default Setup** instantly creates the recommended server structure with localized channel names in any of 8 languages, or **Custom Setup** where an AI assistant interviews the server owner and generates a tailored config.

**8. AI Smart Moderation** — Automatically scans messages for toxicity, spam, NSFW content, threats, and server rule violations. Rules-aware — reads your rules channel and enforces them. Staff members are exempt. High-confidence detections trigger auto-warnings, message deletion, and timeouts. Supports AI provider failover between Gemini and OpenRouter.

**9. AI Chat Assistant** — A dedicated channel where members can chat with an AI that knows about the server, its features, rules, and all bot commands. Per-user conversation history, rate limiting, and context-aware responses.

**10. Server Templates** — Export your server structure as a portable JSON file with `/template-export`, and import it to recreate the same structure on another server with `/template-import`. Idempotent — only creates what's missing.

**11. Suggestions & Sync** — Users can send feedback to moderators via `/suggest`. `/sync` enforces roles (dry-run preview or apply), with optional auto-sync on startup.

---

## Quick Start

### Prerequisites

- **Node.js** 18 or higher (not needed for .exe)
- A **Discord Bot** application ([create one here](https://discord.com/developers/applications))
- An **OpenRouter API key** for AI features ([get a free key](https://openrouter.ai/keys))

### Setup Wizard

The easiest way to configure AdminBot:

```bash
npm run setup
```

This walks you through entering your bot token, choosing a language, and enabling AI features. It creates the `.env` file and copies example configs automatically.

### Manual Configuration

Copy the example files and fill in your values:

```bash
cp .env.example .env
cp config/config.example.json config/config.json
```

Edit `.env` with your bot token:

```env
DISCORD_TOKEN=your_bot_token_here
LOCALE=en
```

### Deploy & Start

```bash
npm run deploy    # Register slash commands with Discord
npm start         # Start the bot
```

For development with auto-reload: `npm run dev`

---

## Configuration

### `.env` — Core Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `DISCORD_TOKEN` | Bot token from Discord Developer Portal | *required* |
| `DATABASE_PATH` | SQLite database file path | `./data/bot.db` |
| `LOCALE` | Language: tr, en, de, es, fr, pt, ru, ar | `tr` |
| `OPENROUTER_API_KEY` | OpenRouter API key for AI features | *optional* |
| `AI_MODEL` | AI model to use | `openrouter/free` |
| `AI_CHAT_ENABLED` | Enable AI chat assistant | `false` |
| `AI_CHAT_CHANNEL` | Channel name for AI chat | `ai-chat` |
| `AI_CHAT_RATE_LIMIT` | Max AI messages per user per minute | `5` |
| `AI_MODERATION_ENABLED` | Enable AI content moderation | `false` |
| `AI_MOD_CONFIDENCE_THRESHOLD` | Minimum confidence to act (0.0-1.0) | `0.8` |

### Config Files

- **`config/config.json`** — Bot behavior: verification, moderation thresholds, leveling, permissions
- **`config/server-setup.json`** — Server structure blueprint for `/setup`
- **`config/role-menus.json`** — Button-based role selection menus

All have `.example` versions you can copy and customize.

---

## Commands

### Verification
| Command | Description | Permission |
|---------|-------------|------------|
| `/verify` | Send the verification button to a channel | Admin |

### Role Management
| Command | Description | Permission |
|---------|-------------|------------|
| `/role-menu <menu>` | Send an interactive role menu | Admin |
| `/give-role <user> <role>` | Assign a role to a user | Moderator |
| `/remove-role <user> <role>` | Remove a role from a user | Moderator |

### Moderation
| Command | Description | Permission |
|---------|-------------|------------|
| `/warn <user> <reason>` | Warn a user (sends DM with reason) | Moderator |
| `/mute <user> <duration>` | Timeout a user | Moderator |
| `/kick <user> [reason]` | Kick a user from the server | Admin |
| `/ban <user> [reason] [days]` | Ban a user, optionally delete messages | Owner |
| `/timeout <user> <duration> [reason]` | Give a timeout | Admin |
| `/clear <amount> [user]` | Bulk delete messages (exempts pinned/interactive) | Moderator |
| `/warnings <user>` | View a user's warnings | Moderator |
| `/mod-history <user> [type] [export]` | View paginated moderation history with filters | Moderator |
| `/mod-stats [period]` | Server-wide moderation dashboard | Moderator |
| `/case <id>` | Look up a specific moderation case | Moderator |
| `/blocklist add/remove/list` | Manage per-server blocked words | Admin |

### Leveling
| Command | Description | Permission |
|---------|-------------|------------|
| `/rank [user]` | View level, XP, and tier info | Everyone |
| `/leaderboard` | Top 10 members by level | Everyone |

### Server Setup
| Command | Description | Permission |
|---------|-------------|------------|
| `/setup` | Auto-create server structure from config | Owner |
| `/ai-setup [mode] [language]` | Default or AI-guided server setup (8 languages) | Owner |
| `/ai-setup-apply` | Apply the AI-generated server plan | Owner |
| `/ai-setup-cancel` | Cancel an active AI setup session | Owner |
| `/server-reset <mode>` | Delete all channels/roles to start fresh (keeps members) | Owner |
| `/template-export` | Export server structure as JSON template | Owner |
| `/template-import <file>` | Import server structure from JSON template | Owner |
| `/fix-permissions` | Auto-fix bot role position for moderation | Owner |
| `/sync check/apply/commands` | Role enforcement and command sync | Owner |

### AI & Utility
| Command | Description | Permission |
|---------|-------------|------------|
| `/ai-chat status` | Check AI chat assistant status | Everyone |
| `/ai-chat reset` | Reset your AI conversation history | Everyone |
| `/suggest <message>` | Send a suggestion/feedback to moderators | Everyone |
| `/help` | Show all commands (with invite button) | Everyone |
| `/ping` | Check bot latency | Everyone |

---

## Permission System

AdminBot uses a 5-tier permission hierarchy:

| Level | Role | Capabilities |
|-------|------|-------------|
| 4 | **Owner** | Everything: ban, setup, AI setup, full config |
| 3 | **Admin** | Kick, timeout, role management, verify setup |
| 2 | **Moderator** | Warn, mute, clear messages, view histories |
| 1 | **Member** | Rank, leaderboard, AI chat, help |
| 0 | **Unverified** | Verification button only |

---

## Architecture

```
discord-admin-bot/
├── config/                    # JSON configuration files
│   ├── config.example.json
│   ├── server-setup.example.json
│   └── role-menus.example.json
├── locales/                   # i18n translations (8 languages)
│   ├── tr.json, en.json, de.json, es.json
│   ├── fr.json, pt.json, ru.json, ar.json
├── src/
│   ├── commands/              # Slash commands (by module)
│   ├── events/                # Discord event handlers
│   ├── handlers/              # Command & event loaders
│   ├── systems/               # Core business logic
│   └── utils/                 # Shared utilities (db, locale, logger, etc.)
├── logs/                      # Daily log files (auto-created)
├── start.bat / start.sh       # Launcher scripts
├── .env.example
├── package.json
└── README.md
```

**Key design decisions:**

- **sql.js (SQLite/WASM)** — Zero native dependencies, works everywhere Node.js runs
- **Config-driven** — All structure, roles, menus defined in JSON files
- **Idempotent setup** — `/setup` can run multiple times safely
- **Free AI** — Uses OpenRouter's free model tier
- **File logging** — All bot output saved to `logs/` for debugging

---

## Logging & Debugging

All bot output (console.log, errors, warnings) is automatically saved to daily log files in the `logs/` directory:

```
logs/
  adminbot-2026-03-22.log
  adminbot-2026-03-21.log
  ...
```

Logs rotate daily and the last 14 days are kept. This is especially useful when running the .exe build where you don't have a persistent terminal. If something goes wrong, check the latest log file for the full error trace.

---

## AI Features

AI features are **disabled by default** and require an OpenRouter API key.

1. Get a free API key at [openrouter.ai/keys](https://openrouter.ai/keys)
2. Add to your `.env`:
   ```env
   OPENROUTER_API_KEY=sk-or-v1-your-key-here
   AI_CHAT_ENABLED=true
   AI_MODERATION_ENABLED=true
   ```
3. Restart the bot
4. The AI chat channel is auto-created when you run `/ai-setup` or `/setup`

AdminBot uses `openrouter/free` by default, which auto-routes to the best available free model. Browse free models at [openrouter.ai/models?q=free](https://openrouter.ai/models?q=free).

---

## Localization

AdminBot supports 8 languages with fully localized channel names, roles, and bot messages:

| Code | Language | Flag |
|------|----------|------|
| `tr` | Turkish | :tr: |
| `en` | English | :gb: |
| `de` | German | :de: |
| `es` | Spanish | :es: |
| `fr` | French | :fr: |
| `pt` | Portuguese | :brazil: |
| `ru` | Russian | :ru: |
| `ar` | Arabic | :saudi_arabia: |

Set the language in `.env` with `LOCALE=en` (or use the `/ai-setup` command to pick a language interactively).

To add a new language, copy `locales/en.json` to `locales/<code>.json`, translate all values, and add the choice to `src/commands/ai/ai-setup.js`.

---

## Multi-Server Support

AdminBot works on multiple servers simultaneously. Commands are registered globally and each server gets its own database entries, leveling progress, and moderation logs.

---

## Building the .exe

To build a standalone executable (requires Node.js and npm):

```bash
npm install
npm run build:win      # Windows
npm run build:mac      # macOS
npm run build:linux    # Linux
npm run build:all      # All platforms
```

The executable is output to the `dist/` folder. Distribute it along with the `locales/`, `config/`, `.env.example`, and `LICENSE` files.

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

MIT License — free to use, modify, and distribute. See [LICENSE](LICENSE).

---

Built by [HaydarOzturk](https://github.com/HaydarOzturk) with AI assistance from Claude.
Powered by [discord.js](https://discord.js.org/) and [OpenRouter](https://openrouter.ai/).
