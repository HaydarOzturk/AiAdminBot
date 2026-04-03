const { ChannelType } = require('discord.js');

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
        const cat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === params.category.toLowerCase());
        if (cat) options.parent = cat.id;
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
        const cat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === params.category.toLowerCase());
        if (cat) options.parent = cat.id;
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
      const channel = guild.channels.cache.get(params.channelId) ||
        guild.channels.cache.find(c => c.name === params.channelId);
      if (!channel) return { success: false, message: 'Channel not found' };
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
      const channel = guild.channels.cache.get(params.channel) ||
        guild.channels.cache.find(c => c.type !== ChannelType.GuildCategory && c.name.toLowerCase() === params.channel.toLowerCase());
      if (!channel) return { success: false, message: `Channel "${params.channel}" not found` };

      const category = guild.channels.cache.find(
        c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === params.category.toLowerCase()
      );
      if (!category) return { success: false, message: `Category "${params.category}" not found` };

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
      const channel = guild.channels.cache.get(params.channel) ||
        guild.channels.cache.find(c => c.type !== ChannelType.GuildCategory && c.name.toLowerCase() === params.channel.toLowerCase());
      if (!channel) return { success: false, message: `Channel "${params.channel}" not found` };

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
