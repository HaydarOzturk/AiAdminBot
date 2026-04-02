/**
 * Stream Watcher — Automatic live stream detection and announcement.
 *
 * Combines two strategies:
 *   1. Twitch EventSub WebSocket — real-time push notifications for stream.online / stream.offline
 *   2. YouTube & Kick Polling   — periodic checks every ~2 minutes using existing streamingChecker APIs
 *
 * All detections flow through a confirmation pipeline:
 *   detect → wait CONFIRMATION_DELAY → re-check → announce (or discard)
 *
 * This runs alongside the existing /go-live manual command and the presence-based
 * announcer in streamAnnouncer.js. Duplicate announcements are prevented by the
 * shared activeAnnouncements map in streamAnnouncer.js.
 */

const https = require('https');
const WebSocket = require('ws');
const { all } = require('../utils/database');
const {
  getTwitchToken,
  resolveTwitchUserId,
  extractTwitchLogin,
  checkTwitch,
  checkYouTube,
  checkKick,
  fetchJson,
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

const TWITCH_EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws';
const TWITCH_MAX_RECONNECT_DELAY_MS = 60000;
const TWITCH_INITIAL_RECONNECT_DELAY_MS = 5000;

// ─── Internal state ─────────────────────────────────────────────────────────

/** @type {import('discord.js').Client|null} */
let _client = null;

// Twitch EventSub WebSocket state
let _twitchWs = null;
let _twitchSessionId = null;
let _twitchKeepAliveTimeoutSec = 10;
let _twitchHeartbeatTimer = null;
let _twitchReconnectAttempts = 0;
let _twitchConnectedAt = 0;
let _twitchReconnectTimer = null;

// Twitch user ID cache: Map<login, broadcasterId>
const _twitchIdCache = new Map();

// Reverse lookup: Map<broadcasterId, { guildId, userId, login }>
const _broadcasterToGuild = new Map();

// YouTube/Kick polling
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

  // Initialize Twitch EventSub (if credentials are available)
  if (process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET) {
    try {
      await _initTwitchEventSub();
    } catch (err) {
      console.error('❌ Twitch EventSub initialization failed:', err.message);
      console.log('   Twitch streams will still be detected via polling fallback.');
    }
  } else {
    console.log('ℹ️  Twitch credentials not set — skipping EventSub, will poll instead.');
  }

  // Start YouTube/Kick (and Twitch fallback) polling
  _startPolling();

  console.log('✅ Stream watcher running');
  console.log(`   Polling interval: ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`   Confirmation delay: ${CONFIRMATION_DELAY_MS / 1000}s`);
}

/**
 * Stop the stream watcher gracefully.
 * Called from index.js on SIGTERM/SIGINT.
 */
function stopStreamWatcher() {
  // Close Twitch WebSocket
  _closeTwitchWebSocket();

  // Clear reconnect timer
  if (_twitchReconnectTimer) {
    clearTimeout(_twitchReconnectTimer);
    _twitchReconnectTimer = null;
  }

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
  _twitchIdCache.clear();
  _broadcasterToGuild.clear();

  _client = null;
  console.log('🛑 Stream watcher stopped');
}

/**
 * Get diagnostic info about the watcher state (for debugging).
 * @returns {object}
 */
function getStreamWatcherStatus() {
  return {
    twitch: {
      connected: _twitchWs?.readyState === WebSocket.OPEN,
      sessionId: _twitchSessionId,
      uptimeMs: _twitchConnectedAt ? Date.now() - _twitchConnectedAt : 0,
      reconnectAttempts: _twitchReconnectAttempts,
      subscribedBroadcasters: _broadcasterToGuild.size,
    },
    polling: {
      active: !!_pollInterval,
      intervalMs: POLL_INTERVAL_MS,
      confirmationDelayMs: CONFIRMATION_DELAY_MS,
    },
    streams: {
      pendingConfirmations: _confirmationTimers.size,
      activeAnnouncements: _activeWatcherStreams.size,
    },
  };
}

// ─── Twitch EventSub WebSocket ──────────────────────────────────────────────

/**
 * Open a WebSocket connection to Twitch EventSub.
 */
async function _initTwitchEventSub() {
  return new Promise((resolve, reject) => {
    console.log('🔌 Connecting to Twitch EventSub WebSocket...');

    _twitchWs = new WebSocket(TWITCH_EVENTSUB_WS_URL);

    _twitchWs.on('open', () => {
      _twitchConnectedAt = Date.now();
      _twitchReconnectAttempts = 0;
      console.log('✅ Twitch EventSub WebSocket connected');
    });

    _twitchWs.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        await _handleTwitchMessage(msg, resolve);
      } catch (err) {
        console.error('⚠️ Twitch EventSub message parse error:', err.message);
      }
    });

    _twitchWs.on('close', (code, reason) => {
      console.warn(`⚠️ Twitch EventSub WebSocket closed (code: ${code}, reason: ${reason || 'none'})`);
      _clearHeartbeatMonitor();
      _scheduleTwitchReconnect();
    });

    _twitchWs.on('error', (err) => {
      console.error('❌ Twitch EventSub WebSocket error:', err.message);
      reject(err);
    });

    // Timeout if we don't get the welcome message within 15 seconds
    setTimeout(() => {
      if (!_twitchSessionId) {
        console.warn('⚠️ Twitch EventSub: no welcome received within 15s');
        reject(new Error('EventSub welcome timeout'));
      }
    }, 15000);
  });
}

/**
 * Handle an incoming Twitch EventSub WebSocket message.
 */
async function _handleTwitchMessage(msg, resolveInit) {
  const type = msg.metadata?.message_type;

  switch (type) {
    case 'session_welcome': {
      _twitchSessionId = msg.payload.session.id;
      _twitchKeepAliveTimeoutSec = msg.payload.session.keepalive_timeout_seconds || 10;
      console.log(`🤝 Twitch EventSub session: ${_twitchSessionId} (keepalive: ${_twitchKeepAliveTimeoutSec}s)`);

      // Start monitoring keepalive
      _resetHeartbeatMonitor();

      // Subscribe to all known Twitch streamers
      await _subscribeAllTwitchChannels();

      if (resolveInit) resolveInit();
      break;
    }

    case 'session_keepalive': {
      _resetHeartbeatMonitor();
      break;
    }

    case 'notification': {
      _resetHeartbeatMonitor();
      const eventType = msg.payload.subscription?.type;
      const event = msg.payload.event;

      if (eventType === 'stream.online') {
        console.log(`📡 Twitch EventSub: ${event.broadcaster_user_login} went ONLINE`);
        await _handleTwitchStreamOnline(event);
      } else if (eventType === 'stream.offline') {
        console.log(`📡 Twitch EventSub: ${event.broadcaster_user_login} went OFFLINE`);
        await _handleTwitchStreamOffline(event);
      }
      break;
    }

    case 'session_reconnect': {
      // Twitch is asking us to reconnect to a new URL
      const newUrl = msg.payload.session.reconnect_url;
      console.log('🔄 Twitch EventSub: reconnect requested');
      _closeTwitchWebSocket();
      if (newUrl) {
        _twitchWs = new WebSocket(newUrl);
        _setupTwitchWsListeners();
      }
      break;
    }

    case 'revocation': {
      const sub = msg.payload.subscription;
      console.warn(`⚠️ Twitch EventSub subscription revoked: ${sub.type} for ${sub.condition.broadcaster_user_id} (reason: ${sub.status})`);
      // Attempt to resubscribe after a short delay
      setTimeout(() => _subscribeTwitchEvent(sub.condition.broadcaster_user_id, sub.type), 5000);
      break;
    }

    default:
      break;
  }
}

/**
 * Subscribe to stream.online and stream.offline for all known Twitch channels.
 */
async function _subscribeAllTwitchChannels() {
  if (!_client || !_twitchSessionId) return;

  // Get all Twitch links from the database across all guilds
  const links = all(
    "SELECT * FROM streaming_links WHERE platform = 'twitch'",
    []
  );

  if (!links || links.length === 0) {
    console.log('ℹ️  No Twitch links registered — nothing to subscribe to.');
    return;
  }

  let subscribed = 0;
  let failed = 0;

  for (const link of links) {
    const login = extractTwitchLogin(link.platform_handle || link.platform_url);

    // Resolve login → broadcaster ID
    let broadcasterId = _twitchIdCache.get(login);
    if (!broadcasterId) {
      broadcasterId = await resolveTwitchUserId(login);
      if (broadcasterId) {
        _twitchIdCache.set(login, broadcasterId);
      }
    }

    if (!broadcasterId) {
      console.warn(`⚠️ Could not resolve Twitch user ID for "${login}" — skipping EventSub`);
      failed++;
      continue;
    }

    // Store reverse lookup so we know which guild/user this broadcaster belongs to
    // Note: same broadcaster might be in multiple guilds — we store an array
    const existing = _broadcasterToGuild.get(broadcasterId) || [];
    existing.push({ guildId: link.guild_id, userId: link.user_id, login });
    _broadcasterToGuild.set(broadcasterId, existing);

    // Subscribe to stream.online and stream.offline
    const onlineSub = await _subscribeTwitchEvent(broadcasterId, 'stream.online');
    const offlineSub = await _subscribeTwitchEvent(broadcasterId, 'stream.offline');

    if (onlineSub && offlineSub) {
      subscribed++;
    } else {
      failed++;
    }
  }

  console.log(`📡 Twitch EventSub: ${subscribed} channel(s) subscribed${failed > 0 ? `, ${failed} failed` : ''}`);
}

/**
 * Create a single EventSub subscription via the Helix API.
 * @param {string} broadcasterId
 * @param {string} eventType - 'stream.online' or 'stream.offline'
 * @returns {Promise<boolean>}
 */
async function _subscribeTwitchEvent(broadcasterId, eventType) {
  const token = await getTwitchToken();
  if (!token || !_twitchSessionId) return false;

  const body = JSON.stringify({
    type: eventType,
    version: '1',
    condition: { broadcaster_user_id: broadcasterId },
    transport: {
      method: 'websocket',
      session_id: _twitchSessionId,
    },
  });

  const url = new URL('https://api.twitch.tv/helix/eventsub/subscriptions');

  return new Promise(resolve => {
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      timeout: 8000,
      headers: {
        'Client-ID': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 202) {
          resolve(true);
        } else if (res.statusCode === 409) {
          // Already subscribed — that's fine
          resolve(true);
        } else {
          console.warn(`⚠️ Twitch EventSub subscribe ${eventType} for ${broadcasterId}: HTTP ${res.statusCode}`);
          try {
            const err = JSON.parse(data);
            if (err.message) console.warn(`   ${err.message}`);
          } catch { /* ignore */ }
          resolve(false);
        }
      });
    });

    req.on('error', (err) => {
      console.warn(`⚠️ Twitch EventSub subscribe error: ${err.message}`);
      resolve(false);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.write(body);
    req.end();
  });
}

/**
 * Setup WebSocket listeners (used after reconnect).
 */
function _setupTwitchWsListeners() {
  if (!_twitchWs) return;

  _twitchWs.on('open', () => {
    _twitchConnectedAt = Date.now();
    _twitchReconnectAttempts = 0;
    console.log('✅ Twitch EventSub reconnected');
  });

  _twitchWs.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      await _handleTwitchMessage(msg, null);
    } catch (err) {
      console.error('⚠️ Twitch EventSub message parse error:', err.message);
    }
  });

  _twitchWs.on('close', (code) => {
    console.warn(`⚠️ Twitch EventSub closed (code: ${code})`);
    _clearHeartbeatMonitor();
    _scheduleTwitchReconnect();
  });

  _twitchWs.on('error', (err) => {
    console.error('❌ Twitch EventSub error:', err.message);
  });
}

/**
 * Handle Twitch stream.online event — enter confirmation pipeline.
 */
async function _handleTwitchStreamOnline(event) {
  const broadcasterId = event.broadcaster_user_id;
  const entries = _broadcasterToGuild.get(broadcasterId);
  if (!entries || entries.length === 0) return;

  for (const entry of entries) {
    const key = `${entry.guildId}|${entry.userId}|twitch`;
    _startConfirmation(key, entry.guildId, entry.userId, 'twitch', {
      title: event.broadcaster_user_login, // Will be enriched during re-check
    });
  }
}

/**
 * Handle Twitch stream.offline event — end announcement.
 */
async function _handleTwitchStreamOffline(event) {
  const broadcasterId = event.broadcaster_user_id;
  const entries = _broadcasterToGuild.get(broadcasterId);
  if (!entries || entries.length === 0) return;

  for (const entry of entries) {
    const key = `${entry.guildId}|${entry.userId}|twitch`;
    await _handleStreamEnd(key, entry.guildId, entry.userId);
  }
}

/**
 * Reset the keepalive heartbeat monitor.
 * If no message arrives within keepalive_timeout + 10%, reconnect.
 */
function _resetHeartbeatMonitor() {
  _clearHeartbeatMonitor();
  const timeoutMs = (_twitchKeepAliveTimeoutSec + 2) * 1000; // add 2s buffer
  _twitchHeartbeatTimer = setTimeout(() => {
    console.warn('⚠️ Twitch EventSub: keepalive timeout — reconnecting...');
    _closeTwitchWebSocket();
    _scheduleTwitchReconnect();
  }, timeoutMs);
}

function _clearHeartbeatMonitor() {
  if (_twitchHeartbeatTimer) {
    clearTimeout(_twitchHeartbeatTimer);
    _twitchHeartbeatTimer = null;
  }
}

/**
 * Close the Twitch WebSocket cleanly.
 */
function _closeTwitchWebSocket() {
  _clearHeartbeatMonitor();
  if (_twitchWs) {
    try { _twitchWs.close(); } catch { /* ignore */ }
    _twitchWs = null;
  }
  _twitchSessionId = null;
}

/**
 * Schedule a reconnection with exponential backoff.
 */
function _scheduleTwitchReconnect() {
  if (!_client) return; // shutting down, don't reconnect

  _twitchReconnectAttempts++;
  const delay = Math.min(
    TWITCH_INITIAL_RECONNECT_DELAY_MS * Math.pow(2, _twitchReconnectAttempts - 1),
    TWITCH_MAX_RECONNECT_DELAY_MS
  );

  console.log(`🔄 Twitch EventSub: reconnecting in ${delay / 1000}s (attempt ${_twitchReconnectAttempts})...`);

  _twitchReconnectTimer = setTimeout(async () => {
    _twitchReconnectTimer = null;
    try {
      // Clear old state
      _broadcasterToGuild.clear();
      _twitchIdCache.clear();
      await _initTwitchEventSub();
    } catch (err) {
      console.error('❌ Twitch EventSub reconnection failed:', err.message);
      _scheduleTwitchReconnect(); // try again
    }
  }, delay);
}

// ─── YouTube / Kick Polling ─────────────────────────────────────────────────

/**
 * Start the polling loop for YouTube and Kick (and Twitch if EventSub is unavailable).
 */
function _startPolling() {
  // Run first check immediately after a short delay (let the bot settle)
  setTimeout(() => _pollAllGuilds(), 10000);

  // Then poll on interval
  _pollInterval = setInterval(() => _pollAllGuilds(), POLL_INTERVAL_MS);
  console.log(`📡 Polling started for YouTube/Kick (every ${POLL_INTERVAL_MS / 1000}s)`);
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
 * Poll a single guild for live streams on YouTube and Kick.
 * Also polls Twitch if EventSub WebSocket is not connected.
 */
async function _pollGuild(guild) {
  const streamOwnerId = process.env.STREAM_OWNER_ID || guild.ownerId;

  // Get all streaming links for this guild's stream owner
  const links = all(
    'SELECT * FROM streaming_links WHERE guild_id = ? AND user_id = ?',
    [guild.id, streamOwnerId]
  );

  if (!links || links.length === 0) return;

  // Filter to platforms we need to poll
  const pollPlatforms = ['youtube', 'youtube-shorts', 'kick'];

  // Also poll Twitch if EventSub is not connected
  const twitchConnected = _twitchWs?.readyState === WebSocket.OPEN;
  if (!twitchConnected) {
    pollPlatforms.push('twitch');
  }

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
