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

      // Register globally (propagates to all guilds within ~1 hour)
      await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: commands }
      );
      console.log(`🌐 Registered ${commands.length} slash commands globally.`);

      // Per-guild instant sync — only for small bot deployments (<20 guilds)
      // to avoid rate limits. Global registration handles the rest.
      const guildCount = client.guilds.cache.size;
      if (guildCount <= 20) {
        let ok = 0, fail = 0;
        for (const guild of client.guilds.cache.values()) {
          try {
            await rest.put(
              Routes.applicationGuildCommands(client.user.id, guild.id),
              { body: commands }
            );
            ok++;
          } catch {
            fail++;
          }
        }
        console.log(`   ⚡ Instant sync: ${ok} guilds ready${fail > 0 ? `, ${fail} failed` : ''}`);
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

    // Start AFK idle tracking
    const afkManager = require('../systems/afkManager');
    afkManager.initAfkTracking(client);
    afkManager.startAfkTimer(client);

    // Start automatic stream watcher (Twitch/YouTube/Kick polling)
    if (process.env.STREAMING_ENABLED !== 'false') {
      try {
        const { startStreamWatcher } = require('../systems/streamWatcher');
        startStreamWatcher(client).catch(err => {
          console.error('❌ Stream watcher failed to start:', err.message);
        });
      } catch (err) {
        console.warn('⚠️ Stream watcher not available:', err.message);
      }
    }

    // Start knowledge base maintenance (message log pruning + summaries)
    try {
      const { startKnowledgeMaintenance } = require('../systems/knowledgeBase');
      startKnowledgeMaintenance(client);
    } catch (err) {
      console.warn('⚠️ Knowledge base maintenance failed to start:', err.message);
    }

    // Restore active giveaway timers
    try {
      const { restoreGiveawayTimers } = require('../systems/giveaway');
      restoreGiveawayTimers(client);
    } catch (err) {
      console.warn('⚠️ Giveaway timer restore failed:', err.message);
    }

    // Seed role menus from JSON config into DB, then scan for legacy published messages
    try {
      const { seedMenusFromConfig, scanAndRegisterLegacyMenus } = require('../systems/roleMenus');
      for (const guild of client.guilds.cache.values()) {
        seedMenusFromConfig(guild.id);
      }
      // Scan after all guilds are seeded (async, don't block startup)
      for (const guild of client.guilds.cache.values()) {
        scanAndRegisterLegacyMenus(client, guild.id).catch(err => {
          console.warn(`⚠️ Legacy menu scan failed for ${guild.name}: ${err.message}`);
        });
      }
    } catch (err) {
      console.warn('⚠️ Role menu seeding failed:', err.message);
    }

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
