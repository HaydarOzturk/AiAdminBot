const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { createEmbed } = require('../utils/embedBuilder');
const { t } = require('../utils/locale');
const { config } = require('../utils/permissions');
const db = require('../utils/database');

/**
 * Find a role by checking multiple possible names (config, locale, English fallback).
 * Case-insensitive to handle servers where role names were tweaked slightly.
 */
function findRole(guild, configName, localeKey, englishFallback) {
  const names = [configName, t(localeKey, {}, guild.id), englishFallback].filter(Boolean);
  for (const name of names) {
    const role = guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
    if (role) return role;
  }
  return null;
}

/**
 * Send the verification embed with button to a channel
 * @param {import('discord.js').TextChannel} channel
 * @param {string} [guildId] - Guild ID for per-guild locale lookup
 */
async function sendVerificationMessage(channel, guildId) {
  const embed = createEmbed({
    title: t('verification.embedTitle', {}, guildId),
    description: t('verification.embedDescription', {}, guildId),
    color: 'primary',
  });

  const button = new ButtonBuilder()
    .setCustomId('verify_button')
    .setLabel(t('verification.buttonLabel', {}, guildId))
    .setStyle(ButtonStyle.Success);

  const row = new ActionRowBuilder().addComponents(button);

  await channel.send({ embeds: [embed], components: [row] });
}

/**
 * Handle the verify button click
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleVerifyButton(interaction) {
  const member = interaction.member;
  const guild = interaction.guild;

  // Check if already verified
  const existing = db.get(
    'SELECT * FROM verified_users WHERE user_id = ? AND guild_id = ?',
    [member.id, guild.id]
  );

  if (existing) {
    return interaction.reply({
      content: t('verification.alreadyVerified', {}, guild.id),
      flags: MessageFlags.Ephemeral,
    });
  }

  // Search by config name, then locale name, then English fallback (case-insensitive)
  const unverifiedRole = findRole(guild, config.verification?.unverifiedRoleName, 'roles.unverified', 'Unverified');
  const verifiedRole = findRole(guild, config.verification?.verifiedRoleName, 'roles.verified', 'New Member');

  const unverifiedRoleName = unverifiedRole?.name || t('roles.unverified', {}, guild.id);
  const verifiedRoleName = verifiedRole?.name || t('roles.verified', {}, guild.id);

  try {
    // Remove unverified role
    if (unverifiedRole && member.roles.cache.has(unverifiedRole.id)) {
      await member.roles.remove(unverifiedRole);
    }

    // Add verified role
    if (verifiedRole) {
      await member.roles.add(verifiedRole);
    } else {
      console.warn(`⚠️ Verified role "${verifiedRoleName}" not found!`);
    }

    // Save to database
    db.run(
      'INSERT OR REPLACE INTO verified_users (user_id, guild_id) VALUES (?, ?)',
      [member.id, guild.id]
    );

    // Send success response (ephemeral — only the user sees it)
    const embed = createEmbed({
      title: t('verification.successTitle', {}, guild.id),
      description: t('verification.successDescription', { user: member.user.username }, guild.id),
      color: 'success',
      fields: [
        { name: t('verification.oldRole', {}, guild.id), value: unverifiedRoleName },
        { name: t('verification.newRole', {}, guild.id), value: verifiedRoleName },
      ],
    });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

    // Log the verification
    const logChannelName = config.moderation?.logChannels?.role || 'rol-log';
    const logChannel = guild.channels.cache.find(c => c.name === logChannelName);

    if (logChannel) {
      const logEmbed = createEmbed({
        title: t('logging.roleChanged', {}, guild.id),
        color: 'primary',
        fields: [
          { name: t('moderation.user', {}, guild.id), value: `${member.user.tag}` },
          { name: t('logging.action', {}, guild.id), value: t('logging.verification', {}, guild.id) },
          { name: t('logging.removedRole', {}, guild.id), value: unverifiedRoleName },
          { name: t('logging.addedRole', {}, guild.id), value: verifiedRoleName },
        ],
        timestamp: true,
      });

      await logChannel.send({ embeds: [logEmbed] });
    }

    console.log(`✅ ${member.user.tag} verified successfully.`);
  } catch (error) {
    console.error(`❌ Verification failed for ${member.user.tag}:`, error);
    await interaction.reply({
      content: t('general.error', {}, guild.id),
      flags: MessageFlags.Ephemeral,
    });
  }
}

module.exports = { sendVerificationMessage, handleVerifyButton };
