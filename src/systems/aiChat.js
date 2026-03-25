const { chat, isConfigured } = require('../utils/openrouter');
const { createEmbed } = require('../utils/embedBuilder');
const { t } = require('../utils/locale');
const { fetchRules } = require('./rulesReader');
const { all } = require('../utils/database');

// Per-user conversation history (userId -> messages[])
// Limited to last 10 messages to keep token usage low on free models
const conversations = new Map();
const MAX_HISTORY = 10;

// Rate limiting: userId -> { count, resetAt }
const rateLimits = new Map();
const RATE_LIMIT = parseInt(process.env.AI_CHAT_RATE_LIMIT) || 5; // messages per minute
const RATE_WINDOW = 60000; // 1 minute

/**
 * Build a snapshot of the guild for AI context.
 * Includes: server info, owner, roles, channels, staff, top members, streamers.
 * @param {import('discord.js').Guild} guild
 * @returns {string}
 */
function buildGuildContext(guild) {
  if (!guild) return '';

  const lines = [];

  // ── Server basics ──────────────────────────────────────────────────────
  const owner = guild.members.cache.get(guild.ownerId);
  const ownerName = owner?.displayName || owner?.user?.username || 'Unknown';
  lines.push(`Server: "${guild.name}" | Members: ${guild.memberCount} | Owner: ${ownerName}`);
  if (guild.description) lines.push(`Description: ${guild.description}`);

  // ── Roles (skip @everyone and bot-managed roles) ───────────────────────
  const roles = guild.roles.cache
    .filter(r => r.id !== guild.id && !r.managed)
    .sort((a, b) => b.position - a.position)
    .first(20);

  if (roles.length > 0) {
    const roleList = roles.map(r => {
      const count = r.members.size;
      return `${r.name} (${count} member${count !== 1 ? 's' : ''})`;
    }).join(', ');
    lines.push(`Roles: ${roleList}`);
  }

  // ── Staff members (anyone with Manage Messages or above) ───────────────
  const staff = guild.members.cache.filter(m =>
    !m.user.bot &&
    (m.permissions.has('ManageMessages') || m.permissions.has('Administrator'))
  );
  if (staff.size > 0) {
    const staffList = staff.map(m => {
      const topRole = m.roles.highest.name !== '@everyone' ? m.roles.highest.name : '';
      return `${m.displayName}${topRole ? ` [${topRole}]` : ''}`;
    }).join(', ');
    lines.push(`Staff: ${staffList}`);
  }

  // ── Channels (grouped by category, text and voice only) ────────────────
  const categories = guild.channels.cache
    .filter(c => c.type === 4)
    .sort((a, b) => a.position - b.position);

  const channelLines = [];
  for (const cat of categories.values()) {
    const children = guild.channels.cache
      .filter(c => c.parentId === cat.id && (c.isTextBased() || c.isVoiceBased()))
      .sort((a, b) => a.position - b.position)
      .map(c => c.isVoiceBased() ? `🔊${c.name}` : `#${c.name}`);
    if (children.length > 0) {
      channelLines.push(`  ${cat.name}: ${children.join(', ')}`);
    }
  }
  // Uncategorized channels
  const uncategorized = guild.channels.cache
    .filter(c => !c.parentId && c.type !== 4 && (c.isTextBased() || c.isVoiceBased()))
    .map(c => c.isVoiceBased() ? `🔊${c.name}` : `#${c.name}`);
  if (uncategorized.length > 0) {
    channelLines.unshift(`  (uncategorized): ${uncategorized.join(', ')}`);
  }
  if (channelLines.length > 0) {
    lines.push(`Channels:\n${channelLines.join('\n')}`);
  }

  // ── Top members by XP ─────────────────────────────────────────────────
  try {
    const topMembers = all(
      'SELECT user_id, level, xp, messages FROM levels WHERE guild_id = ? ORDER BY xp DESC LIMIT 10',
      [guild.id]
    );
    if (topMembers && topMembers.length > 0) {
      const leaderboard = topMembers.map((row, i) => {
        const member = guild.members.cache.get(row.user_id);
        const name = member?.displayName || 'Unknown';
        return `${i + 1}. ${name} — Level ${row.level} (${row.messages} msgs)`;
      }).join(', ');
      lines.push(`Top members: ${leaderboard}`);
    }
  } catch {
    // Leveling data not available
  }

  // ── Streamers and their platforms ─────────────────────────────────────
  try {
    const links = all(
      'SELECT user_id, platform, platform_url FROM streaming_links WHERE guild_id = ? ORDER BY added_at',
      [guild.id]
    );
    if (links && links.length > 0) {
      const byUser = {};
      for (const link of links) {
        if (!byUser[link.user_id]) byUser[link.user_id] = [];
        byUser[link.user_id].push(link);
      }
      const streamerDescs = [];
      for (const [userId, userLinks] of Object.entries(byUser)) {
        const member = guild.members.cache.get(userId);
        const name = member?.displayName || member?.user?.username || 'Unknown';
        const isOwner = userId === guild.ownerId;
        const platforms = userLinks.map(l => `${l.platform}: ${l.platform_url}`).join(', ');
        streamerDescs.push(`${name}${isOwner ? ' (server owner)' : ''} — ${platforms}`);
      }
      lines.push(`Streamers: ${streamerDescs.join('; ')}`);
    }
  } catch {
    // Streaming data not available
  }

  return lines.join('\n');
}

/**
 * Build the AI chat system prompt with full server context.
 * @param {string|null} rulesText - The server rules text (or null)
 * @param {string} guildContext - Server snapshot from buildGuildContext()
 * @returns {string}
 */
function buildAiChatSystemPrompt(rulesText, guildContext) {
  let prompt = `You are AiAdminBot AI, a friendly and knowledgeable assistant in a Discord server. You are part of this community and know everything about it.

You know about all the bot's features:
- Verification: New members verify and get the verified role
- Role Menus: Members can pick game roles, color roles, and platform roles
- Moderation: Staff can use /warn, /mute, /kick, /ban, /timeout, /clear. Use /warnings and /mod-history to check records
- Leveling: Users earn 15-25 XP per message (60s cooldown) AND 1 XP per hour in voice channels. Check rank with /rank, see leaderboard with /leaderboard
- Suggestions: Users can send suggestions/feedback to moderators using /suggest
- Streaming: The server owner can announce live streams with /go-live. Platform links are managed with /stream-link
- AI Chat: This channel! Ask me anything
- /help shows all available commands`;

  // Inject guild context
  if (guildContext) {
    prompt += `

=== THIS SERVER ===
${guildContext}
=== END SERVER ===`;
  }

  // Inject server rules if available
  if (rulesText) {
    prompt += `

=== SERVER RULES ===
${rulesText}
=== END RULES ===`;
  }

  prompt += `

Guidelines:
- You ARE part of this server community. When users ask about the server, its members, streamers, staff, channels, or roles, answer from the server context above.
- When someone asks "who is [name]", check if they are a member, staff, streamer, or the server owner and respond accordingly.
- When users ask about streamers, be enthusiastic and share their streaming platform links.
- Respond in the same language the user writes in (Turkish, English, or others)
- Keep responses concise (under 2000 characters for Discord)
- Be friendly, fun, and helpful — you belong to this community
- If users ask about server rules, answer based on the rules above. If rules are not available, direct them to the rules channel.
- You can answer questions about: server info, members, roles, channels, bot features, general questions, gaming tips, fun conversations
- For private moderation details (specific warnings, bans), suggest asking a moderator
- If a user wants to send a suggestion, tell them to use /suggest
- Use casual, friendly tone. Use some emojis but don't overdo it`;

  return prompt;
}

/**
 * Check rate limit for a user
 * @param {string} userId
 * @returns {{ allowed: boolean, remaining: number, resetIn: number }}
 */
function checkRateLimit(userId) {
  const now = Date.now();
  const userLimit = rateLimits.get(userId);

  if (!userLimit || now > userLimit.resetAt) {
    rateLimits.set(userId, { count: 1, resetAt: now + RATE_WINDOW });
    return { allowed: true, remaining: RATE_LIMIT - 1, resetIn: 0 };
  }

  if (userLimit.count >= RATE_LIMIT) {
    const resetIn = Math.ceil((userLimit.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, resetIn };
  }

  userLimit.count++;
  return { allowed: true, remaining: RATE_LIMIT - userLimit.count, resetIn: 0 };
}

/**
 * Get or create conversation history for a user
 * @param {string} userId
 * @returns {Array}
 */
function getHistory(userId) {
  if (!conversations.has(userId)) {
    conversations.set(userId, []);
  }
  return conversations.get(userId);
}

/**
 * Handle an AI chat message
 * @param {import('discord.js').Message} message
 */
async function handleMessage(message) {
  if (!isConfigured()) return;
  if (process.env.AI_CHAT_ENABLED !== 'true') return;

  // Rate limit check
  const limit = checkRateLimit(message.author.id);
  if (!limit.allowed) {
    await message.reply({
      content: t('aiChat.rateLimited', { seconds: limit.resetIn }, message.guild?.id),
    });
    return;
  }

  // Show typing indicator
  await message.channel.sendTyping();

  // Fetch server rules for this guild (cached, async)
  let rulesText = null;
  try {
    rulesText = await fetchRules(message.guild);
  } catch {
    // Rules not available, continue without them
  }

  // Build full guild context (server info, members, roles, channels, streamers, leaderboard)
  let guildContext = '';
  try {
    guildContext = buildGuildContext(message.guild);
  } catch {
    // Guild context not available, continue without it
  }

  // Build dynamic system prompt with rules and guild context
  const systemPrompt = buildAiChatSystemPrompt(rulesText, guildContext);

  // Build conversation with history
  const history = getHistory(message.author.id);
  history.push({ role: 'user', content: message.content });

  // Trim history to max
  while (history.length > MAX_HISTORY) {
    history.shift();
  }

  try {
    const response = await chat(history, {
      systemPrompt,
      maxTokens: 1024,
      temperature: 0.8,
    });

    // Save assistant response to history
    history.push({ role: 'assistant', content: response });

    // Trim again after adding response
    while (history.length > MAX_HISTORY) {
      history.shift();
    }

    // Discord has a 2000 char limit — split if needed
    if (response.length <= 2000) {
      await message.reply(response);
    } else {
      // Split into chunks
      const chunks = splitMessage(response, 2000);
      for (let i = 0; i < chunks.length; i++) {
        if (i === 0) {
          await message.reply(chunks[i]);
        } else {
          await message.channel.send(chunks[i]);
        }
      }
    }
  } catch (err) {
    console.error('AI chat error:', err.message);
    await message.reply(t('aiChat.responseError', {}, message.guild?.id));
  }
}

/**
 * Reset a user's conversation history
 * @param {string} userId
 */
function resetConversation(userId) {
  conversations.delete(userId);
}

/**
 * Split a message into chunks at word boundaries
 */
function splitMessage(text, maxLength) {
  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf(' ', maxLength);
    if (splitAt === -1 || splitAt < maxLength / 2) splitAt = maxLength;

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

module.exports = { handleMessage, resetConversation, checkRateLimit };
