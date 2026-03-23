const { chat, isConfigured } = require('../utils/openrouter');
const { createEmbed } = require('../utils/embedBuilder');
const { t } = require('../utils/locale');
const { fetchRules } = require('./rulesReader');

// Per-user conversation history (userId -> messages[])
// Limited to last 10 messages to keep token usage low on free models
const conversations = new Map();
const MAX_HISTORY = 10;

// Rate limiting: userId -> { count, resetAt }
const rateLimits = new Map();
const RATE_LIMIT = parseInt(process.env.AI_CHAT_RATE_LIMIT) || 5; // messages per minute
const RATE_WINDOW = 60000; // 1 minute

/**
 * Build the AI chat system prompt, optionally including server rules
 * @param {string|null} rulesText - The server rules text (or null)
 * @returns {string}
 */
function buildAiChatSystemPrompt(rulesText) {
  let prompt = `You are AiAdminBot AI, a friendly assistant in a Discord server powered by AiAdminBot — an AI-powered administration bot.

You know about all the bot's features and can help users understand them:
- Verification: New members verify and get the verified role
- Role Menus: Members can pick game roles, color roles, and platform roles
- Moderation: Staff can use /warn, /mute, /kick, /ban, /timeout, /clear. Use /warnings and /mod-history to check records
- Leveling: Users earn 15-25 XP per message (60s cooldown) AND 1 XP per hour in voice channels. Check rank with /rank, see leaderboard with /leaderboard
- Suggestions: Users can send suggestions/feedback to moderators using /suggest
- AI Chat: This channel! Ask me anything
- /help shows all available commands`;

  // Inject server rules if available
  if (rulesText) {
    prompt += `

=== SERVER RULES ===
The following are this server's official rules. You have direct access to these rules and CAN share them with users when asked. Summarize or quote the relevant rules when users ask about them.

${rulesText}
=== END RULES ===`;
  }

  prompt += `

Guidelines:
- Respond in the same language the user writes in (Turkish, English, or others)
- Keep responses concise (under 2000 characters for Discord)
- Be friendly, fun, and helpful
- You can help with: general questions, gaming tips, tech support, fun conversations, explaining bot features
- If users ask about server rules, answer based on the rules above (if available). If rules are not available, direct them to the rules channel.
- Don't pretend to have access to real-time data, server stats, or the internet
- If asked about moderation actions or specific user data, explain you can't access that and suggest asking a moderator
- If a user wants to send a suggestion, feedback, or idea to moderators, tell them to use the /suggest command
- Use casual, friendly tone appropriate for the community
- You can use some emojis but don't overdo it`;

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
      content: t('aiChat.rateLimited', { seconds: limit.resetIn }),
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

  // Build dynamic system prompt with rules
  const systemPrompt = buildAiChatSystemPrompt(rulesText);

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
    await message.reply(t('aiChat.responseError'));
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
