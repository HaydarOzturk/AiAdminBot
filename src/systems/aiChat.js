const { chat, isConfigured } = require('../utils/openrouter');
const { createEmbed } = require('../utils/embedBuilder');
const { t } = require('../utils/locale');
const { fetchRules } = require('./rulesReader');
const { run, get, all } = require('../utils/database');

// Per-user conversation history (userId -> { messages[], lastActivityAt })
// Limited to last 10 messages to keep token usage low on free models
const conversations = new Map();
const MAX_HISTORY = 10;
const CONVERSATION_EXPIRY = 3600000; // 1 hour — auto-delete inactive conversations

// Rate limiting: userId -> { count, resetAt }
const rateLimits = new Map();
const RATE_LIMIT = parseInt(process.env.AI_CHAT_RATE_LIMIT) || 5; // messages per minute
const RATE_WINDOW = 60000; // 1 minute

// Periodic cleanup: remove expired conversations and stale rate limits (every 30 min)
setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of conversations) {
    if (now - session.lastActivityAt > CONVERSATION_EXPIRY) {
      conversations.delete(userId);
    }
  }
  for (const [userId, limit] of rateLimits) {
    if (now > limit.resetAt) {
      rateLimits.delete(userId);
    }
  }
}, 1800000);

// ── Memory trigger phrases in all supported languages ─────────────────────────
const MEMORY_TRIGGERS = [
  // English
  'remember that', 'don\'t forget', 'keep in mind', 'note that',
  // Turkish
  'hatırla', 'unutma', 'aklında tut', 'not al',
  // German
  'merk dir', 'vergiss nicht', 'denk daran', 'behalte',
  // Spanish
  'recuerda que', 'no olvides', 'ten en cuenta', 'anota que',
  // French
  'souviens-toi', 'n\'oublie pas', 'retiens que', 'note que',
  // Portuguese
  'lembra que', 'não esqueça', 'tenha em mente', 'anote que',
  // Russian
  'запомни', 'не забудь', 'имей в виду', 'запиши',
  // Arabic
  'تذكر', 'لا تنسى', 'خذ بالاعتبار', 'سجل أن',
];

// Phrases that ask to forget/delete a memory
const FORGET_TRIGGERS = [
  'forget that', 'forget about', 'remove memory',
  'unut', 'bunu unut', 'hafızadan sil',
  'vergiss das', 'lösche',
  'olvida', 'borra eso',
  'oublie', 'efface',
  'esqueça', 'apague isso',
  'забудь', 'удали',
  'انسى', 'احذف',
];

const MAX_MEMORIES_PER_GUILD = 50;
const MAX_MEMORY_LENGTH = 200;

/**
 * Check if a message contains a memory trigger and extract the memory.
 * @param {string} content - The message content (already resolved)
 * @returns {{ type: 'remember'|'forget'|null, memory: string|null }}
 */
function detectMemoryIntent(content) {
  const lower = content.toLowerCase();

  // Check forget triggers first (more specific)
  for (const trigger of FORGET_TRIGGERS) {
    const idx = lower.indexOf(trigger);
    if (idx !== -1) {
      const memory = content.slice(idx + trigger.length).trim().replace(/^[,:.\s]+/, '').trim();
      if (memory.length > 0) {
        return { type: 'forget', memory };
      }
    }
  }

  // Check remember triggers
  for (const trigger of MEMORY_TRIGGERS) {
    const idx = lower.indexOf(trigger);
    if (idx !== -1) {
      const memory = content.slice(idx + trigger.length).trim().replace(/^[,:.\s]+/, '').trim();
      if (memory.length > 0) {
        return { type: 'remember', memory };
      }
    }
  }

  return { type: null, memory: null };
}

/**
 * Store a community memory for a guild.
 * Uses the first few words as the key (for dedup) and full text as value.
 * @param {string} guildId
 * @param {string} memory
 * @param {string} userId - Who taught this
 * @returns {{ success: boolean, message: string }}
 */
function storeMemory(guildId, memory, userId) {
  // Truncate if too long
  const trimmed = memory.slice(0, MAX_MEMORY_LENGTH);

  // Generate a key from the first ~5 words for dedup
  const key = trimmed.toLowerCase().split(/\s+/).slice(0, 5).join(' ');

  // Check how many manual memories this guild has (auto pool is separate)
  const countRow = get(
    "SELECT COUNT(*) as cnt FROM ai_memories WHERE guild_id = ? AND (source = 'manual' OR source IS NULL)",
    [guildId]
  );
  if (countRow && countRow.cnt >= MAX_MEMORIES_PER_GUILD) {
    return { success: false, message: 'limit' };
  }

  run(
    `INSERT INTO ai_memories (guild_id, key, value, taught_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(guild_id, key) DO UPDATE SET
       value = excluded.value,
       taught_by = excluded.taught_by,
       created_at = CURRENT_TIMESTAMP`,
    [guildId, key, trimmed, userId]
  );

  return { success: true, message: 'stored' };
}

/**
 * Remove a community memory that matches the given text.
 * @param {string} guildId
 * @param {string} memoryText
 * @returns {boolean} Whether something was deleted
 */
function forgetMemory(guildId, memoryText) {
  const key = memoryText.toLowerCase().split(/\s+/).slice(0, 5).join(' ');
  const existing = get(
    'SELECT id FROM ai_memories WHERE guild_id = ? AND key = ?',
    [guildId, key]
  );
  if (existing) {
    run('DELETE FROM ai_memories WHERE id = ?', [existing.id]);
    return true;
  }
  // Also try partial match on value
  const partial = get(
    'SELECT id FROM ai_memories WHERE guild_id = ? AND LOWER(value) LIKE ?',
    [guildId, `%${memoryText.toLowerCase().slice(0, 50)}%`]
  );
  if (partial) {
    run('DELETE FROM ai_memories WHERE id = ?', [partial.id]);
    return true;
  }
  return false;
}

/**
 * Get all community memories for a guild.
 * @param {string} guildId
 * @returns {Array<{value: string, taught_by: string}>}
 */
function getGuildMemories(guildId) {
  return all(
    'SELECT value, taught_by, source, confidence, decay_score FROM ai_memories WHERE guild_id = ? ORDER BY source ASC, created_at DESC',
    [guildId]
  );
}

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
 * @param {Array} memories - Community-taught memories
 * @returns {string}
 */
function buildAiChatSystemPrompt(rulesText, guildContext, memories = []) {
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

  // Inject community memories as secondary knowledge (manual + auto pools)
  if (memories && memories.length > 0) {
    const manualMems = memories.filter(m => m.source !== 'auto');
    const autoMems = memories.filter(m => m.source === 'auto');

    if (manualMems.length > 0) {
      const lines = manualMems.map(m => `- ${m.value}`).join('\n');
      prompt += `

=== COMMUNITY KNOWLEDGE (taught by members) ===
These facts were taught by community members. Secondary to server rules and staff decisions:
${lines}
=== END ===`;
    }

    if (autoMems.length > 0) {
      const lines = autoMems.map(m => `- ${m.value}`).join('\n');
      prompt += `

=== AUTO-LEARNED KNOWLEDGE ===
These patterns were automatically detected from community discussions. Lower priority than taught knowledge:
${lines}
=== END ===`;
    }
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
- Use casual, friendly tone. Use some emojis but don't overdo it
- When a user teaches you something (using phrases like "remember", "don't forget", etc.), confirm that you learned it. When asked to forget something, confirm it was removed.
- IMPORTANT: Community-taught knowledge is secondary. If it contradicts server rules, server context, or staff info, always trust the official sources.`;

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
    conversations.set(userId, { messages: [], lastActivityAt: Date.now() });
  }
  const session = conversations.get(userId);
  session.lastActivityAt = Date.now();
  return session.messages;
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

  // Fetch community memories for this guild
  let memories = [];
  try {
    memories = getGuildMemories(message.guild.id);
  } catch {
    // Memories not available, continue without them
  }

  // Build dynamic system prompt with rules, guild context, and memories
  const systemPrompt = buildAiChatSystemPrompt(rulesText, guildContext, memories);

  // Resolve Discord mentions (<@123>) to readable names before passing to AI
  let userContent = message.content;
  const mentionPattern = /<@!?(\d+)>/g;
  let match;
  while ((match = mentionPattern.exec(message.content)) !== null) {
    const mentionedId = match[1];
    const mentionedMember = message.guild?.members.cache.get(mentionedId);
    const name = mentionedMember?.displayName || mentionedMember?.user?.username || `User(${mentionedId})`;
    userContent = userContent.replace(match[0], `@${name}`);
  }

  // Also resolve role mentions (<@&123>) and channel mentions (<#123>)
  userContent = userContent.replace(/<@&(\d+)>/g, (_, id) => {
    const role = message.guild?.roles.cache.get(id);
    return role ? `@${role.name}` : `@UnknownRole`;
  });
  userContent = userContent.replace(/<#(\d+)>/g, (_, id) => {
    const channel = message.guild?.channels.cache.get(id);
    return channel ? `#${channel.name}` : `#unknown-channel`;
  });

  // Detect memory intent (remember/forget)
  const memoryIntent = detectMemoryIntent(userContent);
  if (memoryIntent.type === 'remember' && message.guild) {
    const result = storeMemory(message.guild.id, memoryIntent.memory, message.author.id);
    if (!result.success && result.message === 'limit') {
      // Still let AI respond, but it won't store
      userContent += '\n[System: Memory storage is full for this server. Max 50 memories reached.]';
    }
  } else if (memoryIntent.type === 'forget' && message.guild) {
    const deleted = forgetMemory(message.guild.id, memoryIntent.memory);
    if (!deleted) {
      userContent += '\n[System: No matching memory found to remove.]';
    } else {
      userContent += '\n[System: Memory was successfully removed.]';
    }
  }

  // Build conversation with history
  const history = getHistory(message.author.id);
  history.push({ role: 'user', content: userContent });

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

module.exports = { handleMessage, resetConversation, checkRateLimit, getGuildMemories, storeMemory, forgetMemory, buildGuildContext };
