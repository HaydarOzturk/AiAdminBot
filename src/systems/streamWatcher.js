/**
 * Stream Watcher — Automatic live stream detection and announcement.
 *
 * Detection strategy:
 *   Twitch, YouTube, Kick → Polling every ~2 minutes using existing streamingChecker APIs
 *
 * All detections flow through a confirmation pipeline:
 *   detect → wait CONFIRMATION_DELAY → re-check → announce (or discard)
 *
 * This runs alongside the existing /go-live manual command and the presence-based
 * announcer in streamAnnouncer.js. Duplicate announcements are prevented by the
 * shared activeAnnouncements map in streamAnnouncer.js.
 *
 * NOTE on Twitch EventSub:
 *   Twitch EventSub WebSocket transport requires a USER access token (OAuth
 *   Authorization Code flow), not the app access token from Client Credentials.
 *   Implementing a full user OAuth flow (redirect URI, token refresh, etc.) is
 *   a significant addition, so we use polling for Twitch for now. This is reliable
 *   and detects streams within 2-3 minutes. EventSub can be added later if
 *   real-time Twitch detection becomes a priority.
 */

const { all } = require('../utils/database');
const {
  checkTwitch,
  checkYouTube,
  checkKick,
  PLATFORMS,
} = require('./streamingChecker');
const {
  findAnnouncementChannel,
  announceStreamStart,
  announceStreamEnd,
  activeAnnouncements,
} = require('./streamAnnouncer');

// ─── Configuration ──────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = (parseInt(process.env.STREAM_WATCHER_POLL_INTERVAL_SECONDS) || 120) * 1000;
const CONFIRMATION_DELAY_MS = (parseInt(process.env.STREAM_WATCHER_CONFIRMATION_DELAY_SECONDS) || 60) * 1000;

// ─── Internal state ─────────────────────────────────────────────────────────

/** @type {import('discord.js').Client|null} */
let _client = null;

// Polling
let _pollInterval = null;

// Confirmation timers: Map<"guildId|userId|platform", timeoutId>
const _confirmationTimers = new Map();

// Active streams tracked by the watcher: Map<"guildId|userId|platform", { messageId, channelId, detectedAt }>
const _activeWatcherStreams = new Map();

// Previous poll state for detecting transitions: Map<"guildId|userId|platform", boolean>
const _previousPollState = new Map();

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Start the automatic stream watcher.
 * Called from ready.js after the Discord client is fully connected.
 * @param {import('discord.js').Client} client
 */
async function startStreamWatcher(client) {
  if (process.env.STREAMING_ENABLED === 'false') {
    console.log('⏭️  Stream watcher disabled (STREAMING_ENABLED=false)');
    return;
  }

  _client = client;
  console.log('\n📡 Starting automatic stream watcher...');

  // Start polling for all platforms (Twitch, YouTube, Kick)
  _startPolling();

  console.log('✅ Stream watcher running');
  console.log(`   Polling interval: ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`   Confirmation delay: ${CONFIRMATION_DELAY_MS / 1000}s`);
  console.log('   Platforms: Twitch, YouTube, Kick (all via polling)');
}

/**
 * Stop the stream watcher gracefully.
 * Called from index.js on SIGTERM/SIGINT.
 */
function stopStreamWatcher() {
  // Stop polling
  if (_pollInterval) {
    clearInterval(_pollInterval);
    _pollInterval = null;
  }

  // Cancel all pending confirmation timers
  for (const timerId of _confirmationTimers.values()) {
    clearTimeout(timerId);
  }
  _confirmationTimers.clear();

  // Clear state
  _activeWatcherStreams.clear();
  _previousPollState.clear();

  _client = null;
  console.log('🛑 Stream watcher stopped');
}

/**
 * Get diagnostic info about the watcher state (for debugging).
 * @returns {object}
 */
function getStreamWatcherStatus() {
  return {
    polling: {
      active: !!_pollInterval,
      intervalMs: POLL_INTERVAL_MS,
      confirmationDelayMs: CONFIRMATION_DELAY_MS,
    },
    streams: {
      pendingConfirmations: _confirmationTimers.size,
      activeAnnouncements: _activeWatcherStreams.size,
      trackedPlatforms: [..._previousPollState.keys()],
    },
  };
}

// ─── Polling ────────────────────────────────────────────────────────────────

/**
 * Start the polling loop for Twitch, YouTube, and Kick.
 */
function _startPolling() {
  // Run first check after a short delay (let the bot settle)
  setTimeout(() => _pollAllGuilds(), 10000);

  // Then poll on interval
  _pollInterval = setInterval(() => _pollAllGuilds(), POLL_INTERVAL_MS);
  console.log(`📡 Polling started for Twitch/YouTube/Kick (every ${POLL_INTERVAL_MS / 1000}s)`);
}

/**
 * Poll all guilds for live streams.
 */
async function _pollAllGuilds() {
  if (!_client) return;

  for (const guild of _client.guilds.cache.values()) {
    try {
      await _pollGuild(guild);
    } catch (err) {
      console.error(`⚠️ Polling error for ${guild.name}: ${err.message}`);
    }
  }
}

/**
 * Poll a single guild for live streams on all supported platforms.
 */
async function _pollGuild(guild) {
  const streamOwnerId = process.env.STREAM_OWNER_ID || guild.ownerId;

  // Get all streaming links for this guild's stream owner
  const links = all(
    'SELECT * FROM streaming_links WHERE guild_id = ? AND user_id = ?',
    [guild.id, streamOwnerId]
  );

  if (!links || links.length === 0) return;

  // Only poll platforms that have live-detection APIs
  const pollPlatforms = ['twitch', 'youtube', 'youtube-shorts', 'kick'];
  const pollableLinks = links.filter(l => pollPlatforms.includes(l.platform));
  if (pollableLinks.length === 0) return;

  // Check each platform individually for state transition detection
  for (const link of pollableLinks) {
    try {
      const result = await _checkSinglePlatform(link);
      const key = `${guild.id}|${streamOwnerId}|${link.platform}`;
      const wasLive = _previousPollState.get(key) || false;

      _previousPollState.set(key, result.isLive);

      if (!wasLive && result.isLive) {
        // Transition: offline → online
        console.log(`📡 Polling detected: ${link.platform} went LIVE for ${guild.name}`);
        _startConfirmation(key, guild.id, streamOwnerId, link.platform, {
          title: result.title,
          viewers: result.viewers,
          url: result.url || link.platform_url,
        });
      } else if (wasLive && !result.isLive) {
        // Transition: online → offline
        console.log(`📡 Polling detected: ${link.platform} went OFFLINE for ${guild.name}`);
        await _handleStreamEnd(key, guild.id, streamOwnerId);
      }
      // online → online: no action (stream continues)
    } catch (err) {
      console.warn(`⚠️ Poll check failed for ${link.platform} in ${guild.name}: ${err.message}`);
    }
  }
}

/**
 * Check a single platform link for live status.
 */
async function _checkSinglePlatform(link) {
  const handle = link.platform_handle || link.platform_url;
  switch (link.platform) {
    case 'twitch':
      return checkTwitch(handle);
    case 'youtube':
    case 'youtube-shorts':
      return checkYouTube(handle, link.platform);
    case 'kick':
      return checkKick(handle);
    default:
      return { isLive: false, title: '', viewers: 0, url: link.platform_url };
  }
}

// ─── Confirmation Pipeline ──────────────────────────────────────────────────

/**
 * Start the 1-minute confirmation window before announcing.
 *
 * @param {string} key - Unique key: "guildId|userId|platform"
 * @param {string} guildId
 * @param {string} userId - The stream owner's Discord user ID
 * @param {string} platform
 * @param {object} initialInfo - { title?, viewers?, url? }
 */
function _startConfirmation(key, guildId, userId, platform, initialInfo) {
  // Already confirming or already announced? Skip.
  if (_confirmationTimers.has(key)) return;
  if (_activeWatcherStreams.has(key)) return;

  // Also skip if the shared streamAnnouncer already has an announcement for this guild
  if (activeAnnouncements.has(guildId)) return;

  console.log(`⏳ Confirmation started: ${platform} for guild ${guildId} (waiting ${CONFIRMATION_DELAY_MS / 1000}s)`);

  const timer = setTimeout(async () => {
    _confirmationTimers.delete(key);

    try {
      // Re-check the platform to confirm still live
      const links = all(
        'SELECT * FROM streaming_links WHERE guild_id = ? AND user_id = ? AND platform = ?',
        [guildId, userId, platform]
      );

      if (!links || links.length === 0) return;

      const result = await _checkSinglePlatform(links[0]);

      if (!result.isLive) {
        console.log(`❌ Confirmation failed: ${platform} no longer live for guild ${guildId}`);
        return;
      }

      // Still live — announce!
      console.log(`✅ Confirmation passed: ${platform} confirmed live for guild ${guildId}`);
      await _announceStream(guildId, userId, platform, {
        title: result.title || initialInfo.title || '',
        viewers: result.viewers || initialInfo.viewers || 0,
        url: result.url || initialInfo.url || '',
        platform: PLATFORMS[platform]?.label || platform,
      });
    } catch (err) {
      console.error(`⚠️ Confirmation check failed for ${key}: ${err.message}`);
    }
  }, CONFIRMATION_DELAY_MS);

  _confirmationTimers.set(key, timer);
}

/**
 * Announce a confirmed live stream.
 */
async function _announceStream(guildId, userId, platform, streamInfo) {
  if (!_client) return;

  const guild = _client.guilds.cache.get(guildId);
  if (!guild) return;

  // Double-check: don't post if streamAnnouncer already has one active for this guild
  if (activeAnnouncements.has(guildId)) {
    console.log(`ℹ️  Skipping watcher announcement — presence-based announcement already active for ${guild.name}`);
    return;
  }

  // Also skip if the watcher already announced this specific stream
  const key = `${guildId}|${userId}|${platform}`;
  if (_activeWatcherStreams.has(key)) return;

  let member;
  try {
    member = await guild.members.fetch(userId);
  } catch {
    console.warn(`⚠️ Could not fetch stream owner ${userId} in ${guild.name}`);
    return;
  }

  const channel = findAnnouncementChannel(guild);
  if (!channel) {
    console.warn(`⚠️ No announcement channel found in ${guild.name}`);
    return;
  }

  // Final guard right before sending — another system could've announced between
  // the check above and now (e.g., presence-based announcer)
  if (activeAnnouncements.has(guildId)) {
    console.log(`ℹ️  Skipping watcher announcement — announcement appeared during setup for ${guild.name}`);
    return;
  }

  // Use the shared announceStreamStart from streamAnnouncer.js
  const msg = await announceStreamStart(guild, member, {
    url: streamInfo.url,
    title: streamInfo.title,
    game: '',
    platform: streamInfo.platform,
    viewers: streamInfo.viewers,
  });

  if (msg) {
    _activeWatcherStreams.set(key, {
      messageId: msg.id,
      channelId: channel.id,
      detectedAt: Date.now(),
    });
    console.log(`🔴 Auto-announcement posted: ${platform} in ${guild.name}`);
  }
}

/**
 * Handle a stream going offline — edit announcement to "ended".
 */
async function _handleStreamEnd(key, guildId, userId) {
  // Cancel any pending confirmation for this stream
  const timer = _confirmationTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    _confirmationTimers.delete(key);
    console.log(`⏹️  Confirmation cancelled: stream went offline before confirmation for ${key}`);
  }

  // If the watcher posted an announcement, the streamAnnouncer handles it
  // via its own activeAnnouncements map (since we called announceStreamStart)
  if (_activeWatcherStreams.has(key) || activeAnnouncements.has(guildId)) {
    if (!_client) return;

    const guild = _client.guilds.cache.get(guildId);
    if (!guild) return;

    let member;
    try {
      member = await guild.members.fetch(userId);
    } catch {
      // Clean up anyway
      _activeWatcherStreams.delete(key);
      return;
    }

    // Call the shared announceStreamEnd from streamAnnouncer.js
    await announceStreamEnd(guild, member);
    _activeWatcherStreams.delete(key);
    console.log(`⚫ Auto-announcement ended: ${key}`);
  }
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  startStreamWatcher,
  stopStreamWatcher,
  getStreamWatcherStatus,
};
