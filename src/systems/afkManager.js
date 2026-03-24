/**
 * AFK Manager — Tracks voice channel idle time and moves idle users to AFK channel.
 *
 * Discord has a built-in AFK timeout (guild.afkTimeout + guild.afkChannelId),
 * but it only detects "no input activity" at the client level.
 *
 * This system provides a server-side backup:
 * - Tracks the last "activity" timestamp per user in voice channels
 * - Activity = joining a channel, switching channels, unmuting, undeafening, streaming
 * - Every 60 seconds, checks for users idle longer than AFK_TIMEOUT_MINUTES
 * - Moves idle users to the guild's AFK channel
 * - Skips users already in the AFK channel
 *
 * The AFK channel itself has Speak denied for @everyone (set in serverSetup.js),
 * so nobody can talk there — it's a parking zone.
 */

const { ChannelType } = require('discord.js');
const { channelName } = require('../utils/locale');

// How often to check for idle users (ms)
const CHECK_INTERVAL = 60000; // 1 minute

// How long a user can be idle before being moved (ms)
const AFK_TIMEOUT_MS = parseInt(process.env.AFK_TIMEOUT_MINUTES || '10') * 60000;

// Track last activity per user: Map<"guildId-userId", timestamp>
const lastActivity = new Map();

// Reference to the check interval
let _checkInterval = null;

// Reference to the Discord client
let _client = null;

/**
 * Record user activity (join, switch, unmute, undeafen, stream start)
 * @param {string} guildId
 * @param {string} userId
 */
function recordActivity(guildId, userId) {
  lastActivity.set(`${guildId}-${userId}`, Date.now());
}

/**
 * Remove tracking for a user (left voice entirely)
 * @param {string} guildId
 * @param {string} userId
 */
function removeTracking(guildId, userId) {
  lastActivity.delete(`${guildId}-${userId}`);
}

/**
 * Find the AFK voice channel for a guild.
 * Uses the guild's configured AFK channel, or falls back to
 * searching for a channel matching the locale AFK channel name.
 * @param {import('discord.js').Guild} guild
 * @returns {import('discord.js').VoiceChannel|null}
 */
function findAfkChannel(guild) {
  // First try the guild's built-in AFK channel setting
  if (guild.afkChannelId) {
    const ch = guild.channels.cache.get(guild.afkChannelId);
    if (ch && ch.type === ChannelType.GuildVoice) return ch;
  }

  // Fallback: search for a channel named "afk" in all locales
  const afkNames = new Set();
  afkNames.add('afk');
  afkNames.add('AFK');

  // Get locale-specific AFK channel name for this guild
  const localeName = channelName('afk', guild.id);
  if (localeName) afkNames.add(localeName);

  for (const name of afkNames) {
    const ch = guild.channels.cache.find(
      c => c.type === ChannelType.GuildVoice && c.name.toLowerCase() === name.toLowerCase()
    );
    if (ch) return ch;
  }

  return null;
}

/**
 * Check all guilds for idle voice users and move them to AFK channel
 */
async function checkIdleUsers() {
  if (!_client) return;

  const now = Date.now();

  for (const [, guild] of _client.guilds.cache) {
    const afkChannel = findAfkChannel(guild);
    if (!afkChannel) continue; // No AFK channel configured for this guild

    for (const [, state] of guild.voiceStates.cache) {
      // Skip bots
      if (state.member?.user?.bot) continue;
      // Skip users not in a voice channel
      if (!state.channelId) continue;
      // Skip users already in the AFK channel
      if (state.channelId === afkChannel.id) continue;

      const key = `${guild.id}-${state.member.id}`;
      const lastActive = lastActivity.get(key);

      if (!lastActive) {
        // No activity recorded — start tracking from now
        lastActivity.set(key, now);
        continue;
      }

      const idleTime = now - lastActive;

      if (idleTime >= AFK_TIMEOUT_MS) {
        try {
          await state.setChannel(afkChannel, 'AFK timeout — idle too long');
          // Reset their activity so they don't get moved again immediately if they come back
          lastActivity.delete(key);
        } catch (err) {
          // Likely missing permissions or user disconnected
          if (err.code !== 50013) { // Ignore "Missing Permissions" silently
            console.warn(`AFK move failed for ${state.member.user?.tag}: ${err.message}`);
          }
        }
      }
    }
  }
}

/**
 * Initialize AFK tracking for users already in voice channels.
 * Call on bot startup.
 * @param {import('discord.js').Client} client
 */
function initAfkTracking(client) {
  _client = client;

  let count = 0;
  for (const [, guild] of client.guilds.cache) {
    for (const [, state] of guild.voiceStates.cache) {
      if (state.channelId && !state.member?.user?.bot) {
        recordActivity(guild.id, state.member.id);
        count++;
      }
    }
  }

  if (count > 0) {
    console.log(`💤 Initialized AFK tracking for ${count} users already in voice channels`);
  }
}

/**
 * Start the AFK check interval timer
 * @param {import('discord.js').Client} client
 */
function startAfkTimer(client) {
  _client = client;
  if (_checkInterval) return; // Already running

  _checkInterval = setInterval(checkIdleUsers, CHECK_INTERVAL);
  console.log(`💤 AFK timer started (move after ${AFK_TIMEOUT_MS / 60000} min idle, check every ${CHECK_INTERVAL / 1000}s)`);
}

/**
 * Stop the AFK check interval timer
 */
function stopAfkTimer() {
  if (_checkInterval) {
    clearInterval(_checkInterval);
    _checkInterval = null;
  }
}

module.exports = {
  recordActivity,
  removeTracking,
  findAfkChannel,
  initAfkTracking,
  startAfkTimer,
  stopAfkTimer,
};
