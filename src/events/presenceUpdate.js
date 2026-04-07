const { Events } = require('discord.js');
const streamManager = require('../systems/streamManager');

module.exports = {
  name: Events.PresenceUpdate,
  async execute(oldPresence, newPresence) {
    // Stream announcements — detect guild owner going live / ending stream
    await streamManager.handlePresenceUpdate(oldPresence, newPresence);
  },
};
