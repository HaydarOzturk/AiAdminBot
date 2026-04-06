/**
 * Stream Announcer — Detects when the guild owner goes live and posts
 * an announcement in the stream-announcements channel.
 *
 * How it works:
 *  1. Listens to presenceUpdate events for the guild owner
 *  2. When a Streaming activity appears → post a rich embed with a "Watch Now" link button
 *  3. When the Streaming activity disappears → edit the embed to "Stream ended"
 *  4. Prevents duplicate announcements per guild (one active announcement at a time)
 *
 * The stream-announcements channel is found by its locale-aware name
 * (set up in serverSetup.js with the channelNames key "stream-announcements").
 */

const { ActivityType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { channelName, t } = require('../utils/locale');
const { createEmbed } = require('../utils/embedBuilder');
const db = require('../utils/database');

// Track active stream announcements: Map<guildId, { messageId, channelId }>
const activeAnnouncements = new Map();

// Lock to prevent concurrent announcements for the same guild: Set<guildId>
const _announceLocks = new Set();

// Debounce rapid presence flickers: Map<guildId, timeoutId>
const pendingEndTimers = new Map();

// Delay before marking a stream as ended (ms) — avoids flickers
const END_DELAY = 30000; // 30 seconds

/**
 * Find the stream-announcements channel for a guild (locale-aware).
 * @param {import('discord.js').Guild} guild
 * @returns {import('discord.js').TextChannel|null}
 */
function findAnnouncementChannel(guild) {
  const localeName = channelName('stream-announcements', guild.id);

  // Try locale name first, then fallback patterns
  const candidates = [localeName, 'stream-announcements', 'yayın-duyuru'];

  for (const name of candidates) {
    const ch = guild.channels.cache.find(
      c => c.name === name && c.isTextBased() && !c.isThread()
    );
    if (ch) return ch;
  }

  return null;
}

/**
 * Detect the streaming platform from a stream URL.
 * @param {string} url
 * @returns {string}
 */
function detectPlatform(url) {
  if (!url) return 'Stream';
  if (url.includes('twitch.tv')) return 'Twitch';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'YouTube';
  if (url.includes('kick.com')) return 'Kick';
  return 'Stream';
}

/**
 * Find a saved stream announcement template from bot_messages DB.
 * @param {string} guildId
 * @param {string} templateName - e.g. 'Stream Announcement (Live)' or 'Stream Ended'
 * @returns {object|null} Parsed content object or null
 */
function findCustomTemplate(guildId, templateName) {
  // Look for a saved default template by name and type
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

/**
 * Replace template placeholders with actual stream data.
 */
function replacePlaceholders(text, vars) {
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
 * Build the "LIVE" announcement embed + button row.
 * Fetches ALL platform data (like /go-live) for rich per-platform status.
 */
async function buildLiveMessage(member, streamActivity, guildId) {
  const url = streamActivity.url || '';
  const platform = detectPlatform(url);
  const game = streamActivity.state || streamActivity.details || '-';
  const title = streamActivity.details || streamActivity.name || 'Live Stream';
  const userName = member.displayName || member.user.username;
  const ownerAvatar = member.user.displayAvatarURL({ dynamic: true, size: 256 });

  // Fetch ALL platform data (same as /go-live)
  const { checkAllPlatforms, PLATFORMS } = require('./streamingChecker');
  const ownerId = process.env.STREAM_OWNER_ID || member.guild.ownerId;
  const links = db.all(
    'SELECT * FROM streaming_links WHERE guild_id = ? AND user_id = ?',
    [guildId, ownerId]
  );

  let platformResults = [];
  let platformsStatus = '';
  let streamTitle = title;
  let allButtons = [];

  if (links && links.length > 0) {
    try {
      platformResults = await checkAllPlatforms(links);

      // Build per-platform status lines (same as go-live lines 140-149)
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

      // Get stream title from main live platform
      const mainLive = platformResults.find(r => r.isLive && r.title);
      if (mainLive?.title) streamTitle = mainLive.title;

      // Build buttons (one per platform)
      allButtons = platformResults.map(r =>
        new ButtonBuilder()
          .setLabel(r.isLive ? `🔴 ${r.label}` : r.label)
          .setStyle(ButtonStyle.Link)
          .setURL(r.isLive ? r.liveUrl : r.url)
          .setEmoji(r.emoji)
      );
    } catch (err) {
      console.warn('Failed to fetch platform data for announcement:', err.message);
    }
  }

  // Build vars with compound placeholders
  const vars = {
    user: userName, platform, game, title, url,
    stream_title: streamTitle,
    viewers: platformResults.find(r => r.isLive)?.viewers?.toString() || '',
    platforms_status: platformsStatus,
  };

  // Check for custom template from dashboard
  const customTemplate = findCustomTemplate(guildId, 'Live');

  let embed;
  if (customTemplate) {
    embed = new EmbedBuilder()
      .setColor(customTemplate.color?.startsWith('#') ? parseInt(customTemplate.color.replace('#', ''), 16) : 0xFF0000)
      .setThumbnail(ownerAvatar)
      .setTimestamp();

    // Author line (matching go-live format)
    if (customTemplate.author) {
      embed.setAuthor({ name: replacePlaceholders(customTemplate.author, vars), iconURL: ownerAvatar });
    }
    if (customTemplate.title) embed.setTitle(replacePlaceholders(customTemplate.title, vars));
    if (customTemplate.description) embed.setDescription(replacePlaceholders(customTemplate.description, vars));
    if (customTemplate.footer) embed.setFooter({ text: replacePlaceholders(customTemplate.footer, vars) });
    if (customTemplate.thumbnail) embed.setThumbnail(customTemplate.thumbnail);

    if (Array.isArray(customTemplate.fields)) {
      for (const field of customTemplate.fields) {
        if (field.name && field.value) {
          embed.addFields({
            name: replacePlaceholders(field.name, vars),
            value: replacePlaceholders(field.value, vars) || '-',
            inline: !!field.inline,
          });
        }
      }
    }
  } else {
    // Default: go-live format using locale
    embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setAuthor({ name: `${userName} ${t('streaming.isLiveNow', {}, guildId) || 'şu anda YAYINDA!'}`, iconURL: ownerAvatar })
      .setThumbnail(ownerAvatar)
      .setTimestamp();

    if (streamTitle) embed.setTitle(`📺 ${streamTitle}`);
    embed.setDescription(t('streaming.goLiveDesc', { user: userName }, guildId) || `**${userName}** şu anda yayında! Gel izle ve destek ol!`);

    if (platformsStatus) {
      embed.addFields({ name: t('streaming.platformStatus', {}, guildId) || 'Platform Durumu', value: platformsStatus, inline: false });
    }
  }

  if (streamActivity.assets?.largeImage) {
    const imgUrl = streamActivity.assets.largeImageURL?.({ size: 512 });
    if (imgUrl) embed.setImage(imgUrl);
  }

  // Build button rows
  const components = [];
  if (allButtons.length > 0) {
    for (let i = 0; i < allButtons.length; i += 5) {
      components.push(new ActionRowBuilder().addComponents(...allButtons.slice(i, i + 5)));
    }
  } else if (url) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel(t('streaming.watchNow', {}, guildId))
        .setStyle(ButtonStyle.Link)
        .setURL(url)
        .setEmoji('📺')
    ));
  }

  return { embeds: [embed], components };
}

/**
 * Handle a presence update — detect streaming start/stop for guild owners.
 * @param {import('discord.js').Presence|null} oldPresence
 * @param {import('discord.js').Presence} newPresence
 */
async function handlePresenceUpdate(oldPresence, newPresence) {
  // Only process guild presences
  if (!newPresence.guild) return;

  const guild = newPresence.guild;
  const member = newPresence.member;
  if (!member) return;

  // Only track the guild owner
  if (member.id !== guild.ownerId) return;

  const wasStreaming = oldPresence?.activities?.some(a => a.type === ActivityType.Streaming);
  const isStreaming = newPresence.activities?.some(a => a.type === ActivityType.Streaming);

  if (!wasStreaming && isStreaming) {
    // Owner just went live — cancel any pending "end" timer
    const pendingTimer = pendingEndTimers.get(guild.id);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingEndTimers.delete(guild.id);
    }

    // If we already have an active announcement, don't post another
    if (activeAnnouncements.has(guild.id)) return;

    await announceStreamStart(guild, member, newPresence);
  } else if (wasStreaming && !isStreaming) {
    // Owner stopped streaming — delay to avoid flickers
    const pendingTimer = pendingEndTimers.get(guild.id);
    if (pendingTimer) clearTimeout(pendingTimer);

    pendingEndTimers.set(guild.id, setTimeout(async () => {
      pendingEndTimers.delete(guild.id);

      // Double-check they're really not streaming anymore
      try {
        const freshMember = await guild.members.fetch(member.id);
        const stillStreaming = freshMember.presence?.activities?.some(a => a.type === ActivityType.Streaming);
        if (stillStreaming) return;
      } catch { /* member fetch failed — continue with platform cross-check */ }

      // Cross-check: ask platform APIs if stream is actually still live
      const { checkAllPlatforms } = require('./streamingChecker');
      const ownerId = process.env.STREAM_OWNER_ID || guild.ownerId;
      const links = db.all(
        'SELECT * FROM streaming_links WHERE guild_id = ? AND user_id = ?',
        [guild.id, ownerId]
      );

      if (links && links.length > 0) {
        const results = await checkAllPlatforms(links);
        const anyLive = results.some(r => r.isLive);
        if (anyLive) {
          console.log(`❌ Presence ended but platform API still live — skipping stream end for ${guild.name}`);
          return;
        }
      }

      await announceStreamEnd(guild, member);
    }, END_DELAY));
  }
}

/**
 * Post a stream-start announcement.
 *
 * Accepts EITHER a Discord Presence object (from presenceUpdate events)
 * OR a streamInfo object (from streamWatcher) with shape:
 *   { url, title, game?, viewers?, platform? }
 *
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').GuildMember} member
 * @param {import('discord.js').Presence|object} presenceOrStreamInfo
 * @returns {Promise<import('discord.js').Message|null>} The sent message, or null
 */
async function announceStreamStart(guild, member, presenceOrStreamInfo) {
  try {
    // Synchronous lock to prevent concurrent announcements for the same guild
    // (multiple platforms can detect "live" at the same time and race here)
    if (_announceLocks.has(guild.id)) return null;
    if (activeAnnouncements.has(guild.id)) return null;
    _announceLocks.add(guild.id);

    const channel = findAnnouncementChannel(guild);
    if (!channel) { _announceLocks.delete(guild.id); return null; }

    let streamActivity;

    // If it has .activities, it's a Discord Presence object
    if (presenceOrStreamInfo?.activities) {
      streamActivity = presenceOrStreamInfo.activities.find(a => a.type === ActivityType.Streaming);
      if (!streamActivity) return null;
    } else {
      // It's a streamInfo object from streamWatcher — adapt to the shape buildLiveMessage expects
      const info = presenceOrStreamInfo;
      streamActivity = {
        url: info.url || '',
        state: info.game || '',
        details: info.title || '',
        name: info.platform || 'Live Stream',
        assets: null,
      };
    }

    const messagePayload = await buildLiveMessage(member, streamActivity, guild.id);

    const msg = await channel.send(messagePayload);

    activeAnnouncements.set(guild.id, {
      messageId: msg.id,
      channelId: channel.id,
    });

    _announceLocks.delete(guild.id);
    console.log(`🔴 Stream announcement posted for ${member.user.tag} in ${guild.name}`);
    return msg;
  } catch (err) {
    _announceLocks.delete(guild.id);
    console.error(`Stream announcement failed in ${guild.name}:`, err.message);
    return null;
  }
}

/**
 * Edit the existing announcement to show "stream ended".
 */
async function announceStreamEnd(guild, member) {
  const announcement = activeAnnouncements.get(guild.id);
  if (!announcement) return;

  activeAnnouncements.delete(guild.id);
  console.log(`⚫ Stream ended for ${member.user.tag} in ${guild.name}`);
}

/**
 * Cleanup all pending timers (call on graceful shutdown)
 */
function cleanup() {
  for (const timerId of pendingEndTimers.values()) {
    clearTimeout(timerId);
  }
  pendingEndTimers.clear();
}

module.exports = {
  handlePresenceUpdate,
  findAnnouncementChannel,
  activeAnnouncements,
  cleanup,
  // Reusable building blocks for streamWatcher.js
  buildLiveMessage,
  detectPlatform,
  announceStreamStart,
  announceStreamEnd,
};
