const { Events, ActivityType, REST, Routes } = require('discord.js');
const { t } = require('../utils/locale');
const allCommands = require('../commands');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(t('general.botReady', { username: client.user.tag }));

    // Set bot status
    client.user.setActivity('managing servers 🛡️', {
      type: ActivityType.Watching,
    });

    console.log(`\n🟢 Bot is online and ready!`);
    console.log(`📊 Serving ${client.guilds.cache.size} server(s)`);
    console.log(`👥 Watching ${client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)} members\n`);

    // Auto-deploy slash commands on startup
    try {
      const commands = allCommands
        .filter(cmd => 'data' in cmd)
        .map(cmd => cmd.data.toJSON());

      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

      // Register globally
      await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: commands }
      );
      console.log(`🌐 Registered ${commands.length} slash commands globally.`);

      // Also register to each server instantly (no 1-hour wait)
      for (const guild of client.guilds.cache.values()) {
        try {
          await rest.put(
            Routes.applicationGuildCommands(client.user.id, guild.id),
            { body: commands }
          );
          console.log(`   ⚡ ${guild.name} — commands ready`);
        } catch (err) {
          console.warn(`   ⚠️  ${guild.name}: ${err.message}`);
        }
      }
    } catch (err) {
      console.error('⚠️  Failed to auto-deploy commands:', err.message);
    }

    // Start the log cleaner (auto-clears log channels every 72 hours)
    const { startLogCleaner } = require('../systems/logCleaner');
    startLogCleaner(client);

    // Start voice XP tracking
    const voiceXp = require('../systems/voiceXp');
    voiceXp.initVoiceTracking(client);
    voiceXp.startVoiceXpTimer(client);

    // Auto-sync roles on startup if enabled
    const { loadConfig } = require('../utils/paths');
    try {
      const botConfig = loadConfig('config.json');
      if (botConfig.sync?.runOnStartup) {
        const { syncMembers } = require('../commands/utility/sync');
        for (const guild of client.guilds.cache.values()) {
          try {
            const result = await syncMembers(guild, false, guild.id);
            if (result.error) continue;
            const fixed = result.assignedUnverified + result.assignedVerified;
            if (fixed > 0) {
              console.log(`🔄 Auto-sync: Fixed ${fixed} member(s) in ${guild.name}`);
            }
          } catch (err) {
            console.warn(`⚠️ Auto-sync failed for ${guild.name}: ${err.message}`);
          }
        }
      }
    } catch {
      // Config not available, skip auto-sync
    }
  },
};
