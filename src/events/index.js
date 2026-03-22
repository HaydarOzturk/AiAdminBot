/**
 * Static event registry — all events are explicitly required here
 * so that pkg can bundle them at compile time (no dynamic require).
 */
module.exports = [
  require('./ready'),
  require('./interactionCreate'),
  require('./messageCreate'),
  require('./messageUpdate'),
  require('./messageDelete'),
  require('./guildMemberAdd'),
  require('./guildMemberRemove'),
  require('./guildMemberUpdate'),
  require('./channelEvents'),
];
