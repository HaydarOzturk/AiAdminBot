const { moderateContent, isConfigured } = require('../utils/openrouter');
const { createEmbed } = require('../utils/embedBuilder');
const { sendModLog, logModAction } = require('../utils/modLogger');
const { t, channelName } = require('../utils/locale');
const db = require('../utils/database');

const CONFIDENCE_THRESHOLD = parseFloat(process.env.AI_MOD_CONFIDENCE_THRESHOLD) || 0.8;

// Cache recent checks to avoid re-checking edits (messageId -> result)
const recentChecks = new Map();
const CACHE_TTL = 300000; // 5 minutes

/**
 * Check a message for content violations using AI
 * @param {import('discord.js').Message} message
 * @returns {Promise<void>}
 */
async function checkMessage(message) {
  if (!isConfigured()) return;
  if (process.env.AI_MODERATION_ENABLED !== 'true') return;

  // Don't moderate bots, DMs, or very short messages
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!message.content || message.content.length < 5) return;

  // Don't moderate staff
  const { getPermissionLevel } = require('../utils/permissions');
  const member = await message.guild.members.fetch(message.author.id).catch(() => null);
  if (member && getPermissionLevel(member) >= 2) return; // Moderator+ exempt

  // Check cache
  if (recentChecks.has(message.id)) return;

  try {
    const result = await moderateContent(message.content);

    // Cache the result
    recentChecks.set(message.id, result);
    setTimeout(() => recentChecks.delete(message.id), CACHE_TTL);

    if (!result.flagged) return;
    if (result.confidence < CONFIDENCE_THRESHOLD) return;

    // ── Take action based on category ────────────────────────────────────

    console.log(`🤖 AI flagged message from ${message.author.tag}: [${result.category}] ${result.reason} (${Math.round(result.confidence * 100)}%)`);

    // Log to punishment channel
    const guild = message.guild;
    const botUser = guild.members.me.user;

    const caseId = logModAction(
      'ai-flag',
      message.author.id,
      guild.id,
      botUser.id,
      `[AI ${result.category}] ${result.reason}`
    );

    // Build log embed
    const embed = createEmbed({
      title: t('moderation.aiWarningTitle'),
      color: result.category === 'threat' ? 'danger' : 'orange',
      fields: [
        { name: t('moderation.user'), value: `${message.author.tag}\n<@${message.author.id}>`, inline: true },
        { name: t('moderation.channel'), value: `<#${message.channel.id}>`, inline: true },
        { name: t('moderation.category'), value: categoryLabel(result.category), inline: true },
        { name: t('moderation.confidence'), value: `${Math.round(result.confidence * 100)}%`, inline: true },
        { name: t('moderation.reason'), value: result.reason || '-', inline: false },
        { name: t('moderation.message'), value: message.content.length > 512 ? message.content.slice(0, 509) + '...' : message.content, inline: false },
        { name: t('moderation.caseId'), value: `#${caseId}`, inline: true },
      ],
      timestamp: true,
    });

    // Send to punishment log
    const logChannelName = channelName('punishment-log');
    const logChannel = guild.channels.cache.find(c => c.name === logChannelName && c.isTextBased());
    if (logChannel) {
      await logChannel.send({ embeds: [embed] });
    }

    // For high-confidence toxic/threat content, also add a warning to DB
    if (result.confidence >= 0.9 && (result.category === 'toxicity' || result.category === 'threat')) {
      db.run(
        'INSERT INTO warnings (user_id, guild_id, moderator_id, reason) VALUES (?, ?, ?, ?)',
        [message.author.id, guild.id, botUser.id, t('moderation.aiAutoWarningReason', { reason: result.reason })]
      );

      // Reply to the user with a warning
      try {
        await message.reply({
          content: t('moderation.aiAutoWarning', { category: categoryLabel(result.category) }),
        });
      } catch {
        // Message might have been deleted
      }
    }

    // For spam, delete the message
    if (result.category === 'spam' && result.confidence >= 0.9) {
      try {
        await message.delete();
      } catch {
        // Might not have permission
      }
    }
  } catch (err) {
    console.error('AI moderation check failed:', err.message);
  }
}

/**
 * Human-readable category labels
 */
function categoryLabel(category) {
  const labels = {
    toxicity: t('moderation.categories.toxicity'),
    spam: t('moderation.categories.spam'),
    nsfw: t('moderation.categories.nsfw'),
    threat: t('moderation.categories.threat'),
    none: t('moderation.categories.clean'),
  };
  return labels[category] || category;
}

module.exports = { checkMessage };
