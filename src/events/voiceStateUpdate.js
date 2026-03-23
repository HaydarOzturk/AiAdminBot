const { Events } = require('discord.js');
const voiceXp = require('../systems/voiceXp');

module.exports = {
  name: Events.VoiceStateUpdate,
  execute(oldState, newState) {
    // Ignore bots
    if (newState.member?.user?.bot) return;

    const userId = newState.id;
    const guildId = newState.guild.id;

    const wasInVoice = !!oldState.channelId;
    const isInVoice = !!newState.channelId;

    if (!wasInVoice && isInVoice) {
      // User joined a voice channel
      voiceXp.trackJoin(guildId, userId);
    } else if (wasInVoice && !isInVoice) {
      // User left all voice channels
      voiceXp.trackLeave(guildId, userId);
    }
    // If switching channels (wasInVoice && isInVoice), they stay tracked — no action needed
  },
};
