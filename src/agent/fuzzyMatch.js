/**
 * Fuzzy Matching Utilities for AI Agent
 *
 * Provides smart name resolution for channels, categories, roles, and users.
 * Strips emojis, handles partial matches, and suggests alternatives.
 */

const { ChannelType } = require('discord.js');

/**
 * Strip emojis and extra whitespace from a string for fuzzy comparison.
 */
function stripEmojis(str) {
  return str
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/[\u{200D}]/gu, '')
    .replace(/[\u{20E3}]/gu, '')
    .replace(/[\u{E0020}-\u{E007F}]/gu, '')
    .trim();
}

/**
 * Simple string similarity using Dice coefficient on bigrams.
 */
function similarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s) => {
    const set = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      set.set(bg, (set.get(bg) || 0) + 1);
    }
    return set;
  };
  const aBi = bigrams(a), bBi = bigrams(b);
  let matches = 0;
  for (const [bg, count] of aBi) {
    if (bBi.has(bg)) matches += Math.min(count, bBi.get(bg));
  }
  return (2 * matches) / (a.length - 1 + b.length - 1);
}

/**
 * Generic fuzzy finder. Searches a collection by name with multi-level matching.
 * @param {Map|Array} collection - Discord.js cache or array of { name } objects
 * @param {string} query - What the user typed
 * @param {Function} [nameGetter] - How to get the name from an item (default: item.name)
 * @returns {{ match: object|null, suggestions: string[] }}
 */
function fuzzyFind(collection, query, nameGetter = (item) => item.name) {
  const items = collection instanceof Map ? [...collection.values()] : Array.isArray(collection) ? collection : [...collection.values()];
  const lower = query.toLowerCase();
  const stripped = stripEmojis(lower);

  // 1. Exact match
  let match = items.find(item => nameGetter(item).toLowerCase() === lower);
  if (match) return { match, suggestions: [] };

  // 2. Match after stripping emojis
  match = items.find(item => stripEmojis(nameGetter(item).toLowerCase()) === stripped);
  if (match) return { match, suggestions: [] };

  // 3. Partial/contains match (either direction)
  match = items.find(item => {
    const itemStripped = stripEmojis(nameGetter(item).toLowerCase());
    return itemStripped.includes(stripped) || stripped.includes(itemStripped);
  });
  if (match) return { match, suggestions: [] };

  // 4. No match — gather suggestions using string similarity
  const suggestions = items
    .map(item => ({ name: nameGetter(item), score: similarity(stripped, stripEmojis(nameGetter(item).toLowerCase())) }))
    .filter(s => s.score > 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => s.name);

  return { match: null, suggestions };
}

/**
 * Find a channel by name (excludes categories by default).
 */
function findChannel(guild, name) {
  const channels = guild.channels.cache.filter(c => c.type !== ChannelType.GuildCategory);
  return fuzzyFind(channels, name);
}

/**
 * Find a category by name.
 */
function findCategory(guild, name) {
  const categories = guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory);
  return fuzzyFind(categories, name);
}

/**
 * Find a role by name (excludes @everyone).
 */
function findRole(guild, name) {
  const roles = guild.roles.cache.filter(r => r.name !== '@everyone');
  return fuzzyFind(roles, name);
}

/**
 * Find a member by name, display name, or partial match.
 */
function findMember(guild, query) {
  const members = guild.members.cache;
  return fuzzyFind(members, query, (m) => m.displayName || m.user.username);
}

/**
 * Format a "not found" message with optional suggestions.
 */
function notFoundMsg(type, name, suggestions) {
  let msg = `${type} "${name}" not found.`;
  if (suggestions.length > 0) {
    msg += ` Did you mean: ${suggestions.map(s => `"${s}"`).join(', ')}?`;
  }
  return msg;
}

module.exports = { stripEmojis, similarity, fuzzyFind, findChannel, findCategory, findRole, findMember, notFoundMsg };
