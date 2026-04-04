const db = require('../../utils/database');
const { channelName } = require('../../utils/locale');

// Default channel structure — what /setup creates
// Mandatory: channels the bot needs to function (logs, verification, etc.)
// Optional: community channels that can be customized
const DEFAULT_CHANNELS = {
  mandatory: [
    { id: 'rules', category: 'cat-verification', type: 'text', purpose: 'Server rules (read-only)' },
    { id: 'verification', category: 'cat-verification', type: 'text', purpose: 'Verification button for new members' },
    { id: 'message-log', category: 'cat-logs', type: 'text', purpose: 'Deleted/edited message logs' },
    { id: 'join-leave-log', category: 'cat-logs', type: 'text', purpose: 'Member join/leave logs' },
    { id: 'punishment-log', category: 'cat-logs', type: 'text', purpose: 'Warning/mute/kick/ban logs' },
    { id: 'role-log', category: 'cat-logs', type: 'text', purpose: 'Role change logs' },
    { id: 'name-log', category: 'cat-logs', type: 'text', purpose: 'Nickname change logs' },
    { id: 'channel-log', category: 'cat-logs', type: 'text', purpose: 'Channel change logs' },
    { id: 'ban-log', category: 'cat-logs', type: 'text', purpose: 'Ban logs' },
    { id: 'bot-commands', category: 'cat-chat', type: 'text', purpose: 'Bot commands zone' },
    { id: 'ai-chat', category: 'cat-chat', type: 'text', purpose: 'AI chat channel' },
  ],
  optional: [
    { id: 'general-chat', category: 'cat-chat', type: 'text', purpose: 'General discussion' },
    { id: 'media', category: 'cat-chat', type: 'text', purpose: 'Images/videos/links' },
    { id: 'welcome', category: 'cat-welcome', type: 'text', purpose: 'New member announcements' },
    { id: 'goodbye', category: 'cat-welcome', type: 'text', purpose: 'Member leave messages' },
    { id: 'color-roles', category: 'cat-roles', type: 'text', purpose: 'Color role selection menu' },
    { id: 'game-roles', category: 'cat-roles', type: 'text', purpose: 'Game role selection menu' },
    { id: 'platform-roles', category: 'cat-roles', type: 'text', purpose: 'Platform role selection menu' },
    { id: 'voice-general', category: 'cat-voice', type: 'voice', purpose: 'General voice chat' },
    { id: 'voice-game-1', category: 'cat-voice', type: 'voice', purpose: 'Game room 1' },
    { id: 'voice-game-2', category: 'cat-voice', type: 'voice', purpose: 'Game room 2' },
    { id: 'voice-music', category: 'cat-voice', type: 'voice', purpose: 'Music voice channel' },
    { id: 'staff-chat', category: 'cat-staff', type: 'text', purpose: 'Staff discussion' },
    { id: 'staff-commands', category: 'cat-staff', type: 'text', purpose: 'Staff bot commands' },
    { id: 'staff-voice', category: 'cat-staff', type: 'voice', purpose: 'Staff voice room' },
    { id: 'stream-announcements', category: 'cat-streaming', type: 'text', purpose: 'Stream notifications' },
    { id: 'stream-chat', category: 'cat-streaming', type: 'text', purpose: 'Live stream chat' },
    { id: 'afk', category: 'cat-afk', type: 'voice', purpose: 'AFK voice channel' },
  ],
};

module.exports = [
  {
    name: 'get_server_info',
    description: 'Get server information (member count, channels, roles, etc.)',
    category: 'server',
    requiredPermission: 0,
    destructive: false,
    parameters: {},
    async execute(guild) {
      const info = [
        `Server: ${guild.name}`,
        `Members: ${guild.memberCount}`,
        `Channels: ${guild.channels.cache.size}`,
        `Roles: ${guild.roles.cache.size}`,
        `Owner: ${(await guild.fetchOwner()).user.tag}`,
        `Created: ${guild.createdAt.toISOString().slice(0, 10)}`,
        `Boost Level: ${guild.premiumTier}`,
        `Boosts: ${guild.premiumSubscriptionCount || 0}`,
      ];
      return { success: true, message: info.join('\n') };
    },
  },
  {
    name: 'get_member_info',
    description: 'Get information about a specific member',
    category: 'server',
    requiredPermission: 0,
    destructive: false,
    parameters: {
      userId: { type: 'string', description: 'User ID or mention', required: true },
    },
    async execute(guild, invoker, params) {
      const member = await guild.members.fetch(params.userId).catch(() => null);
      if (!member) return { success: false, message: 'Member not found' };

      const roles = member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).join(', ') || 'None';
      const warnings = db.all('SELECT COUNT(*) as count FROM warnings WHERE user_id = ? AND guild_id = ?', [params.userId, guild.id]);
      const warnCount = warnings[0]?.count || 0;

      const info = [
        `User: ${member.user.tag}`,
        `Display Name: ${member.displayName}`,
        `Joined: ${member.joinedAt?.toISOString().slice(0, 10) || 'Unknown'}`,
        `Account Created: ${member.user.createdAt.toISOString().slice(0, 10)}`,
        `Roles: ${roles}`,
        `Warnings: ${warnCount}`,
        `Bot: ${member.user.bot ? 'Yes' : 'No'}`,
      ];
      return { success: true, message: info.join('\n') };
    },
  },
  {
    name: 'toggle_automod',
    description: 'Enable or disable an automod feature',
    category: 'server',
    requiredPermission: 3,
    destructive: false,
    parameters: {
      feature: { type: 'string', description: 'Feature name: anti_spam, anti_raid, anti_mention_spam, anti_caps, anti_invites', required: true },
      enabled: { type: 'boolean', description: 'true to enable, false to disable', required: true },
    },
    async execute(guild, invoker, params) {
      const validFeatures = ['anti_spam', 'anti_raid', 'anti_mention_spam', 'anti_caps', 'anti_invites', 'progressive_punishments'];
      if (!validFeatures.includes(params.feature)) {
        return { success: false, message: `Invalid feature. Valid: ${validFeatures.join(', ')}` };
      }

      db.run(`INSERT INTO automod_settings (guild_id) VALUES (?) ON CONFLICT(guild_id) DO NOTHING`, [guild.id]);
      db.run(`UPDATE automod_settings SET ${params.feature} = ? WHERE guild_id = ?`, [params.enabled ? 1 : 0, guild.id]);

      return { success: true, message: `${params.feature}: ${params.enabled ? 'Enabled' : 'Disabled'}` };
    },
  },
  {
    name: 'show_default_channels',
    description: 'Show the bot\'s default channel structure and which channels exist/are missing on this server',
    category: 'server',
    requiredPermission: 2,
    destructive: false,
    parameters: {},
    async execute(guild) {
      const g = guild.id;
      const allDefaults = [...DEFAULT_CHANNELS.mandatory, ...DEFAULT_CHANNELS.optional];

      const lines = ['**🔧 Mandatory Channels (bot features depend on these):**'];
      for (const ch of DEFAULT_CHANNELS.mandatory) {
        const localName = channelName(ch.id, g);
        const exists = guild.channels.cache.find(c => c.name === localName);
        const icon = exists ? '✅' : '❌';
        lines.push(`${icon} **${localName}** — ${ch.purpose}`);
      }

      lines.push('\n**📋 Optional Channels:**');
      for (const ch of DEFAULT_CHANNELS.optional) {
        const localName = channelName(ch.id, g);
        const exists = guild.channels.cache.find(c => c.name === localName);
        const icon = exists ? '✅' : '⬜';
        lines.push(`${icon} **${localName}** — ${ch.purpose}`);
      }

      // Count custom channels (not in default list)
      const defaultNames = new Set(allDefaults.map(ch => channelName(ch.id, g)));
      const customChannels = guild.channels.cache.filter(
        c => c.type !== 4 && !defaultNames.has(c.name) // exclude categories
      );
      if (customChannels.size > 0) {
        lines.push(`\n**🎨 Custom Channels:** ${customChannels.size} (${customChannels.map(c => `#${c.name}`).join(', ')})`);
      }

      const mandatoryMissing = DEFAULT_CHANNELS.mandatory.filter(ch => !guild.channels.cache.find(c => c.name === channelName(ch.id, g)));
      if (mandatoryMissing.length > 0) {
        lines.push(`\n⚠️ **${mandatoryMissing.length} mandatory channel(s) missing!** Use /setup or ask me to create them.`);
      }

      return { success: true, message: lines.join('\n') };
    },
  },
  {
    name: 'setup_missing_channels',
    description: 'Create all missing mandatory channels from the default setup',
    category: 'server',
    requiredPermission: 3,
    destructive: false,
    parameters: {
      includeOptional: { type: 'boolean', description: 'Also create missing optional channels (default: false)', required: false },
    },
    async execute(guild, invoker, params) {
      const { ChannelType: CT } = require('discord.js');
      const g = guild.id;
      const channels = params.includeOptional
        ? [...DEFAULT_CHANNELS.mandatory, ...DEFAULT_CHANNELS.optional]
        : DEFAULT_CHANNELS.mandatory;

      const created = [];
      const skipped = [];

      for (const ch of channels) {
        const localName = channelName(ch.id, g);
        const existing = guild.channels.cache.find(c => c.name === localName);
        if (existing) {
          skipped.push(localName);
          continue;
        }

        // Find or create the parent category
        const catLocalName = channelName(ch.category, g);
        let category = guild.channels.cache.find(c => c.type === CT.GuildCategory && c.name === catLocalName);
        if (!category) {
          category = await guild.channels.create({
            name: catLocalName,
            type: CT.GuildCategory,
            reason: 'Setup by AI Agent',
          });
        }

        await guild.channels.create({
          name: localName,
          type: ch.type === 'voice' ? CT.GuildVoice : CT.GuildText,
          parent: category.id,
          reason: 'Setup by AI Agent',
        });
        created.push(localName);
      }

      if (created.length === 0) return { success: true, message: 'All channels already exist! Nothing to create.' };
      return { success: true, message: `Created ${created.length} channel(s): ${created.map(n => `#${n}`).join(', ')}\nSkipped ${skipped.length} (already exist)` };
    },
  },
];
