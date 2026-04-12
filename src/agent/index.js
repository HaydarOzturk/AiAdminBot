/**
 * AI Admin Agent — Natural Language Server Management
 *
 * Users type commands in plain English. Gemini understands intent,
 * maps to available tools, and executes. Multi-turn conversations supported.
 *
 * ReAct loop: Reason (Gemini) → Act (tool execution) → Observe (result)
 */

const { chat, isConfigured } = require('../utils/openrouter');
const { getPermissionLevel } = require('../utils/permissions');
const { createEmbed } = require('../utils/embedBuilder');
const { t } = require('../utils/locale');
const db = require('../utils/database');
const conversationStore = require('./conversationStore');
const { serializeForPrompt, getTool } = require('./toolRegistry');
const { sendConfirmation, handleConfirmation } = require('./confirmation');

// Rate limit: 3 agent requests per minute per user
const rateLimits = new Map();
const RATE_LIMIT = 3;
const RATE_WINDOW = 60000;

function checkRateLimit(userId) {
  const now = Date.now();
  const entry = rateLimits.get(userId);
  if (!entry || now - entry.windowStart > RATE_WINDOW) {
    rateLimits.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// Cleanup rate limits every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [uid, entry] of rateLimits) {
    if (now - entry.windowStart > RATE_WINDOW) rateLimits.delete(uid);
  }
}, 300000);

/**
 * Get agent settings for a guild
 */
function getAgentSettings(guildId) {
  return db.get('SELECT * FROM agent_settings WHERE guild_id = ?', [guildId]);
}

/**
 * Build the system prompt for the agent
 */
function buildSystemPrompt(guild, member, permissionLevel) {
  const toolList = serializeForPrompt(permissionLevel);
  const permNames = { 0: 'User', 1: 'Verified', 2: 'Moderator', 3: 'Admin', 4: 'Owner' };

  // Build server context — channels and roles the AI can reference
  const { ChannelType } = require('discord.js');
  const categories = guild.channels.cache
    .filter(c => c.type === ChannelType.GuildCategory)
    .sort((a, b) => a.position - b.position)
    .map(c => {
      const children = guild.channels.cache
        .filter(ch => ch.parentId === c.id)
        .sort((a, b) => a.position - b.position)
        .map(ch => ch.type === ChannelType.GuildVoice ? `🔊${ch.name}` : `#${ch.name}`)
        .join(', ');
      return `${c.name}: ${children || '(empty)'}`;
    }).join('\n');

  const roles = guild.roles.cache
    .filter(r => r.name !== '@everyone')
    .sort((a, b) => b.position - a.position)
    .map(r => r.name)
    .join(', ');

  return `You are AiAdminBot Agent, an AI assistant that manages a Discord gaming server.
You interpret natural language commands and execute them using available tools.
Respond in the SAME LANGUAGE the user writes in.

== YOUR TOOLS ==
${toolList}

== SERVER INFO ==
Server: ${guild.name} (${guild.memberCount} members)
User: ${member.user.tag} (Permission: ${permNames[permissionLevel]})

Categories & Channels:
${categories}

Roles: ${roles}

== RESPONSE FORMAT ==
You MUST respond with ONLY a valid JSON object or JSON array. No text outside the JSON.

For a SINGLE action, respond with ONE object:
{"type":"execute","tool":"tool_name","params":{"key":"value"}}

For MULTIPLE actions in one request, respond with a JSON ARRAY:
[{"type":"execute","tool":"create_text_channel","params":{"name":"test"}},{"type":"execute","tool":"move_channel","params":{"channel":"test","category":"SOHBET"}}]

Available response types:
1. Execute a tool: {"type":"execute","tool":"tool_name","params":{"key":"value"}}
2. Confirm destructive action: {"type":"confirm","tool":"tool_name","params":{"key":"value"},"description":"What this will do"}
3. Ask for clarification: {"type":"clarify","message":"Your question"}
4. Respond with text: {"type":"respond","message":"Your response"}

== RULES ==
- For tools marked [DESTRUCTIVE], ALWAYS use "confirm" type
- Only use tools the user has permission for
- When the user asks for MULTIPLE things in one message, respond with a JSON ARRAY of actions
- Resolve user mentions: <@123456> means user ID 123456
- Use the server channel/role lists above to match names correctly (names may contain emojis)
- If the user's request is vague, use "clarify" to ask for details
- If the request doesn't match any tool, use "respond" to chat naturally
- Keep responses concise and helpful
- For gaming server context: understand terms like raid, team comp, bracket, loadout, etc.`;
}

/**
 * Parse Gemini's JSON response. Handles common formatting issues.
 */
function parseAgentResponse(text) {
  // Try direct JSON parse
  try {
    return JSON.parse(text);
  } catch {}

  // Extract JSON from markdown code blocks or surrounding text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {}
  }

  // Fallback: treat as a text response
  return { type: 'respond', message: text.slice(0, 2000) };
}

/**
 * Resolve Discord mentions in a message to user IDs for the agent
 */
function resolveMentions(message) {
  const mentions = {};
  message.mentions.users.forEach(user => {
    mentions[user.username] = user.id;
    mentions[`<@${user.id}>`] = user.id;
    const member = message.guild.members.cache.get(user.id);
    if (member) mentions[member.displayName] = user.id;
  });
  return mentions;
}

/**
 * Main message handler — the entry point for the agent
 * @param {import('discord.js').Message} message
 * @returns {Promise<boolean>} true if the agent handled the message
 */
async function handleMessage(message) {
  if (!isConfigured()) return false;
  if (message.author.bot || !message.guild) return false;

  const settings = getAgentSettings(message.guild.id);
  if (!settings || !settings.enabled) return false;

  // Check if message is in agent channel OR mentions the bot
  const isInAgentChannel = settings.channel_id && message.channel.id === settings.channel_id;
  const mentionsBot = message.mentions.has(message.client.user);

  if (!isInAgentChannel && !mentionsBot) return false;

  // Permission check
  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return false;

  const permLevel = getPermissionLevel(member);
  if (permLevel < (settings.min_permission_level ?? 3)) {
    await message.reply({ content: t('agent.noPermission', {}, message.guild.id) });
    return true;
  }

  // Rate limit
  if (!checkRateLimit(message.author.id)) {
    await message.reply({ content: t('agent.rateLimited', {}, message.guild.id) });
    return true;
  }

  const g = message.guild.id;
  const userId = message.author.id;

  // Clean content (remove bot mention)
  let content = message.content.replace(`<@${message.client.user.id}>`, '').trim();
  if (!content) return false;

  // Add mention context
  const mentionMap = resolveMentions(message);
  if (Object.keys(mentionMap).length > 0) {
    content += `\n[Mention context: ${JSON.stringify(mentionMap)}]`;
  }

  try {
    // Show typing indicator
    await message.channel.sendTyping();

    // Build conversation
    const conv = conversationStore.getConversation(g, userId);
    conversationStore.addMessage(g, userId, 'user', content);

    // Build system prompt
    const systemPrompt = buildSystemPrompt(message.guild, member, permLevel);

    // Send to Gemini
    const response = await chat(conv.messages, {
      systemPrompt,
      maxTokens: 512,
      temperature: 0.3,
    });

    // Parse response — may be a single action or an array of actions
    const parsed = parseAgentResponse(response);
    const actions = Array.isArray(parsed) ? parsed : [parsed];

    const results = [];
    let stopped = false;

    for (const action of actions) {
      if (stopped) break;

      switch (action.type) {
        case 'execute': {
          const tool = getTool(action.tool);
          if (!tool) {
            results.push({ message: t('agent.toolNotFound', {}, g), success: false });
            break;
          }
          if (permLevel < tool.requiredPermission) {
            results.push({ message: t('agent.noPermissionForTool', {}, g), success: false });
            break;
          }
          if (tool.destructive) {
            await sendConfirmation(message, { tool: action.tool, params: action.params },
              action.description || `Execute ${action.tool} with params: ${JSON.stringify(action.params)}`);
            stopped = true; // Can't continue after a confirmation prompt
            break;
          }

          const result = await tool.execute(message.guild, member, action.params || {});
          results.push(result);
          break;
        }

        case 'confirm': {
          const tool = getTool(action.tool);
          if (!tool) {
            results.push({ message: t('agent.toolNotFound', {}, g), success: false });
            break;
          }
          if (permLevel < tool.requiredPermission) {
            results.push({ message: t('agent.noPermissionForTool', {}, g), success: false });
            break;
          }
          await sendConfirmation(message, { tool: action.tool, params: action.params }, action.description);
          conversationStore.addMessage(g, userId, 'assistant', `Asking confirmation: ${action.description}`);
          stopped = true;
          break;
        }

        case 'clarify': {
          await message.reply({ content: action.message });
          conversationStore.addMessage(g, userId, 'assistant', action.message);
          stopped = true;
          break;
        }

        case 'respond':
        default: {
          const text = action.message || response.slice(0, 2000);
          await message.reply({ content: text });
          conversationStore.addMessage(g, userId, 'assistant', text);
          stopped = true;
          break;
        }
      }
    }

    // If we collected tool execution results, send them as one combined embed
    if (results.length > 0) {
      const allSuccess = results.every(r => r.success);
      const combinedMessage = results.map(r => r.message).join('\n');
      const embed = createEmbed({
        description: combinedMessage,
        color: allSuccess ? 'success' : 'warning',
        timestamp: true,
      });
      await message.reply({ embeds: [embed] });
      conversationStore.addMessage(g, userId, 'assistant', combinedMessage);
    }

    return true;
  } catch (err) {
    console.error('AI Agent error:', err.message);
    await message.reply({ content: t('agent.error', {}, g) }).catch(() => {});
    return true;
  }
}

module.exports = { handleMessage, handleConfirmation, getAgentSettings };
