const { Events } = require('discord.js');
const streamAnnouncer = require('../systems/streamAnnouncer');

module.exports = {
  name: Events.PresenceUpdate,
  async execute(oldPresence, newPresence) {
    // Stream announcements — detect guild owner going live / ending stream
    await streamAnnouncer.handlePresenceUpdate(oldPresence, newPresence);
  },
};
