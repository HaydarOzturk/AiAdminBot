/**
 * Server Rules Reader — Fetches and caches the rules channel content per guild.
 *
 * Scans all locale files to find the rules channel (regardless of language),
 * reads the last 20 messages, and caches the text for use in AI prompts.
 *
 * The cache auto-refreshes every 30 minutes so rule updates are picked up.
 */

const fs = require('fs');
const path = require('path');
const { channelName } = require('../utils/locale');
const { localesDir } = require('../utils/paths');

// Cache: guildId -> { rules: string, fetchedAt: number }
const _rulesCache = new Map();
const RULES_CACHE_TTL = 1800000; // 30 minutes

// All possible rules channel names (built once)
let _rulesChannelNames = null;

/**
 * Get all possible rules channel names across all locales
 * @param {string|null} [guildId=null] - Guild ID for per-guild locale lookup
 * @returns {Set<string>}
 */
function getRulesChannelNames(guildId = null) {
  if (_rulesChannelNames) return _rulesChannelNames;

  const names = new Set();
  names.add(channelName('rules', guildId));
  names.add('rules');
  names.add('kurallar');

  // Scan all locale files
  try {
    const locDir = localesDir();
    const files = fs.readdirSync(locDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(locDir, file), 'utf-8'));
        if (data.channelNames?.rules) {
          names.add(data.channelNames.rules);
        }
      } catch { /* skip */ }
    }
  } catch { /* locales dir not found */ }

  _rulesChannelNames = names;
  console.log(`📜 Rules channel names to scan: ${[...names].join(', ')}`);
  return names;
}

/**
 * Find the rules channel in a guild
 * @param {import('discord.js').Guild} guild
 * @returns {import('discord.js').TextChannel|null}
 */
function findRulesChannel(guild) {
  const names = getRulesChannelNames(guild.id);
  const channel = guild.channels.cache.find(
    c => names.has(c.name) && c.isTextBased()
  ) || null;

  if (channel) {
    console.log(`📜 Found rules channel: #${channel.name} (${channel.id}) in ${guild.name}`);
  } else {
    console.log(`📜 No rules channel found in ${guild.name}. Available text channels: ${guild.channels.cache.filter(c => c.isTextBased()).map(c => c.name).join(', ')}`);
  }

  return channel;
}

/**
 * Fetch rules content from the rules channel
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<string|null>} The rules text, or null if not found
 */
async function fetchRules(guild) {
  // Check cache first
  const cached = _rulesCache.get(guild.id);
  if (cached && Date.now() - cached.fetchedAt < RULES_CACHE_TTL) {
    return cached.rules;
  }

  const rulesChannel = findRulesChannel(guild);
  if (!rulesChannel) {
    console.log(`📜 Rules fetch skipped — no rules channel in ${guild.name}`);
    return null;
  }

  try {
    // Fetch last 20 messages from the rules channel (oldest first)
    const messages = await rulesChannel.messages.fetch({ limit: 20 });
    console.log(`📜 Fetched ${messages.size} messages from #${rulesChannel.name}`);

    if (messages.size === 0) {
      console.log(`📜 Rules channel is empty`);
      return null;
    }

    // Sort by timestamp (oldest first) and extract text
    const sorted = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const rulesText = sorted
      .map(msg => {
        let text = '';

        // Message content
        if (msg.content && msg.content.trim()) {
          text += msg.content.trim();
        }

        // Embed descriptions (rules are often in embeds)
        if (msg.embeds && msg.embeds.length > 0) {
          for (const embed of msg.embeds) {
            if (embed.title) text += (text ? '\n' : '') + embed.title;
            if (embed.description) text += (text ? '\n' : '') + embed.description;
            if (embed.fields && embed.fields.length > 0) {
              for (const field of embed.fields) {
                text += '\n' + field.name + ': ' + field.value;
              }
            }
          }
        }

        return text;
      })
      .filter(t => t.length > 0)
      .join('\n\n');

    if (!rulesText || rulesText.trim().length === 0) {
      console.log(`📜 Rules channel had messages but no extractable text`);
      return null;
    }

    // Truncate to 2000 chars to keep AI prompts reasonable
    const truncated = rulesText.length > 2000
      ? rulesText.slice(0, 2000) + '...'
      : rulesText;

    // Cache it
    _rulesCache.set(guild.id, {
      rules: truncated,
      fetchedAt: Date.now(),
    });

    console.log(`📜 Cached ${truncated.length} chars of rules for ${guild.name}`);
    return truncated;
  } catch (err) {
    console.error(`📜 Failed to fetch rules for guild ${guild.name} (${guild.id}):`, err.message);
    return null;
  }
}

/**
 * Clear the rules cache for a guild (call when rules are updated)
 * @param {string} guildId
 */
function clearRulesCache(guildId) {
  _rulesCache.delete(guildId);
}

module.exports = { fetchRules, findRulesChannel, clearRulesCache, getRulesChannelNames };
