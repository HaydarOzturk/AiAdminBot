const { Events } = require('discord.js');

module.exports = {
  name: Events.GuildCreate,
  once: false,
  async execute(guild) {
    console.log(`📥 Joined new guild: ${guild.name} (${guild.id}) — ${guild.memberCount} members`);

    // Auto-position bot role near the top so it can manage other roles
    try {
      const botMember = guild.members.me;
      if (!botMember) return;

      const botRole = botMember.roles.botRole;
      if (!botRole) return;

      const highestRole = guild.roles.cache
        .filter(r => r.id !== guild.id) // exclude @everyone
        .sort((a, b) => b.position - a.position)
        .first();

      if (highestRole && botRole.position < highestRole.position) {
        await botRole.setPosition(highestRole.position - 1);
        console.log(`  🔼 Auto-positioned bot role "${botRole.name}" to position ${highestRole.position - 1}`);
      }
    } catch (err) {
      console.warn(`  ⚠️ Could not auto-position bot role in ${guild.name}: ${err.message}`);
    }
  },
};
