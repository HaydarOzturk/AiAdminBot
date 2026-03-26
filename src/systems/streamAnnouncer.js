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

// Track active stream announcements: Map<guildId, { messageId, channelId }>
const activeAnnouncements = new Map();

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
 * Build the "LIVE" announcement embed + button row.
 * @param {import('discord.js').GuildMember} member
 * @param {object} streamActivity - The Streaming activity object
 * @param {string} guildId
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
function buildLiveMessage(member, streamActivity, guildId) {
  const url = streamActivity.url || '';
  const platform = detectPlatform(url);
  const game = streamActivity.state || streamActivity.details || '-';
  const title = streamActivity.details || streamActivity.name || 'Live Stream';
  const userName = member.displayName || member.user.username;

  const embed = new EmbedBuilder()
    .setColor(0xFF0000) // Red for LIVE
    .setTitle(t('streaming.liveTitle', { user: userName }, guildId))
    .setDescription(
      t('streaming.liveDescription', {
        user: userName,
        platform,
        game,
        title,
      }, guildId)
    )
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setTimestamp();

  if (streamActivity.assets?.largeImage) {
    // Discord streaming activities sometimes include a large image
    const imgUrl = streamActivity.assets.largeImageURL?.({ size: 512 });
    if (imgUrl) embed.setImage(imgUrl);
  }

  const components = [];

  if (url) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel(t('streaming.watchNow', {}, guildId))
        .setStyle(ButtonStyle.Link)
        .setURL(url)
        .setEmoji('📺')
    );
    components.push(row);
  }

  return { embeds: [embed], components };
}

/**
 * Build the "stream ended" embed (edits the existing announcement).
 * @param {import('discord.js').GuildMember} member
 * @param {string} guildId
 * @returns {{ embeds: EmbedBuilder[], components: [] }}
 */
function buildEndedMessage(member, guildId) {
  const userName = member.displayName || member.user.username;

  const embed = new EmbedBuilder()
    .setColor(0x808080) // Gray for ended
    .setTitle(`⚫ ${userName}`)
    .setDescription(t('streaming.liveEnded', {}, guildId))
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 128 }))
    .setTimestamp();

  return { embeds: [embed], components: [] };
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
        if (!stillStreaming) {
          await announceStreamEnd(guild, member);
        }
      } catch {
        await announceStreamEnd(guild, member);
      }
    }, END_DELAY));
  }
}

/**
 * Post a stream-start announcement.
 */
async function announceStreamStart(guild, member, presence) {
  try {
    const channel = findAnnouncementChannel(guild);
    if (!channel) return;

    const streamActivity = presence.activities.find(a => a.type === ActivityType.Streaming);
    if (!streamActivity) return;

    const messagePayload = buildLiveMessage(member, streamActivity, guild.id);

    const msg = await channel.send(messagePayload);

    activeAnnouncements.set(guild.id, {
      messageId: msg.id,
      channelId: channel.id,
    });

    console.log(`🔴 Stream announcement posted for ${member.user.tag} in ${guild.name}`);
  } catch (err) {
    console.error(`Stream announcement failed in ${guild.name}:`, err.message);
  }
}

/**
 * Edit the existing announcement to show "stream ended".
 */
async function announceStreamEnd(guild, member) {
  const announcement = activeAnnouncements.get(guild.id);
  if (!announcement) return;

  try {
    const channel = guild.channels.cache.get(announcement.channelId);
    if (!channel) {
      activeAnnouncements.delete(guild.id);
      return;
    }

    const msg = await channel.messages.fetch(announcement.messageId).catch(() => null);
    if (msg) {
      const endPayload = buildEndedMessage(member, guild.id);
      await msg.edit(endPayload);
    }

    activeAnnouncements.delete(guild.id);
    console.log(`⚫ Stream ended for ${member.user.tag} in ${guild.name}`);
  } catch (err) {
    console.error(`Stream end update failed in ${guild.name}:`, err.message);
    activeAnnouncements.delete(guild.id);
  }
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
};
