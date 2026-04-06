# Testing Guide — AiAdminBot

## Automated Tests

```bash
npm test               # Run all tests (107 tests)
npm run test:unit      # Unit tests only (utils + systems)
npm run test:integration  # Integration tests (commands + events)
```

Tests use Node's built-in test runner (`node:test`) — no extra dependencies. All tests run against an in-memory SQLite database with no disk I/O.

### Test Structure

```
tests/
  helpers/           # Shared mocks and fixtures
    fixtures.js      # Constant test IDs
    mockDatabase.js  # In-memory DB setup/teardown
    mockDiscord.js   # Mock Discord.js objects
    mockOpenRouter.js # Mock AI API responses
    mockExpress.js   # HTTP client for Express routes
  unit/
    utils/           # database, locale, permissions, embedBuilder
    systems/         # leveling, automod
    agent/           # fuzzyMatch
  integration/
    commands/        # ping, warn, rank
```

### Writing New Tests

```javascript
const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, cleanupTestDatabase } = require('../../helpers/mockDatabase');

describe('my test', () => {
  before(async () => await setupTestDatabase());
  beforeEach(() => cleanupTestDatabase());

  it('does something', () => {
    // your test
  });
});
```

---

## Manual Testing

**NEVER test on your production server.**

### Setting Up a Test Environment

1. **Create a test Discord bot** at [Discord Developer Portal](https://discord.com/developers/applications)
   - Enable all Privileged Intents (Presence, Server Members, Message Content)
   - Invite with `bot` + `applications.commands` scopes and `Administrator` permission

2. **Create a test Discord server** — add the bot to it

3. **Create `.env.test`**:
```env
DISCORD_TOKEN=your_test_bot_token
DATABASE_PATH=./data/test-bot.db
WEB_PORT=3001
WEB_PASSWORD=testpassword
GEMINI_API_KEY=your_key
AI_CHAT_ENABLED=true
AI_MODERATION_ENABLED=true
STREAMING_ENABLED=false
DEBUG_OWNER_ID=your_discord_id
LOCALE=en
```

4. **Run**: `copy .env.test .env && npm start`

5. **Restore production** when done: replace `.env` with production values

---

## Complete Test Checklist

### Setup & Core (Owner)
- [ ] `/setup` — creates categories, channels, roles, permissions
- [ ] `/ai-setup mode:custom language:English` — AI interview flow
- [ ] `/ai-setup-apply` — applies generated config
- [ ] `/ai-setup-cancel` — cancels active session
- [ ] `/afk-setup` — creates AFK channel with native settings
- [ ] `/fix-permissions` — repairs bot permission issues
- [ ] `/language` — switch language, verify all messages change
- [ ] `/language` — switch back, verify restored

### Verification
- [ ] `/verify` — posts verification button in channel
- [ ] New member joins → gets Unverified role
- [ ] Click verify button → gets New Member role, Unverified removed
- [ ] Verified members see channels, unverified cannot

### Moderation — Warnings
- [ ] `/warn user:@someone reason:"Spamming"` — saves warning
- [ ] `/warnings user:@someone` — shows warning history
- [ ] `/case id:1` — shows specific case details
- [ ] `/mod-history user:@someone` — shows all mod actions
- [ ] `/mod-history user:@someone type:warn` — filtered history
- [ ] `/mod-stats period:30` — moderator statistics

### Moderation — Actions
- [ ] `/mute user:@someone duration:"5 minutes" reason:"Test"`
- [ ] `/timeout user:@someone duration:"10 minutes"`
- [ ] `/kick user:@someone reason:"Test"` — kicks member
- [ ] `/ban user:@someone reason:"Test" delete-messages:"Last 1 day"`
- [ ] `/clear amount:10` — deletes 10 messages
- [ ] `/clear amount:50 user:@someone` — user-specific cleanup
- [ ] `/clear amount:20 filter:bots` — bot messages only

### Moderation — Blocklist
- [ ] `/blocklist add word:"badword"` — adds word
- [ ] `/blocklist list` — shows all blocked words
- [ ] `/blocklist remove word:"badword"` — removes word
- [ ] Send blocked word in chat → message deleted

### Moderation System (AutoMod + AI — Unified)

AutoMod handles rule-based checks (fast, no API calls). AI Moderation handles subtle toxicity detection. Both share the same infraction table for unified progressive punishment: warn → 5min timeout → 30min → 24h.

**Rule-Based (AutoMod)**
- [ ] `/automod enable` — activates all rule-based features
- [ ] `/automod status` — shows all settings
- [ ] `/automod toggle feature:anti_spam`
- [ ] `/automod toggle feature:anti_caps`
- [ ] `/automod toggle feature:anti_invites`
- [ ] `/automod toggle feature:anti_mention_spam`
- [ ] `/automod toggle feature:anti_raid`
- [ ] `/automod toggle feature:progressive_punishments`
- [ ] `/automod config spam-threshold:5 spam-window:5`
- [ ] Send 5+ rapid messages → warned/deleted (anti_spam)
- [ ] Send ALL CAPS MESSAGE → triggered (anti_caps)
- [ ] Send discord.gg/test → deleted (anti_invites)
- [ ] Tag 5+ people → triggered (anti_mention_spam)
- [ ] `/automod disable` — deactivates all

**AI-Powered (AI Moderation)**
- [ ] Send toxic message → auto-detected by AI
- [ ] Keyword pre-filter catches obvious slurs without AI
- [ ] AI analyzes subtle toxicity with server rules context
- [ ] High confidence (0.95+) → action taken
- [ ] Logged to punishment-log channel
- [ ] Staff members exempt
- [ ] Use `DEBUG_OWNER_ID` to test on yourself

**Unified Progressive Punishment**
- [ ] 1st offense (either source) → warn + delete message
- [ ] 2nd offense → 5 min timeout
- [ ] 3rd offense → 30 min timeout
- [ ] 4th+ offense → 24h timeout
- [ ] AutoMod spam 2x + AI toxicity 1x → 3rd-offense (30min)
- [ ] Infractions from both systems count toward escalation

### Leveling & XP
- [ ] Send messages → XP accumulates (check with /rank)
- [ ] `/rank` — shows your level, XP, progress bar
- [ ] `/rank user:@someone` — shows another user's level
- [ ] `/leaderboard` — shows top members
- [ ] `/award user:@someone amount:10` — owner only, bypasses caps
- [ ] `/reset-xp user @someone` — resets user XP
- [ ] `/reset-xp server` — resets all XP (double confirmation)
- [ ] Join voice channel → voice XP accumulates
- [ ] Level up → tier role assigned (Wood → Coal → Iron → Bronze → Silver → Gold)
- [ ] Daily XP cap reached → no more XP that day

### Role Management
- [ ] `/give-role user:@someone role:@Role`
- [ ] `/remove-role user:@someone role:@Role`
- [ ] `/publish-roles menu:gameRoles` — posts role menu
- [ ] `/publish-roles menu:all` — posts all menus
- [ ] Click role menu button → role assigned/removed

### Streaming
- [ ] `/stream-link add platform:twitch url:https://twitch.tv/you`
- [ ] `/stream-link add platform:youtube url:https://youtube.com/@you`
- [ ] `/stream-link add platform:kick url:https://kick.com/you`
- [ ] `/stream-link list` — shows all links
- [ ] `/go-live` — manual announcement check
- [ ] Guild owner goes live on Discord → auto-announcement (presenceUpdate)
- [ ] Stream ends → end announcement with stats
- [ ] Auto-refresh announcement every 2.5 min (viewer count update)

### AI Chat
- [ ] Send message in #ai-chat → bot responds
- [ ] Multi-turn conversation maintained per user
- [ ] Say "remember raid nights are Tuesdays" → stores memory
- [ ] Say "forget about raid nights" → removes memory
- [ ] `/ai-chat status` — shows chat configuration
- [ ] `/ai-chat reset` — clears conversation history
- [ ] Rate limit: 5+ messages/min → rate limited

### AI Memories
- [ ] `/ai-memory list` — shows all guild memories
- [ ] `/ai-memory add text:"Our clan tag is [ABC]"` — adds memory
- [ ] `/ai-memory delete id:1` — removes specific memory
- [ ] `/ai-memory clear` — removes all memories
- [ ] AI chat references stored memories in responses

### AI Moderation
See **Moderation System** section above — AI moderation is unified with AutoMod.

### AI Admin Agent
- [ ] `/ai-agent enable channel:#admin` — dedicated channel
- [ ] `/ai-agent enable` — enable via @mention
- [ ] `/ai-agent set-permission level:2`
- [ ] "Show me the leaderboard" → displays leaderboard
- [ ] "Mute @someone for 5 minutes" → mutes user
- [ ] "Create a voice channel called Team Alpha" → creates channel
- [ ] "Create a category called Tournaments" → creates category
- [ ] "Give @someone the Admin role" → assigns role
- [ ] "Ban @someone" → confirmation buttons → click Cancel
- [ ] "Remember practice is every Wednesday 8 PM" → stores memory
- [ ] "What did I miss in general?" → channel summary
- [ ] Multi-turn: "Warn that toxic player" → "Which player?" → "@Player"
- [ ] Non-admin in agent channel → permission error
- [ ] `/ai-agent status` — shows settings
- [ ] `/ai-agent disable` — disables agent

### Knowledge System
- [ ] `/knowledge add category:game content:"Raid nights Tuesdays 9 PM"`
- [ ] `/knowledge add-faq question:"When are raids?" answer:"Tuesdays 9 PM"`
- [ ] `/knowledge search query:"raid schedule"` — finds entries
- [ ] `/knowledge list` — shows all entries
- [ ] `/knowledge delete id:1` — removes entry
- [ ] `/what-did-i-miss` — AI summary of last 8 hours
- [ ] `/what-did-i-miss hours:24 channel:#general` — specific range

### Community — Polls
- [ ] `/poll create question:"Best game?" option1:"Val" option2:"CS2" option3:"Apex"`
- [ ] `/poll ai topic:"What should we play?"` — AI generates poll
- [ ] Click vote button → vote recorded
- [ ] Click same button → vote removed
- [ ] Timed poll expires → results shown

### Community — Giveaways
- [ ] `/giveaway start prize:"Nitro" duration:1 winners:1`
- [ ] Click Enter → entry recorded
- [ ] Timer expires → winner auto-selected
- [ ] `/giveaway reroll message-id:<id>` — re-rolls winner

### Community — Starboard
- [ ] `/starboard enable channel:#starboard`
- [ ] `/starboard config threshold:3`
- [ ] React with ⭐ 3+ times → appears in starboard
- [ ] AI commentary added to starboard post

### Community — Custom Commands
- [ ] `/custom-command add name:rules response:"Be kind!"`
- [ ] Type `!rules` → bot responds
- [ ] `/custom-command add name:roast response:"Witty roast" ai:true`
- [ ] Type `!roast @friend` → AI generates response
- [ ] `/custom-command list` — shows all commands
- [ ] `/custom-command remove name:rules` — deletes command

### Utility
- [ ] `/ping` — shows latency
- [ ] `/help` — shows all commands
- [ ] `/suggest message:"Feature idea"` — submits feedback
- [ ] `/sync` — syncs slash commands

### Templates (Owner)
- [ ] `/template-export` — exports server as JSON
- [ ] `/template-import` — imports template
- [ ] `/server-reset` — factory reset (double confirmation!)

### Web Dashboard
- [ ] Open `http://localhost:3001` → login page
- [ ] Login with WEB_PASSWORD → dashboard loads
- [ ] **Home** — stats, member list with pagination
- [ ] **Moderation** — actions log, warnings, ban/kick from UI, blocklist
- [ ] **Roles** — view/create/edit/delete roles, assign to members
- [ ] **Channels** — channel tree, create/delete, permission editor
- [ ] **Leveling** — leaderboard, award XP (user search), reset
- [ ] **Settings** — all tabs: General, AI, Streaming, AFK, Voice XP, Dashboard, Debug, Channels, Language, JSON editor
- [ ] **Logs** — real-time viewer with filtering
- [ ] **Invite Bot** — OAuth2 invite link
- [ ] Logout → redirected to login

### Edge Cases
- [ ] Bot missing permissions → graceful error (not crash)
- [ ] Multiple guilds → per-guild settings isolated
- [ ] Bot restart → giveaway timers restored
- [ ] Language switch → all systems use new language
- [ ] Daily XP cap → stops earning after cap hit
- [ ] Cooldown → rapid messages don't earn extra XP
- [ ] Staff exempt from automod, AI moderation, and link filter
- [ ] AutoMod + AI moderation share infraction count (unified progressive punishment)
