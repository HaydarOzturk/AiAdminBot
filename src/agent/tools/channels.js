const { ChannelType } = require('discord.js');

/**
 * Strip emojis and extra whitespace from a string for fuzzy comparison.
 */
function stripEmojis(str) {
  return str
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')  // symbols & pictographs
    .replace(/[\u{2600}-\u{27BF}]/gu, '')     // misc symbols
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')     // variation selectors
    .replace(/[\u{200D}]/gu, '')               // zero-width joiner
    .trim();
}

/**
 * Find a channel by name with fuzzy matching (ignores emojis).
 * Returns { match, suggestions } — match is the best hit, suggestions are close alternatives.
 */
function findChannel(guild, name, typeFilter = null) {
  const channels = guild.channels.cache.filter(c => typeFilter ? c.type === typeFilter : c.type !== ChannelType.GuildCategory);
  const lower = name.toLowerCase();
  const stripped = stripEmojis(lower);

  // 1. Exact match
  let match = channels.find(c => c.name.toLowerCase() === lower);
  if (match) return { match, suggestions: [] };

  // 2. Match after stripping emojis from channel names
  match = channels.find(c => stripEmojis(c.name.toLowerCase()) === stripped);
  if (match) return { match, suggestions: [] };

  // 3. Partial/contains match
  match = channels.find(c => stripEmojis(c.name.toLowerCase()).includes(stripped) || stripped.includes(stripEmojis(c.name.toLowerCase())));
  if (match) return { match, suggestions: [] };

  // 4. No match — gather suggestions using string similarity
  const suggestions = channels
    .map(c => ({ name: c.name, score: similarity(stripped, stripEmojis(c.name.toLowerCase())) }))
    .filter(s => s.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => s.name);

  return { match: null, suggestions };
}

/**
 * Find a category by name with fuzzy matching.
 */
function findCategory(guild, name) {
  const result = findChannel(guild, name, ChannelType.GuildCategory);
  return result;
}

/**
 * Simple string similarity (Dice coefficient on bigrams).
 */
function similarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s) => { const set = new Map(); for (let i = 0; i < s.length - 1; i++) { const bg = s.slice(i, i + 2); set.set(bg, (set.get(bg) || 0) + 1); } return set; };
  const aBi = bigrams(a), bBi = bigrams(b);
  let matches = 0;
  for (const [bg, count] of aBi) { if (bBi.has(bg)) matches += Math.min(count, bBi.get(bg)); }
  return (2 * matches) / (a.length - 1 + b.length - 1);
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

module.exports = [
  {
    name: 'create_text_channel',
    description: 'Create a text channel, optionally in a category',
    category: 'channels',
    requiredPermission: 3,
    destructive: false,
    parameters: {
      name: { type: 'string', description: 'Channel name', required: true },
      category: { type: 'string', description: 'Category name to place it in', required: false },
    },
    async execute(guild, invoker, params) {
      const options = { name: params.name, type: ChannelType.GuildText };
      if (params.category) {
        const { match: cat, suggestions } = findCategory(guild, params.category);
        if (!cat) return { success: false, message: notFoundMsg('Category', params.category, suggestions) };
        options.parent = cat.id;
      }
      const channel = await guild.channels.create(options);
      return { success: true, message: `Created text channel #${channel.name}` };
    },
  },
  {
    name: 'create_voice_channel',
    description: 'Create a voice channel, optionally in a category',
    category: 'channels',
    requiredPermission: 3,
    destructive: false,
    parameters: {
      name: { type: 'string', description: 'Channel name', required: true },
      category: { type: 'string', description: 'Category name', required: false },
    },
    async execute(guild, invoker, params) {
      const options = { name: params.name, type: ChannelType.GuildVoice };
      if (params.category) {
        const { match: cat, suggestions } = findCategory(guild, params.category);
        if (!cat) return { success: false, message: notFoundMsg('Category', params.category, suggestions) };
        options.parent = cat.id;
      }
      const channel = await guild.channels.create(options);
      return { success: true, message: `Created voice channel ${channel.name}` };
    },
  },
  {
    name: 'create_category',
    description: 'Create a channel category',
    category: 'channels',
    requiredPermission: 3,
    destructive: false,
    parameters: {
      name: { type: 'string', description: 'Category name', required: true },
    },
    async execute(guild, invoker, params) {
      const channel = await guild.channels.create({ name: params.name, type: ChannelType.GuildCategory });
      return { success: true, message: `Created category "${channel.name}"` };
    },
  },
  {
    name: 'delete_channel',
    description: 'Delete a channel',
    category: 'channels',
    requiredPermission: 3,
    destructive: true,
    parameters: {
      channelId: { type: 'string', description: 'Channel ID or name', required: true },
    },
    async execute(guild, invoker, params) {
      let channel = guild.channels.cache.get(params.channelId);
      if (!channel) {
        const { match, suggestions } = findChannel(guild, params.channelId);
        if (!match) return { success: false, message: notFoundMsg('Channel', params.channelId, suggestions) };
        channel = match;
      }
      const name = channel.name;
      await channel.delete('Deleted by AI Agent');
      return { success: true, message: `Deleted channel #${name}` };
    },
  },
  {
    name: 'move_channel',
    description: 'Move a channel to a different category',
    category: 'channels',
    requiredPermission: 3,
    destructive: false,
    parameters: {
      channel: { type: 'string', description: 'Channel name or ID to move', required: true },
      category: { type: 'string', description: 'Target category name to move the channel into', required: true },
    },
    async execute(guild, invoker, params) {
      let channel = guild.channels.cache.get(params.channel);
      if (!channel) {
        const { match, suggestions } = findChannel(guild, params.channel);
        if (!match) return { success: false, message: notFoundMsg('Channel', params.channel, suggestions) };
        channel = match;
      }

      const { match: category, suggestions } = findCategory(guild, params.category);
      if (!category) return { success: false, message: notFoundMsg('Category', params.category, suggestions) };

      await channel.setParent(category.id, { reason: 'Moved by AI Agent' });
      return { success: true, message: `Moved #${channel.name} to category "${category.name}"` };
    },
  },
  {
    name: 'rename_channel',
    description: 'Rename a channel',
    category: 'channels',
    requiredPermission: 3,
    destructive: false,
    parameters: {
      channel: { type: 'string', description: 'Channel name or ID to rename', required: true },
      newName: { type: 'string', description: 'New name for the channel', required: true },
    },
    async execute(guild, invoker, params) {
      let channel = guild.channels.cache.get(params.channel);
      if (!channel) {
        const { match, suggestions } = findChannel(guild, params.channel);
        if (!match) return { success: false, message: notFoundMsg('Channel', params.channel, suggestions) };
        channel = match;
      }

      const oldName = channel.name;
      await channel.setName(params.newName, 'Renamed by AI Agent');
      return { success: true, message: `Renamed #${oldName} to #${channel.name}` };
    },
  },
  {
    name: 'list_channels',
    description: 'List all server channels grouped by category',
    category: 'channels',
    requiredPermission: 0,
    destructive: false,
    parameters: {},
    async execute(guild) {
      const channels = guild.channels.cache
        .filter(c => c.type !== ChannelType.GuildCategory)
        .sort((a, b) => a.position - b.position);

      const grouped = {};
      channels.forEach(c => {
        const catName = c.parent?.name || 'No Category';
        if (!grouped[catName]) grouped[catName] = [];
        const type = c.type === ChannelType.GuildVoice ? '🔊' : '#';
        grouped[catName].push(`${type}${c.name}`);
      });

      const list = Object.entries(grouped).map(([cat, chs]) => `**${cat}**\n${chs.join(', ')}`).join('\n\n');
      return { success: true, message: list || 'No channels found' };
    },
  },
];
