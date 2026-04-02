const levelingSystem = require('../../systems/leveling');

module.exports = [
  {
    name: 'award_xp',
    description: 'Award XP to a user (max 30)',
    category: 'leveling',
    requiredPermission: 2,
    destructive: false,
    parameters: {
      userId: { type: 'string', description: 'User ID or mention', required: true },
      amount: { type: 'number', description: 'XP amount (1-30)', required: true },
    },
    async execute(guild, invoker, params) {
      const amount = Math.min(30, Math.max(1, params.amount || 1));
      const result = levelingSystem.awardXp(params.userId, guild.id, amount);
      let msg = `Awarded ${amount} XP. Now level ${result.newLevel} (${Math.round(result.xp * 10) / 10} XP)`;
      if (result.newLevel > result.oldLevel) msg += ` — Level up! ${result.oldLevel} → ${result.newLevel}`;
      return { success: true, message: msg };
    },
  },
  {
    name: 'get_leaderboard',
    description: 'Get the server XP leaderboard',
    category: 'leveling',
    requiredPermission: 0,
    destructive: false,
    parameters: {
      limit: { type: 'number', description: 'Number of entries (default 10)', required: false },
    },
    async execute(guild, invoker, params) {
      const limit = Math.min(25, params.limit || 10);
      const lb = levelingSystem.getLeaderboard(guild.id, limit);
      if (lb.length === 0) return { success: true, message: 'Leaderboard is empty.' };

      const lines = [];
      for (let i = 0; i < lb.length; i++) {
        const u = lb[i];
        const member = guild.members.cache.get(u.user_id);
        const name = member?.user?.username || u.user_id;
        lines.push(`#${i + 1} ${name} — Level ${u.level} (${Math.round(u.xp * 10) / 10} XP, ${u.messages || 0} msgs)`);
      }
      return { success: true, message: lines.join('\n') };
    },
  },
  {
    name: 'get_user_rank',
    description: 'Get a user\'s rank and level data',
    category: 'leveling',
    requiredPermission: 0,
    destructive: false,
    parameters: {
      userId: { type: 'string', description: 'User ID or mention', required: true },
    },
    async execute(guild, invoker, params) {
      const data = levelingSystem.getUserData(params.userId, guild.id);
      const member = await guild.members.fetch(params.userId).catch(() => null);
      const name = member?.user?.username || params.userId;
      return {
        success: true,
        message: `${name}: Rank #${data.rank || '?'}, Level ${data.level}, XP ${data.xp}/${data.xpNeeded}, ${data.messages} messages, ${data.voiceMinutes} voice minutes, Tier: ${data.tier?.name || 'None'}`,
      };
    },
  },
];
