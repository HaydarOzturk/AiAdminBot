const db = require('../../utils/database');
const { logModAction, sendModLog } = require('../../utils/modLogger');

module.exports = [
  {
    name: 'warn_user',
    description: 'Warn a user with a reason',
    category: 'moderation',
    requiredPermission: 2,
    destructive: false,
    parameters: {
      userId: { type: 'string', description: 'User ID or mention', required: true },
      reason: { type: 'string', description: 'Warning reason', required: false },
    },
    async execute(guild, invoker, params) {
      const reason = params.reason || 'No reason given';
      db.run(
        'INSERT INTO warnings (user_id, guild_id, moderator_id, reason) VALUES (?, ?, ?, ?)',
        [params.userId, guild.id, invoker.id, reason]
      );
      const caseId = logModAction('warn', params.userId, guild.id, invoker.id, reason);
      const member = await guild.members.fetch(params.userId).catch(() => null);
      return { success: true, message: `Warned ${member?.user?.tag || params.userId}: ${reason} (Case #${caseId})` };
    },
  },
  {
    name: 'timeout_user',
    description: 'Timeout/mute a user for a specified duration',
    category: 'moderation',
    requiredPermission: 2,
    destructive: false,
    parameters: {
      userId: { type: 'string', description: 'User ID or mention', required: true },
      duration: { type: 'number', description: 'Duration in minutes', required: true },
      reason: { type: 'string', description: 'Timeout reason', required: false },
    },
    async execute(guild, invoker, params) {
      const member = await guild.members.fetch(params.userId).catch(() => null);
      if (!member) return { success: false, message: 'User not found' };
      if (!member.moderatable) return { success: false, message: 'Cannot moderate this user' };

      const ms = (params.duration || 5) * 60 * 1000;
      const reason = params.reason || 'No reason given';
      await member.timeout(ms, reason);

      const caseId = logModAction('timeout', params.userId, guild.id, invoker.id, reason);
      return { success: true, message: `Timed out ${member.user.tag} for ${params.duration} minutes: ${reason} (Case #${caseId})` };
    },
  },
  {
    name: 'kick_user',
    description: 'Kick a user from the server',
    category: 'moderation',
    requiredPermission: 3,
    destructive: true,
    parameters: {
      userId: { type: 'string', description: 'User ID or mention', required: true },
      reason: { type: 'string', description: 'Kick reason', required: false },
    },
    async execute(guild, invoker, params) {
      const member = await guild.members.fetch(params.userId).catch(() => null);
      if (!member) return { success: false, message: 'User not found' };
      if (!member.kickable) return { success: false, message: 'Cannot kick this user' };

      const reason = params.reason || 'No reason given';
      await member.kick(reason);
      const caseId = logModAction('kick', params.userId, guild.id, invoker.id, reason);
      return { success: true, message: `Kicked ${member.user.tag}: ${reason} (Case #${caseId})` };
    },
  },
  {
    name: 'ban_user',
    description: 'Ban a user from the server',
    category: 'moderation',
    requiredPermission: 4,
    destructive: true,
    parameters: {
      userId: { type: 'string', description: 'User ID or mention', required: true },
      reason: { type: 'string', description: 'Ban reason', required: false },
    },
    async execute(guild, invoker, params) {
      const reason = params.reason || 'No reason given';
      await guild.members.ban(params.userId, { reason });
      const caseId = logModAction('ban', params.userId, guild.id, invoker.id, reason);
      return { success: true, message: `Banned user ${params.userId}: ${reason} (Case #${caseId})` };
    },
  },
  {
    name: 'get_warnings',
    description: 'Get warning count and history for a user',
    category: 'moderation',
    requiredPermission: 2,
    destructive: false,
    parameters: {
      userId: { type: 'string', description: 'User ID', required: true },
    },
    async execute(guild, invoker, params) {
      const warnings = db.all(
        'SELECT * FROM warnings WHERE user_id = ? AND guild_id = ? ORDER BY created_at DESC LIMIT 10',
        [params.userId, guild.id]
      );
      if (warnings.length === 0) return { success: true, message: 'No warnings found for this user.' };

      const list = warnings.map((w, i) => `${i + 1}. ${w.reason} (${w.created_at})`).join('\n');
      return { success: true, message: `${warnings.length} warning(s):\n${list}` };
    },
  },
];
