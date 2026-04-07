/**
 * Stream Manager — Unified live stream detection, announcement, and lifecycle.
 *
 * Replaces the former streamAnnouncer.js (presence-based) and streamWatcher.js
 * (polling-based) with a single system that owns all streaming state.
 *
 * Detection triggers:
 *  - Polling: checks Twitch/YouTube/Kick APIs on interval
 *  - Presence: Discord presenceUpdate as a fast trigger (optional boost)
 *  - Manual: /go-live command calls announceStream() directly
 *
 * All detections flow through a confirmation pipeline:
 *   detect -> wait CONFIRMATION_DELAY -> re-check -> announce (or discard)
 *
 * Lifecycle:
 *  - One active announcement per guild (persisted to DB across restarts)
 *  - Periodic viewer count refresh on active announcements
 *  - End confirmation: poll offline -> wait -> re-check API + presence -> end
 */

const { ActivityType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { channelName, t } = require('../utils/locale');
const db = require('../utils/database');
const {
  checkTwitch,
  checkYouTube,
  checkKick,
  checkAllPlatforms,
  checkAllPlatformsCached,
  invalidatePlatformCache,
  PLATFORMS,
} = require('./streamingChecker');

// ---- Configuration --------------------------------------------------------

const POLL_INTERVAL_MS = (parseInt(process.env.STREAM_WATCHER_POLL_INTERVAL_SECONDS) || 120) * 1000;
const CONFIRMATION_DELAY_MS = (parseInt(process.env.STREAM_WATCHER_CONFIRMATION_DELAY_SECONDS) || 60) * 1000;
const END_CONFIRMATION_DELAY_MS = (parseInt(process.env.STREAM_WATCHER_END_CONFIRMATION_DELAY_SECONDS) || 60) * 1000;
const YT_POLL_INTERVAL_MS = (parseInt(process.env.STREAM_WATCHER_YT_POLL_INTERVAL_SECONDS) || 600) * 1000;
const UPDATE_INTERVAL_MS = (parseInt(process.env.STREAM_WATCHER_UPDATE_INTERVAL_SECONDS) || 150) * 1000;
const PRESENCE_END_DELAY_MS = 30000; // debounce rapid presence flickers

// ---- State ----------------------------------------------------------------

/** @type {import('discord.js').Client|null} */
let _client = null;

// Active announcements: Map<guildId, { messageId, channelId }>
// Backed by active_announcements DB table — survives restarts
const activeAnnouncements = new Map();

// Lock to prevent concurrent announcements for the same guild
const _announceLocks = new Set();

// Polling
let _pollInterval = null;
let _updateInterval = null;
let _lastYouTubePoll = 0;

// Confirmation timers: Map<"guildId|platform", timeoutId>
const _confirmationTimers = new Map();

// End-confirmation timers: Map<"guildId|platform", timeoutId>
const _endConfirmationTimers = new Map();

// Presence end debounce timers: Map<guildId, timeoutId>
const _presenceEndTimers = new Map();

// Previous poll state for detecting transitions: Map<"guildId|platform", boolean>
const _previousPollState = new Map();

// First poll flag — skip transitions on first cycle to avoid false positives
let _firstPoll = true;

// ---- Startup / Shutdown ---------------------------------------------------

/**
 * Start the unified stream manager.
 * Called from ready.js after the Discord client is fully connected.
 * @param {import('discord.js').Client} client
 */
async function startStreamManager(client) {
  if (process.env.STREAMING_ENABLED === 'false') {
    console.log('⏭️  Stream manager disabled (STREAMING_ENABLED=false)');
    return;
  }

  _client = client;
  console.log('\n📡 Starting stream manager...');

  // Load persisted announcements from DB
  _loadActiveAnnouncements();

  // Start polling for all platforms
  setTimeout(() => _pollAllGuilds(), 10000);
  _pollInterval = setInterval(() => _pollAllGuilds(), POLL_INTERVAL_MS);

  // Start periodic announcement updates (viewer count refresh)
  _updateInterval = setInterval(() => _updateActiveAnnouncements(), UPDATE_INTERVAL_MS);

  console.log('✅ Stream manager running');
  console.log(`   Polling interval: ${POLL_INTERVAL_MS / 1000}s (Twitch/Kick), ${YT_POLL_INTERVAL_MS / 1000}s (YouTube)`);
  console.log(`   Confirmation delay: ${CONFIRMATION_DELAY_MS / 1000}s`);
  console.log(`   Announcement update interval: ${UPDATE_INTERVAL_MS / 1000}s`);
}

/**
 * Stop the stream manager gracefully.
 * Called from index.js on SIGTERM/SIGINT.
 */
function stopStreamManager() {
  if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
  if (_updateInterval) { clearInterval(_updateInterval); _updateInterval = null; }

  for (const timerId of _confirmationTimers.values()) clearTimeout(timerId);
  _confirmationTimers.clear();

  for (const timerId of _endConfirmationTimers.values()) clearTimeout(timerId);
  _endConfirmationTimers.clear();

  for (const timerId of _presenceEndTimers.values()) clearTimeout(timerId);
  _presenceEndTimers.clear();

  _previousPollState.clear();
  _firstPoll = true;
  _client = null;
  console.log('🛑 Stream manager stopped');
}

// ---- DB persistence -------------------------------------------------------

function _loadActiveAnnouncements() {
  const rows = db.all('SELECT guild_id, message_id, channel_id FROM active_announcements');
  if (rows) {
    for (const row of rows) {
      activeAnnouncements.set(row.guild_id, { messageId: row.message_id, channelId: row.channel_id });
    }
    if (rows.length > 0) console.log(`📢 Loaded ${rows.length} persisted stream announcement(s)`);
  }
}

function _persistAnnouncement(guildId, messageId, channelId) {
  db.run(
    'INSERT OR REPLACE INTO active_announcements (guild_id, message_id, channel_id) VALUES (?, ?, ?)',
    [guildId, messageId, channelId]
  );
}

function _removePersistedAnnouncement(guildId) {
  db.run('DELETE FROM active_announcements WHERE guild_id = ?', [guildId]);
}

// ---- Channel resolution ---------------------------------------------------

/**
 * Find the stream-announcements channel for a guild (locale-aware).
 * @param {import('discord.js').Guild} guild
 * @returns {import('discord.js').TextChannel|null}
 */
function findAnnouncementChannel(guild) {
  const localeName = channelName('stream-announcements', guild.id);
  const candidates = [localeName, 'stream-announcements', 'yayın-duyuru'];

  for (const name of candidates) {
    const ch = guild.channels.cache.find(
      c => c.name === name && c.isTextBased() && !c.isThread()
    );
    if (ch) return ch;
  }
  return null;
}

// ---- Template / embed building --------------------------------------------

function _detectPlatform(url) {
  if (!url) return 'Stream';
  if (url.includes('twitch.tv')) return 'Twitch';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'YouTube';
  if (url.includes('kick.com')) return 'Kick';
  return 'Stream';
}

function _findCustomTemplate(guildId, templateName) {
  const record = db.get(
    "SELECT content FROM bot_messages WHERE guild_id = ? AND message_type = 'stream-announcement' AND created_by = 'default' AND name LIKE ? ORDER BY updated_at DESC LIMIT 1",
    [guildId, `%${templateName}%`]
  );
  if (!record) return null;
  try {
    return typeof record.content === 'string' ? JSON.parse(record.content) : record.content;
  } catch {
    return null;
  }
}

function _replacePlaceholders(text, vars) {
  if (!text) return text;
  return text
    .replace(/\{user\}/gi, vars.user || '')
    .replace(/\{platform\}/gi, vars.platform || '')
    .replace(/\{game\}/gi, vars.game || '')
    .replace(/\{title\}/gi, vars.title || '')
    .replace(/\{stream_title\}/gi, vars.stream_title || '')
    .replace(/\{url\}/gi, vars.url || '')
    .replace(/\{viewers\}/gi, vars.viewers || '')
    .replace(/\{platforms_status\}/gi, vars.platforms_status || '');
}

/**
 * Build the announcement embed + button rows from platform results.
 *
 * @param {import('discord.js').GuildMember} member - The stream owner member
 * @param {string} guildId
 * @param {Array} platformResults - Results from checkAllPlatforms
 * @returns {{ embeds: Array, components: Array, content: string }}
 */
function _buildAnnouncementMessage(member, guildId, platformResults) {
  const userName = member.displayName || member.user.username;
  const ownerAvatar = member.user.displayAvatarURL({ dynamic: true, size: 256 });

  // Build per-platform status lines
  let platformsStatus = '';
  let streamTitle = '';
  const allButtons = [];

  if (platformResults.length > 0) {
    const statusLines = platformResults.map(r => {
      if (r.isLive) {
        const viewerStr = r.viewers > 0 ? ` • 👥 ${r.viewers}` : '';
        return `${r.emoji} **${r.label}** — 🔴 LIVE${viewerStr}`;
      } else if (PLATFORMS[r.platform]?.canDetectLive) {
        return `${r.emoji} **${r.label}** — ⚫ ${t('streaming.offline', {}, guildId) || 'Offline'}`;
      } else {
        return `${r.emoji} **${r.label}**`;
      }
    });
    platformsStatus = statusLines.join('\n');

    const mainLive = platformResults.find(r => r.isLive && r.title);
    if (mainLive?.title) streamTitle = mainLive.title;

    for (const r of platformResults) {
      allButtons.push(
        new ButtonBuilder()
          .setLabel(r.isLive ? `🔴 ${r.label}` : r.label)
          .setStyle(ButtonStyle.Link)
          .setURL(r.isLive ? r.liveUrl : r.url)
          .setEmoji(r.emoji)
      );
    }
  }

  const mainLiveResult = platformResults.find(r => r.isLive);
  const vars = {
    user: userName,
    platform: _detectPlatform(mainLiveResult?.url || ''),
    game: '',
    title: streamTitle,
    url: mainLiveResult?.liveUrl || mainLiveResult?.url || '',
    stream_title: streamTitle,
    viewers: mainLiveResult?.viewers?.toString() || '',
    platforms_status: platformsStatus,
  };

  // Check for custom template from dashboard
  const customTemplate = _findCustomTemplate(guildId, 'Live');

  let embed;
  if (customTemplate) {
    embed = new EmbedBuilder()
      .setColor(customTemplate.color?.startsWith('#') ? parseInt(customTemplate.color.replace('#', ''), 16) : 0xFF0000)
      .setThumbnail(ownerAvatar)
      .setTimestamp();

    if (customTemplate.author) {
      embed.setAuthor({ name: _replacePlaceholders(customTemplate.author, vars), iconURL: ownerAvatar });
    }
    if (customTemplate.title) embed.setTitle(_replacePlaceholders(customTemplate.title, vars));
    if (customTemplate.description) embed.setDescription(_replacePlaceholders(customTemplate.description, vars));
    if (customTemplate.footer) embed.setFooter({ text: _replacePlaceholders(customTemplate.footer, vars) });
    if (customTemplate.thumbnail) embed.setThumbnail(customTemplate.thumbnail);

    if (Array.isArray(customTemplate.fields)) {
      for (const field of customTemplate.fields) {
        if (field.name && field.value) {
          embed.addFields({
            name: _replacePlaceholders(field.name, vars),
            value: _replacePlaceholders(field.value, vars) || '-',
            inline: !!field.inline,
          });
        }
      }
    }
  } else {
    embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setAuthor({ name: `${userName} ${t('streaming.isLiveNow', {}, guildId) || 'is LIVE!'}`, iconURL: ownerAvatar })
      .setThumbnail(ownerAvatar)
      .setTimestamp();

    if (streamTitle) embed.setTitle(`📺 ${streamTitle}`);
    embed.setDescription(t('streaming.goLiveDesc', { user: userName }, guildId) || `**${userName}** is now live! Come watch and show your support!`);

    if (platformsStatus) {
      embed.addFields({ name: t('streaming.platformStatus', {}, guildId) || 'Platform Status', value: platformsStatus, inline: false });
    }
  }

  // Build button rows (max 5 per row)
  const components = [];
  for (let i = 0; i < allButtons.length; i += 5) {
    components.push(new ActionRowBuilder().addComponents(...allButtons.slice(i, i + 5)));
  }

  const content = `🔴 **${userName}** ${t('streaming.isLiveNow', {}, guildId) || 'is LIVE!'}`;

  return { embeds: [embed], components, content };
}

// ---- Announcement lifecycle -----------------------------------------------

/**
 * Announce a stream for a guild. Single entry point for all triggers.
 * Checks platforms, builds embed, sends or updates announcement.
 *
 * @param {import('discord.js').Guild} guild
 * @param {object} [options]
 * @param {Array} [options.platformResults] - Pre-fetched results (skips API call)
 * @returns {Promise<import('discord.js').Message|null>}
 */
async function announceStream(guild, options = {}) {
  // Synchronous lock to prevent concurrent announcements
  if (_announceLocks.has(guild.id)) return null;
  _announceLocks.add(guild.id);

  try {
    const channel = findAnnouncementChannel(guild);
    if (!channel) return null;

    const ownerId = process.env.STREAM_OWNER_ID || guild.ownerId;
    let member;
    try {
      member = await guild.members.fetch(ownerId);
    } catch {
      return null;
    }

    // Get platform results
    let platformResults = options.platformResults;
    if (!platformResults) {
      const links = db.all(
        'SELECT * FROM streaming_links WHERE guild_id = ? AND user_id = ?',
        [guild.id, ownerId]
      );
      if (!links || links.length === 0) return null;

      invalidatePlatformCache(guild.id);
      platformResults = await checkAllPlatforms(links);
    }

    const { embeds, components, content } = _buildAnnouncementMessage(member, guild.id, platformResults);

    // Check for existing announcement to update
    const existing = activeAnnouncements.get(guild.id);
    if (existing) {
      try {
        const existingChannel = guild.channels.cache.get(existing.channelId);
        if (existingChannel) {
          const existingMsg = await existingChannel.messages.fetch(existing.messageId).catch(() => null);
          if (existingMsg) {
            await existingMsg.edit({ embeds, components });
            console.log(`🔄 Stream announcement updated for ${guild.name}`);
            return existingMsg;
          }
        }
      } catch {
        // Existing message not found — send new one below
      }
    }

    // Lock channel permissions: bot + guild owner only
    try {
      await channel.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: false, ViewChannel: true, ReadMessageHistory: true,
      }, { reason: 'Stream announcements — locked' });
      await channel.permissionOverwrites.edit(guild.ownerId, {
        SendMessages: true,
      }, { reason: 'Stream announcements — allow owner' });
      await channel.permissionOverwrites.edit(guild.members.me, {
        SendMessages: true, EmbedLinks: true,
      }, { reason: 'Stream announcements — allow bot' });
    } catch (err) {
      console.warn('Could not enforce announcement channel permissions:', err.message);
    }

    // Send new announcement
    const msg = await channel.send({ content, embeds, components });

    activeAnnouncements.set(guild.id, { messageId: msg.id, channelId: channel.id });
    _persistAnnouncement(guild.id, msg.id, channel.id);

    console.log(`🔴 Stream announcement posted for ${member.user.tag} in ${guild.name}`);
    return msg;
  } catch (err) {
    console.error(`Stream announcement failed in ${guild.name}:`, err.message);
    return null;
  } finally {
    _announceLocks.delete(guild.id);
  }
}

/**
 * End a stream for a guild — remove from tracking.
 * @param {string} guildId
 */
function _endStream(guildId) {
  if (!activeAnnouncements.has(guildId)) return;

  activeAnnouncements.delete(guildId);
  _removePersistedAnnouncement(guildId);
  console.log(`⚫ Stream ended for guild ${guildId}`);
}

/**
 * Get the active announcement for a guild (if any).
 * @param {string} guildId
 * @returns {{ messageId: string, channelId: string }|undefined}
 */
function getActiveAnnouncement(guildId) {
  return activeAnnouncements.get(guildId);
}

// ---- Presence handling (fast trigger) -------------------------------------

/**
 * Handle a presence update — detect streaming start/stop for the guild owner.
 * Acts as a fast trigger: if owner goes live in Discord, immediately runs
 * platform check + announce instead of waiting for next poll cycle.
 *
 * @param {import('discord.js').Presence|null} oldPresence
 * @param {import('discord.js').Presence} newPresence
 */
async function handlePresenceUpdate(oldPresence, newPresence) {
  if (!newPresence.guild) return;

  const guild = newPresence.guild;
  const member = newPresence.member;
  if (!member) return;

  // Only track the guild owner (or STREAM_OWNER_ID)
  const streamOwnerId = process.env.STREAM_OWNER_ID || guild.ownerId;
  if (member.id !== streamOwnerId) return;

  const wasStreaming = oldPresence?.activities?.some(a => a.type === ActivityType.Streaming);
  const isStreaming = newPresence.activities?.some(a => a.type === ActivityType.Streaming);

  if (!wasStreaming && isStreaming) {
    // Owner just went live — cancel any pending end timer
    const pendingTimer = _presenceEndTimers.get(guild.id);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      _presenceEndTimers.delete(guild.id);
    }

    // If we already have an active announcement, skip
    if (activeAnnouncements.has(guild.id)) return;

    // Fast trigger: immediately check platforms and announce
    console.log(`📡 Presence detected: streaming started for ${member.user.tag} in ${guild.name}`);
    const links = db.all(
      'SELECT * FROM streaming_links WHERE guild_id = ? AND user_id = ?',
      [guild.id, streamOwnerId]
    );
    if (!links || links.length === 0) return;

    const platformResults = await checkAllPlatforms(links);
    await announceStream(guild, { platformResults });

  } else if (wasStreaming && !isStreaming) {
    // Owner stopped streaming — debounce to avoid flickers
    const pendingTimer = _presenceEndTimers.get(guild.id);
    if (pendingTimer) clearTimeout(pendingTimer);

    _presenceEndTimers.set(guild.id, setTimeout(async () => {
      _presenceEndTimers.delete(guild.id);

      // Double-check they're really not streaming anymore
      try {
        const freshMember = await guild.members.fetch(member.id);
        const stillStreaming = freshMember.presence?.activities?.some(a => a.type === ActivityType.Streaming);
        if (stillStreaming) return;
      } catch { /* member fetch failed — continue with platform cross-check */ }

      // Cross-check: ask platform APIs if stream is actually still live
      const links = db.all(
        'SELECT * FROM streaming_links WHERE guild_id = ? AND user_id = ?',
        [guild.id, streamOwnerId]
      );
      if (links && links.length > 0) {
        const results = await checkAllPlatforms(links);
        const anyLive = results.some(r => r.isLive);
        if (anyLive) {
          console.log(`❌ Presence ended but platform API still live — skipping stream end for ${guild.name}`);
          return;
        }
      }

      _endStream(guild.id);
    }, PRESENCE_END_DELAY_MS));
  }
}

// ---- Polling --------------------------------------------------------------

async function _pollAllGuilds() {
  if (!_client) return;

  for (const guild of _client.guilds.cache.values()) {
    try {
      await _pollGuild(guild);
    } catch (err) {
      console.error(`⚠️ Polling error for ${guild.name}: ${err.message}`);
    }
  }

  if (_firstPoll) {
    _firstPoll = false;
    console.log('📡 First poll complete — state seeded, transitions active from next cycle');
  }
}

async function _pollGuild(guild) {
  const streamOwnerId = process.env.STREAM_OWNER_ID || guild.ownerId;

  const links = db.all(
    'SELECT * FROM streaming_links WHERE guild_id = ? AND user_id = ?',
    [guild.id, streamOwnerId]
  );
  if (!links || links.length === 0) return;

  const pollPlatforms = ['twitch', 'youtube', 'youtube-shorts', 'kick'];
  const pollableLinks = links.filter(l => pollPlatforms.includes(l.platform));
  if (pollableLinks.length === 0) return;

  const now = Date.now();
  const ytDue = (now - _lastYouTubePoll) >= YT_POLL_INTERVAL_MS;
  if (ytDue) _lastYouTubePoll = now;

  for (const link of pollableLinks) {
    if ((link.platform === 'youtube' || link.platform === 'youtube-shorts') && !ytDue) continue;

    try {
      const result = await _checkSinglePlatform(link);
      const key = `${guild.id}|${link.platform}`;
      const wasLive = _previousPollState.get(key) || false;

      if (_firstPoll) {
        _previousPollState.set(key, result.isLive);
        continue;
      }

      _previousPollState.set(key, result.isLive);

      if (!wasLive && result.isLive) {
        // Transition: offline -> online
        console.log(`📡 Polling detected: ${link.platform} went LIVE for ${guild.name}`);

        // Cancel any pending end-confirmation
        const endTimer = _endConfirmationTimers.get(key);
        if (endTimer) {
          clearTimeout(endTimer);
          _endConfirmationTimers.delete(key);
        }

        _startConfirmation(key, guild, link);
      } else if (wasLive && !result.isLive) {
        if (result.error) {
          console.log(`⚠️ API error for ${link.platform} in ${guild.name} — ignoring offline transition`);
          _previousPollState.set(key, true);
          continue;
        }

        // Transition: online -> offline
        console.log(`📡 Polling detected: ${link.platform} went OFFLINE for ${guild.name}`);
        _startEndConfirmation(key, guild, link);
      }
    } catch (err) {
      console.warn(`⚠️ Poll check failed for ${link.platform} in ${guild.name}: ${err.message}`);
    }
  }
}

async function _checkSinglePlatform(link) {
  const handle = link.platform_handle || link.platform_url;
  switch (link.platform) {
    case 'twitch': return checkTwitch(handle);
    case 'youtube':
    case 'youtube-shorts': return checkYouTube(handle, link.platform);
    case 'kick': return checkKick(handle);
    default: return { isLive: false, title: '', viewers: 0, url: link.platform_url };
  }
}

// ---- Confirmation pipeline ------------------------------------------------

function _startConfirmation(key, guild, link) {
  if (_confirmationTimers.has(key)) return;
  if (activeAnnouncements.has(guild.id)) return;

  console.log(`⏳ Confirmation started: ${link.platform} for ${guild.name} (waiting ${CONFIRMATION_DELAY_MS / 1000}s)`);

  const timer = setTimeout(async () => {
    _confirmationTimers.delete(key);

    try {
      const result = await _checkSinglePlatform(link);
      if (!result.isLive) {
        console.log(`❌ Confirmation failed: ${link.platform} no longer live for ${guild.name}`);
        return;
      }

      // Still live — announce if no other announcement exists
      if (activeAnnouncements.has(guild.id)) {
        console.log(`ℹ️  Skipping: announcement already active for ${guild.name}`);
        return;
      }

      console.log(`✅ Confirmation passed: ${link.platform} confirmed live for ${guild.name}`);
      await announceStream(guild);
    } catch (err) {
      console.error(`⚠️ Confirmation check failed for ${key}: ${err.message}`);
    }
  }, CONFIRMATION_DELAY_MS);

  _confirmationTimers.set(key, timer);
}

function _startEndConfirmation(key, guild, link) {
  if (_endConfirmationTimers.has(key)) return;

  console.log(`⏳ End confirmation started: ${link.platform} for ${guild.name} (waiting ${END_CONFIRMATION_DELAY_MS / 1000}s)`);

  const timer = setTimeout(async () => {
    _endConfirmationTimers.delete(key);

    try {
      const result = await _checkSinglePlatform(link);

      if (result.isLive) {
        console.log(`❌ End confirmation failed: ${link.platform} is back LIVE for ${guild.name}`);
        _previousPollState.set(key, true);
        return;
      }

      if (result.error) {
        console.log(`⚠️ End confirmation inconclusive (API error) for ${link.platform} — aborting end`);
        return;
      }

      // Cross-check: is Discord presence still showing streaming?
      if (_client) {
        const streamOwnerId = process.env.STREAM_OWNER_ID || guild.ownerId;
        try {
          const member = await guild.members.fetch(streamOwnerId);
          const stillStreaming = member.presence?.activities?.some(
            a => a.type === ActivityType.Streaming
          );
          if (stillStreaming) {
            console.log(`❌ End confirmation blocked: Discord presence still streaming for ${guild.name}`);
            _previousPollState.set(key, true);
            return;
          }
        } catch { /* member fetch failed — proceed with end */ }
      }

      // Check if ALL platforms are offline before ending (not just this one)
      const allPlatformKeys = [..._previousPollState.keys()].filter(k => k.startsWith(`${guild.id}|`));
      const anyOtherLive = allPlatformKeys.some(k => k !== key && _previousPollState.get(k));
      if (anyOtherLive) {
        console.log(`ℹ️  ${link.platform} offline but other platforms still live for ${guild.name} — skipping end`);
        return;
      }

      console.log(`✅ End confirmation passed: all platforms confirmed offline for ${guild.name}`);
      _endStream(guild.id);
    } catch (err) {
      console.error(`⚠️ End confirmation check failed for ${key}: ${err.message}`);
    }
  }, END_CONFIRMATION_DELAY_MS);

  _endConfirmationTimers.set(key, timer);
}

// ---- Announcement updates (viewer count refresh) --------------------------

async function _updateActiveAnnouncements() {
  if (!_client) return;
  if (activeAnnouncements.size === 0) return;

  for (const [guildId, announcement] of activeAnnouncements.entries()) {
    try {
      const guild = _client.guilds.cache.get(guildId);
      if (!guild) continue;

      const channel = guild.channels.cache.get(announcement.channelId);
      if (!channel) continue;

      const msg = await channel.messages.fetch(announcement.messageId).catch(() => null);
      if (!msg) continue;

      const ownerId = process.env.STREAM_OWNER_ID || guild.ownerId;
      let member;
      try {
        member = await guild.members.fetch(ownerId);
      } catch { continue; }

      // Fetch fresh platform data
      const links = db.all(
        'SELECT * FROM streaming_links WHERE guild_id = ? AND user_id = ?',
        [guildId, ownerId]
      );
      if (!links || links.length === 0) continue;

      const platformResults = await checkAllPlatformsCached(links, guildId);
      const { embeds, components } = _buildAnnouncementMessage(member, guildId, platformResults);

      // Edit only embeds + components — don't touch content to avoid re-pinging
      await msg.edit({ embeds, components });
      console.log(`🔄 Announcement updated with fresh viewer counts for ${guild.name}`);
    } catch (err) {
      console.warn(`⚠️ Failed to update announcement for guild ${guildId}: ${err.message}`);
    }
  }
}

// ---- Exports --------------------------------------------------------------

module.exports = {
  startStreamManager,
  stopStreamManager,
  handlePresenceUpdate,
  announceStream,
  getActiveAnnouncement,
  findAnnouncementChannel,
  // Exposed for web dashboard direct access
  activeAnnouncements,
  _persistAnnouncement,
};
