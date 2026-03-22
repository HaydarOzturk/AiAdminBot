const { Events, ActivityType } = require('discord.js');
const { t } = require('../utils/locale');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(t('general.botReady', { username: client.user.tag }));

    // Set bot status
    client.user.setActivity('managing servers 🛡️', {
      type: ActivityType.Watching,
    });

    console.log(`\n🟢 Bot is online and ready!`);
    console.log(`📊 Serving ${client.guilds.cache.size} server(s)`);
    console.log(`👥 Watching ${client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)} members\n`);

    // Start the log cleaner (auto-clears log channels every 72 hours)
    const { startLogCleaner } = require('../systems/logCleaner');
    startLogCleaner(client);
  },
};
