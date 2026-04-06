/**
 * Advanced Auto-Moderation System
 *
 * Features:
 * - Anti-spam (duplicate messages, rapid fire)
 * - Anti-raid (mass joins)
 * - Mention spam detection
 * - Caps lock detection
 * - Invite link blocking
 * - Progressive punishments (warn → mute → kick → ban)
 *
 * AI-based content analysis is handled by aiModeration.js,
 * which shares the infraction table for unified progressive punishment.
 */

const db = require('../utils/database');
const { createEmbed } = require('../utils/embedBuilder');
const { t, channelName } = require('../utils/locale');
const { getPermissionLevel } = require('../utils/permissions');
const { sendModLog, logModAction } = require('../utils/modLogger');

// ── In-memory trackers ─────────────────────────────────────────────────────

// Spam detection: userId -> { messages: [{content, timestamp}], lastWarned }
const spamTracker = new Map();

// Raid detection: guildId -> { joins: [timestamp], alerted }
const raidTracker = new Map();

// Cleanup intervals
setInterval(() => {
  const now = Date.now();
  for (const [userId, data] of spamTracker) {
    data.messages = data.messages.filter(m => now - m.timestamp < 10000);
    if (data.messages.length === 0) spamTracker.delete(userId);
  }
}, 30000);

setInterval(() => {
  const now = Date.now();
  for (const [guildId, data] of raidTracker) {
    data.joins = data.joins.filter(ts => now - ts < 30000);
    if (data.joins.length === 0) raidTracker.delete(guildId);
  }
}, 60000);

// ── Configuration ──────────────────────────────────────────────────────────

function getAutomodSettings(guildId) {
  const row = db.get('SELECT * FROM automod_settings WHERE guild_id = ?', [guildId]);
  if (!row) return null;
  return {
    guildId: row.guild_id,
    antiSpam: !!row.anti_spam,
    antiRaid: !!row.anti_raid,
    antiMentionSpam: !!row.anti_mention_spam,
    antiCaps: !!row.anti_caps,
    antiInvites: !!row.anti_invites,
    maxMentions: row.max_mentions || 5,
    maxCapsPercent: row.max_caps_percent || 70,
    raidThreshold: row.raid_threshold || 10,
    raidWindow: row.raid_window || 30,
    spamThreshold: row.spam_threshold || 5,
    spamWindow: row.spam_window || 5,
    progressive: !!row.progressive_punishments,
  };
}

// ── Spam Detection ─────────────────────────────────────────────────────────

function checkSpam(message, settings) {
  if (!settings.antiSpam) return null;

  const key = `${message.author.id}-${message.guild.id}`;
  const now = Date.now();

  if (!spamTracker.has(key)) {
    spamTracker.set(key, { messages: [], lastWarned: 0 });
  }

  const tracker = spamTracker.get(key);
  tracker.messages.push({ content: message.content, timestamp: now });

  // Keep only messages within the window
  const window = (settings.spamWindow || 5) * 1000;
  tracker.messages = tracker.messages.filter(m => now - m.timestamp < window);

  // Check for rapid-fire messages
  if (tracker.messages.length >= (settings.spamThreshold || 5)) {
    if (now - tracker.lastWarned > 30000) {
      tracker.lastWarned = now;
      return { type: 'spam', reason: 'Sending messages too quickly' };
    }
  }

  // Check for duplicate messages (3+ identical in 30s)
  const recentContent = tracker.messages.map(m => m.content);
  const duplicates = recentContent.filter(c => c === message.content);
  if (duplicates.length >= 3) {
    if (now - tracker.lastWarned > 30000) {
      tracker.lastWarned = now;
      return { type: 'spam', reason: 'Sending duplicate messages' };
    }
  }

  return null;
}

// ── Mention Spam Detection ─────────────────────────────────────────────────

function checkMentionSpam(message, settings) {
  if (!settings.antiMentionSpam) return null;

  const mentionCount = message.mentions.users.size + message.mentions.roles.size;
  if (message.mentions.everyone) return { type: 'mention_spam', reason: 'Used @everyone/@here' };

  if (mentionCount >= (settings.maxMentions || 5)) {
    return { type: 'mention_spam', reason: `Too many mentions (${mentionCount})` };
  }

  return null;
}

// ── Caps Lock Detection ────────────────────────────────────────────────────

function checkCaps(message, settings) {
  if (!settings.antiCaps) return null;
  if (message.content.length < 10) return null;

  const letters = message.content.replace(/[^a-zA-ZÀ-ÿ]/g, '');
  if (letters.length < 8) return null;

  const upperCount = (message.content.match(/[A-ZÀ-Ý]/g) || []).length;
  const percent = (upperCount / letters.length) * 100;

  if (percent >= (settings.maxCapsPercent || 70)) {
    return { type: 'caps', reason: `Excessive caps (${Math.round(percent)}%)` };
  }

  return null;
}

// ── Invite Link Detection ──────────────────────────────────────────────────

const INVITE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/\S+/gi;

function checkInvites(message, settings) {
  if (!settings.antiInvites) return null;

  if (INVITE_REGEX.test(message.content)) {
    return { type: 'invite', reason: 'Discord invite link detected' };
  }

  return null;
}

// ── Progressive Punishment ─────────────────────────────────────────────────

function getInfractionCount(userId, guildId) {
  const row = db.get(
    `SELECT COUNT(*) as count FROM automod_infractions
     WHERE user_id = ? AND guild_id = ? AND created_at > datetime('now', '-24 hours')`,
    [userId, guildId]
  );
  return row ? row.count : 0;
}

function addInfraction(userId, guildId, type, reason) {
  db.run(
    'INSERT INTO automod_infractions (user_id, guild_id, infraction_type, reason) VALUES (?, ?, ?, ?)',
    [userId, guildId, type, reason]
  );
}

/**
 * Determine punishment based on infraction count (last 24h):
 * 1st: warn (delete message)
 * 2nd: 5 min timeout
 * 3rd: 30 min timeout
 * 4th+: 24h timeout
 */
function getPunishment(infractionCount) {
  if (infractionCount <= 0) return { action: 'warn', duration: 0 };
  if (infractionCount === 1) return { action: 'timeout', duration: 5 * 60 * 1000 };
  if (infractionCount === 2) return { action: 'timeout', duration: 30 * 60 * 1000 };
  return { action: 'timeout', duration: 24 * 60 * 60 * 1000 };
}

// ── Raid Detection ─────────────────────────────────────────────────────────

function trackJoin(guildId, settings) {
  if (!settings || !settings.antiRaid) return null;

  if (!raidTracker.has(guildId)) {
    raidTracker.set(guildId, { joins: [], alerted: false });
  }

  const tracker = raidTracker.get(guildId);
  tracker.joins.push(Date.now());

  const windowMs = (settings.raidWindow || 30) * 1000;
  const now = Date.now();
  tracker.joins = tracker.joins.filter(ts => now - ts < windowMs);

  if (tracker.joins.length >= (settings.raidThreshold || 10) && !tracker.alerted) {
    tracker.alerted = true;
    setTimeout(() => { tracker.alerted = false; }, windowMs);
    return { type: 'raid', count: tracker.joins.length, window: settings.raidWindow || 30 };
  }

  return null;
}

// ── Main Check Function ────────────────────────────────────────────────────

/**
 * Check a message against all automod rules.
 * @param {import('discord.js').Message} message
 * @returns {Promise<boolean>} true if message was actioned
 */
async function checkMessage(message) {
  if (message.author.bot || !message.guild) return false;

  const settings = getAutomodSettings(message.guild.id);
  if (!settings) return false;

  // Staff exempt
  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return false;
  if (getPermissionLevel(member) >= 2) return false;

  // Run rule-based checks (fast, no API calls)
  // AI-based analysis is handled separately by aiModeration.js
  const violation =
    checkSpam(message, settings) ||
    checkMentionSpam(message, settings) ||
    checkCaps(message, settings) ||
    checkInvites(message, settings);

  if (!violation) return false;

  const g = message.guild.id;

  try {
    // Delete the message
    await message.delete().catch(() => {});

    // Record infraction
    addInfraction(message.author.id, g, violation.type, violation.reason);

    // Determine punishment
    const infractionCount = getInfractionCount(message.author.id, g);
    const punishment = settings.progressive ? getPunishment(infractionCount) : { action: 'warn', duration: 0 };

    // Apply punishment
    if (punishment.action === 'timeout' && punishment.duration > 0) {
      if (member.moderatable) {
        await member.timeout(punishment.duration, `[AutoMod] ${violation.reason}`);
      }
    }

    // Log the action
    const caseId = logModAction(
      'automod',
      message.author.id,
      g,
      message.client.user.id,
      `[${violation.type}] ${violation.reason}`
    );

    // Send log embed
    const logChannelName = channelName('punishment-log', g);
    const logChannel = message.guild.channels.cache.find(c => c.name === logChannelName && c.isTextBased());

    if (logChannel) {
      const durationText = punishment.duration > 0
        ? `${Math.round(punishment.duration / 60000)} min timeout`
        : 'Warning (message deleted)';

      const embed = createEmbed({
        title: t('automod.actionTitle', {}, g),
        color: 'orange',
        fields: [
          { name: t('moderation.user', {}, g), value: `${message.author.tag}\n<@${message.author.id}>`, inline: true },
          { name: t('moderation.channel', {}, g), value: `<#${message.channel.id}>`, inline: true },
          { name: t('automod.violation', {}, g), value: violation.type, inline: true },
          { name: t('moderation.reason', {}, g), value: violation.reason, inline: false },
          { name: t('automod.punishment', {}, g), value: durationText, inline: true },
          { name: t('automod.infractions24h', {}, g), value: `${infractionCount}`, inline: true },
          { name: t('moderation.caseId', {}, g), value: `#${caseId}`, inline: true },
        ],
        timestamp: true,
      });

      await logChannel.send({ embeds: [embed] });
    }

    // Notify user in channel
    try {
      const warning = await message.channel.send({
        content: t('automod.warningMessage', { user: `<@${message.author.id}>`, reason: violation.reason }, g),
      });
      setTimeout(() => warning.delete().catch(() => {}), 10000);
    } catch {}

    return true;
  } catch (err) {
    console.error('AutoMod error:', err.message);
    return false;
  }
}

module.exports = {
  checkMessage, trackJoin, getAutomodSettings,
  addInfraction, getInfractionCount, getPunishment,
};
