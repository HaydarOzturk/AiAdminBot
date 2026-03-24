const { Events } = require('discord.js');
const voiceXp = require('../systems/voiceXp');
const afkManager = require('../systems/afkManager');

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
      afkManager.recordActivity(guildId, userId);
    } else if (wasInVoice && !isInVoice) {
      // User left all voice channels
      voiceXp.trackLeave(guildId, userId);
      afkManager.removeTracking(guildId, userId);
    } else if (wasInVoice && isInVoice) {
      // User switched channels — this counts as activity
      afkManager.recordActivity(guildId, userId);
    }

    // Detect activity changes: unmute, undeafen, start streaming
    // These indicate the user is active, so reset their AFK timer
    if (isInVoice) {
      const becameUnmuted = oldState.selfMute && !newState.selfMute;
      const becameUndeafened = oldState.selfDeaf && !newState.selfDeaf;
      const startedStreaming = !oldState.streaming && newState.streaming;
      const startedVideo = !oldState.selfVideo && newState.selfVideo;

      if (becameUnmuted || becameUndeafened || startedStreaming || startedVideo) {
        afkManager.recordActivity(guildId, userId);
      }
    }
  },
};
