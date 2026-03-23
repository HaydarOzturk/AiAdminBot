const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { createEmbed } = require('../../utils/embedBuilder');
const { sendModLog, logModAction } = require('../../utils/modLogger');
const { t } = require('../../utils/locale');
const db = require('../../utils/database');
const { loadConfig } = require('../../utils/paths');

// Load config once
const config = loadConfig('config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a user (Moderator+)')
    .addUserOption(opt =>
      opt.setName('user').setDescription('User to warn').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('reason').setDescription('Warning reason').setRequired(true)
    ),

  async execute(interaction) {
    if (!hasPermission(interaction.member, 'warn')) {
      return interaction.reply({ content: t('general.noPermission'), flags: MessageFlags.Ephemeral });
    }

    const targetUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || t('moderation.noReason');
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (!member) {
      return interaction.reply({ content: t('moderation.userNotFound'), flags: MessageFlags.Ephemeral });
    }

    if (targetUser.id === interaction.user.id) {
      return interaction.reply({ content: t('moderation.cannotWarnSelf'), flags: MessageFlags.Ephemeral });
    }

    if (targetUser.bot) {
      return interaction.reply({ content: t('moderation.cannotWarnBot'), flags: MessageFlags.Ephemeral });
    }

    // Save warning to DB
    db.run(
      'INSERT INTO warnings (user_id, guild_id, moderator_id, reason) VALUES (?, ?, ?, ?)',
      [targetUser.id, interaction.guild.id, interaction.user.id, reason]
    );

    // Count total warnings
    const countRow = db.get(
      'SELECT COUNT(*) as count FROM warnings WHERE user_id = ? AND guild_id = ?',
      [targetUser.id, interaction.guild.id]
    );
    const totalWarnings = countRow ? countRow.count : 1;

    // Log to mod_actions
    const caseId = logModAction('warn', targetUser.id, interaction.guild.id, interaction.user.id, reason);

    // Reply in channel
    const embed = createEmbed({
      title: t('moderation.warnTitle'),
      color: 'warning',
      fields: [
        { name: t('moderation.user'), value: `${targetUser} (${targetUser.tag})`, inline: true },
        { name: t('moderation.moderator'), value: `${interaction.user}`, inline: true },
        { name: t('moderation.reason'), value: reason, inline: false },
        { name: t('moderation.totalWarnings'), value: `${totalWarnings}`, inline: true },
        { name: t('moderation.caseId'), value: `#${caseId}`, inline: true },
      ],
      timestamp: true,
    });

    await interaction.reply({ embeds: [embed] });

    // ── DM the warned user ──────────────────────────────────────────────
    try {
      const dmEmbed = createEmbed({
        title: t('moderation.warnDmTitle', { server: interaction.guild.name }),
        color: 'warning',
        fields: [
          { name: t('moderation.reason'), value: reason, inline: false },
          { name: t('moderation.moderator'), value: interaction.user.tag, inline: true },
          { name: t('moderation.totalWarnings'), value: `${totalWarnings} / ${config.moderation?.maxWarnings || 5}`, inline: true },
        ],
        footer: t('moderation.caseIdFooter', { caseId }),
        timestamp: true,
      });

      // If warn was used as a reply to a message, include that message as evidence
      if (interaction.channel) {
        // Check if there's a referenced message context (replied message)
        const referencedMessage = interaction.options.resolved?.messages?.first?.();
        if (referencedMessage) {
          dmEmbed.addFields({
            name: t('moderation.evidenceMessage'),
            value: referencedMessage.content?.slice(0, 512) || t('general.noText'),
            inline: false,
          });
        }
      }

      await targetUser.send({ embeds: [dmEmbed] });
    } catch {
      // User has DMs disabled — silently continue
    }

    // Log to punishment channel
    await sendModLog(interaction.guild, 'punishment', {
      title: t('moderation.warnTitle'),
      color: 'warning',
      targetUser,
      moderator: interaction.user,
      reason,
      caseId: String(caseId),
      extraFields: [{ name: t('moderation.totalWarnings'), value: `${totalWarnings}`, inline: true }],
    });

    // Auto-mute check
    const maxWarnings = config.moderation?.maxWarnings || 5;
    if (config.moderation?.autoMuteOnMaxWarnings && totalWarnings >= maxWarnings) {
      const muteDuration = config.moderation?.muteDuration || 3600000;
      try {
        await member.timeout(muteDuration, t('moderation.autoMuteReason', { maxWarnings }));
        await interaction.followUp({
          content: t('moderation.autoMuteApplied', { user: targetUser.tag, maxWarnings, duration: muteDuration / 60000 }),
        });
      } catch (err) {
        console.error('Auto-mute failed:', err.message);
      }
    }
  },
};
