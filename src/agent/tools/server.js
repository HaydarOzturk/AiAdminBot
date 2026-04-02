const db = require('../../utils/database');

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
];
