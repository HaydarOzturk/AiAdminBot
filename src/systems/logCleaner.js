const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../utils/paths');

// Load config
const config = loadConfig('config.json');

const CLEAR_INTERVAL = 72 * 60 * 60 * 1000; // 72 hours in ms
const MAX_DELETE_AGE = 14 * 24 * 60 * 60 * 1000; // Discord only allows bulk delete of messages < 14 days

/**
 * Start the automatic log channel cleaner.
 * Runs every 72 hours and bulk-deletes messages in all log channels.
 * @param {import('discord.js').Client} client
 */
function startLogCleaner(client) {
  console.log('🧹 Log cleaner scheduled (every 72 hours)');

  // Run the first cleanup 5 minutes after startup (let everything settle)
  setTimeout(() => runCleanup(client), 5 * 60 * 1000);

  // Then every 72 hours
  setInterval(() => runCleanup(client), CLEAR_INTERVAL);
}

/**
 * Run cleanup on all guilds
 */
async function runCleanup(client) {
  const logChannelNames = Object.values(config.moderation?.logChannels || {});

  if (logChannelNames.length === 0) {
    console.log('🧹 No log channels configured, skipping cleanup');
    return;
  }

  console.log(`🧹 Running log cleanup for ${client.guilds.cache.size} guild(s)...`);

  for (const [, guild] of client.guilds.cache) {
    for (const channelName of logChannelNames) {
      const channel = guild.channels.cache.find(
        c => c.name === channelName && c.isTextBased()
      );

      if (!channel) continue;

      try {
        let totalDeleted = 0;
        let fetched;

        // Fetch and delete in batches of 100
        do {
          fetched = await channel.messages.fetch({ limit: 100 });

          // Filter out messages older than 14 days (Discord won't let us bulk delete those)
          const deletable = fetched.filter(
            m => Date.now() - m.createdTimestamp < MAX_DELETE_AGE
          );

          if (deletable.size === 0) break;

          const deleted = await channel.bulkDelete(deletable, true);
          totalDeleted += deleted.size;

          // If we deleted less than we fetched, remaining are too old
          if (deleted.size < deletable.size) break;
        } while (fetched.size === 100);

        if (totalDeleted > 0) {
          console.log(`  🗑️ #${channelName} (${guild.name}): ${totalDeleted} messages deleted`);
        }
      } catch (err) {
        console.error(`  ❌ #${channelName} (${guild.name}): ${err.message}`);
      }
    }
  }

  console.log('🧹 Log cleanup complete');
}

module.exports = { startLogCleaner };
