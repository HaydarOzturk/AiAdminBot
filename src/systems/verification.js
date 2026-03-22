const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { createEmbed } = require('../utils/embedBuilder');
const { t } = require('../utils/locale');
const { config } = require('../utils/permissions');
const db = require('../utils/database');

/**
 * Send the verification embed with button to a channel
 * @param {import('discord.js').TextChannel} channel
 */
async function sendVerificationMessage(channel) {
  const embed = createEmbed({
    title: t('verification.embedTitle'),
    description: t('verification.embedDescription'),
    color: 'primary',
  });

  const button = new ButtonBuilder()
    .setCustomId('verify_button')
    .setLabel(t('verification.buttonLabel'))
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
      content: t('verification.alreadyVerified'),
      flags: MessageFlags.Ephemeral,
    });
  }

  const unverifiedRoleName = config.verification?.unverifiedRoleName || t('roles.unverified');
  const verifiedRoleName = config.verification?.verifiedRoleName || t('roles.verified');

  const unverifiedRole = guild.roles.cache.find(r => r.name === unverifiedRoleName);
  const verifiedRole = guild.roles.cache.find(r => r.name === verifiedRoleName);

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
      title: t('verification.successTitle'),
      description: t('verification.successDescription', { user: member.user.username }),
      color: 'success',
      fields: [
        { name: t('verification.oldRole'), value: unverifiedRoleName },
        { name: t('verification.newRole'), value: verifiedRoleName },
      ],
    });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

    // Log the verification
    const logChannelName = config.moderation?.logChannels?.role || 'rol-log';
    const logChannel = guild.channels.cache.find(c => c.name === logChannelName);

    if (logChannel) {
      const logEmbed = createEmbed({
        title: t('logging.roleChanged'),
        color: 'primary',
        fields: [
          { name: t('moderation.user'), value: `${member.user.tag}` },
          { name: t('logging.action'), value: t('logging.verification') },
          { name: t('logging.removedRole'), value: unverifiedRoleName },
          { name: t('logging.addedRole'), value: verifiedRoleName },
        ],
        timestamp: true,
      });

      await logChannel.send({ embeds: [logEmbed] });
    }

    console.log(`✅ ${member.user.tag} verified successfully.`);
  } catch (error) {
    console.error(`❌ Verification failed for ${member.user.tag}:`, error);
    await interaction.reply({
      content: t('general.error'),
      flags: MessageFlags.Ephemeral,
    });
  }
}

module.exports = { sendVerificationMessage, handleVerifyButton };
