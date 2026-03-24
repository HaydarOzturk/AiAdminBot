const fs = require('fs');
const path = require('path');
const { createEmbed } = require('./embedBuilder');
const { t } = require('./locale');
const { loadConfig } = require('./paths');

// Load config for log channel names
const config = loadConfig('config.json');

/**
 * Send a moderation log embed to the appropriate log channel
 * @param {import('discord.js').Guild} guild
 * @param {'punishment'|'ban'|'role'} logType - Which log channel to use
 * @param {object} options
 * @param {string} options.title - Embed title
 * @param {string} options.color - Embed color preset
 * @param {import('discord.js').User} options.targetUser - The user being actioned
 * @param {import('discord.js').User} options.moderator - The mod performing the action
 * @param {string} [options.reason] - Reason for the action
 * @param {string} [options.duration] - Duration string (for mute/timeout)
 * @param {string} [options.caseId] - Case ID from database
 * @param {Array} [options.extraFields] - Additional embed fields
 */
async function sendModLog(guild, logType, options) {
  const guildId = guild.id;
  const channelNameMap = {
    punishment: config.moderation?.logChannels?.punishment || 'ceza-log',
    ban: config.moderation?.logChannels?.ban || 'ban-log',
    role: config.moderation?.logChannels?.role || 'rol-log',
  };

  const channelName = channelNameMap[logType];
  if (!channelName) return;

  const logChannel = guild.channels.cache.find(
    c => c.name === channelName && c.isTextBased()
  );

  if (!logChannel) {
    console.warn(`⚠️ Log channel #${channelName} not found`);
    return;
  }

  const fields = [
    { name: t('moderation.user', {}, guildId), value: `${options.targetUser} (${options.targetUser.tag})`, inline: true },
    { name: t('moderation.moderator', {}, guildId), value: `${options.moderator} (${options.moderator.tag})`, inline: true },
    { name: t('moderation.reason', {}, guildId), value: options.reason || t('moderation.noReason', {}, guildId), inline: false },
  ];

  if (options.duration) {
    fields.push({ name: t('moderation.duration', {}, guildId), value: options.duration, inline: true });
  }

  if (options.caseId) {
    fields.push({ name: t('moderation.caseId', {}, guildId), value: `#${options.caseId}`, inline: true });
  }

  if (options.extraFields) {
    fields.push(...options.extraFields);
  }

  const embed = createEmbed({
    title: options.title,
    color: options.color || 'danger',
    fields,
    timestamp: true,
  });

  try {
    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error(`Failed to send mod log to #${channelName}:`, err.message);
  }
}

/**
 * Log a mod action to the database and return the case ID
 * @param {string} actionType - warn, mute, kick, ban, timeout
 * @param {string} userId
 * @param {string} guildId
 * @param {string} moderatorId
 * @param {string} [reason]
 * @param {string} [duration]
 * @returns {number} The case ID
 */
function logModAction(actionType, userId, guildId, moderatorId, reason, duration) {
  const db = require('./database');
  db.run(
    'INSERT INTO mod_actions (action_type, user_id, guild_id, moderator_id, reason, duration) VALUES (?, ?, ?, ?, ?, ?)',
    [actionType, userId, guildId, moderatorId, reason || null, duration || null]
  );

  const row = db.get(
    'SELECT id FROM mod_actions WHERE guild_id = ? ORDER BY id DESC LIMIT 1',
    [guildId]
  );

  return row ? row.id : '?';
}

module.exports = { sendModLog, logModAction };
