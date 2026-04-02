const { Events } = require('discord.js');

module.exports = {
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    // Ignore bots
    if (user.bot) return;

    // Fetch partial reactions
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }

    if (!reaction.message.guild) return;

    // ── Starboard ─────────────────────────────────────────────────────────
    try {
      const starboard = require('../systems/starboard');
      await starboard.handleReaction(reaction, user);
    } catch (error) {
      console.error('❌ Starboard reaction error:', error.message);
    }
  },
};
