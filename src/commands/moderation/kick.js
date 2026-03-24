const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { createEmbed } = require('../../utils/embedBuilder');
const { sendModLog, logModAction } = require('../../utils/modLogger');
const { t } = require('../../utils/locale');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a user from the server (Admin+)')
    .addUserOption(opt =>
      opt.setName('user').setDescription('User to kick').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('reason').setDescription('Kick reason').setRequired(false)
    ),

  async execute(interaction) {
    const g = interaction.guild?.id;
    if (!hasPermission(interaction.member, 'kick')) {
      return interaction.reply({ content: t('moderation.kickOnlyAdmin', {}, g), flags: MessageFlags.Ephemeral });
    }

    const targetUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || t('moderation.noReason', {}, g);

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (!member) {
      return interaction.reply({ content: t('moderation.userNotFound', {}, g), flags: MessageFlags.Ephemeral });
    }

    if (targetUser.id === interaction.user.id) {
      return interaction.reply({ content: t('moderation.cannotKickSelf', {}, g), flags: MessageFlags.Ephemeral });
    }

    if (!member.kickable) {
      return interaction.reply({ content: t('moderation.cannotKickUser', {}, g), flags: MessageFlags.Ephemeral });
    }

    try {
      // DM the user before kicking
      try {
        await targetUser.send(t('moderation.kickDmMessage', { server: interaction.guild.name, reason }, g));
      } catch {
        // User might have DMs disabled
      }

      await member.kick(reason);

      const caseId = logModAction('kick', targetUser.id, interaction.guild.id, interaction.user.id, reason);

      const embed = createEmbed({
        title: t('moderation.kickTitle', {}, g),
        color: 'danger',
        fields: [
          { name: t('moderation.user', {}, g), value: `${targetUser} (${targetUser.tag})`, inline: true },
          { name: t('moderation.moderator', {}, g), value: `${interaction.user}`, inline: true },
          { name: t('moderation.reason', {}, g), value: reason, inline: false },
          { name: t('moderation.caseId', {}, g), value: `#${caseId}`, inline: true },
        ],
        timestamp: true,
      });

      await interaction.reply({ embeds: [embed] });

      await sendModLog(interaction.guild, 'punishment', {
        title: t('moderation.kickTitle', {}, g),
        color: 'danger',
        targetUser,
        moderator: interaction.user,
        reason,
        caseId: String(caseId),
      });
    } catch (err) {
      console.error('Kick failed:', err);
      await interaction.reply({ content: t('moderation.kickFailed', { error: err.message }, g), flags: MessageFlags.Ephemeral });
    }
  },
};
