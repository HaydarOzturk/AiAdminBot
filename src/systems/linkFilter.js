/**
 * Link Filter — Detects and removes messages containing URLs/links.
 *
 * When LINK_FILTER_ENABLED=true, any message containing a URL is deleted.
 * Staff members (Manage Messages permission) are exempt.
 * Optionally warns the user via DM or channel reply.
 */

const { PermissionsBitField } = require('discord.js');
const { createEmbed } = require('../utils/embedBuilder');
const { t } = require('../utils/locale');

// Match common URL patterns: http(s)://, www., and discord.gg invites
const URL_REGEX = /https?:\/\/[^\s]+|www\.[^\s]+|discord\.gg\/[^\s]+|discord\.com\/invite\/[^\s]+/i;

/**
 * Check a message for links and delete if link filtering is enabled.
 * @param {import('discord.js').Message} message
 * @returns {boolean} true if the message was deleted (link found)
 */
async function checkMessage(message) {
  // Check if link filter is enabled
  if (process.env.LINK_FILTER_ENABLED !== 'true') return false;

  // Skip messages without links
  if (!URL_REGEX.test(message.content)) return false;

  // Exempt staff: anyone with Manage Messages permission
  if (message.member && message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
    return false;
  }

  // Delete the message
  try {
    await message.delete();
  } catch (err) {
    console.warn(`Link filter: could not delete message ${message.id}: ${err.message}`);
    return false;
  }

  // Optionally warn the user
  const warnUser = process.env.LINK_FILTER_WARN_USER !== 'false';
  if (warnUser) {
    const g = message.guild?.id;
    try {
      const embed = createEmbed({
        title: t('linkFilter.warningTitle', {}, g),
        description: t('linkFilter.warningDesc', { user: message.author.username }, g),
        color: 'warning',
        timestamp: true,
      });

      // Send in the same channel (auto-delete after 8 seconds)
      const reply = await message.channel.send({ embeds: [embed] });
      setTimeout(() => reply.delete().catch(() => {}), 8000);
    } catch (err) {
      // Non-critical — warning just couldn't be sent
    }
  }

  return true;
}

module.exports = { checkMessage };
