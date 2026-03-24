const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { createEmbed } = require('../../utils/embedBuilder');
const { sendModLog, logModAction } = require('../../utils/modLogger');
const { t } = require('../../utils/locale');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user from the server (Owner only)')
    .addUserOption(opt =>
      opt.setName('user').setDescription('User to ban').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('reason').setDescription('Ban reason').setRequired(false)
    )
    .addIntegerOption(opt =>
      opt
        .setName('delete-messages')
        .setDescription('How many days of messages to delete?')
        .setRequired(false)
        .addChoices(
          { name: 'Do not delete', value: 0 },
          { name: 'Last 1 day', value: 1 },
          { name: 'Last 7 days', value: 7 }
        )
    ),

  async execute(interaction) {
    const g = interaction.guild?.id;
    // Ban is owner-only (permission level 4)
    if (!hasPermission(interaction.member, 'ban')) {
      return interaction.reply({ content: t('moderation.banOnlyOwner', {}, g), flags: MessageFlags.Ephemeral });
    }

    const targetUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || t('moderation.noReason', {}, g);
    const deleteMessageDays = interaction.options.getInteger('delete-messages') || 0;

    if (targetUser.id === interaction.user.id) {
      return interaction.reply({ content: t('moderation.cannotBanSelf', {}, g), flags: MessageFlags.Ephemeral });
    }

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (member && !member.bannable) {
      return interaction.reply({ content: t('moderation.cannotBanUser', {}, g), flags: MessageFlags.Ephemeral });
    }

    try {
      // DM the user before banning
      try {
        await targetUser.send(t('moderation.banDmMessage', { server: interaction.guild.name, reason }, g));
      } catch {
        // User might have DMs disabled
      }

      await interaction.guild.members.ban(targetUser, {
        deleteMessageSeconds: deleteMessageDays * 86400,
        reason,
      });

      const caseId = logModAction('ban', targetUser.id, interaction.guild.id, interaction.user.id, reason);

      const embed = createEmbed({
        title: t('moderation.banTitle', {}, g),
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

      // Log to ban-log channel specifically
      await sendModLog(interaction.guild, 'ban', {
        title: t('moderation.banTitle', {}, g),
        color: 'danger',
        targetUser,
        moderator: interaction.user,
        reason,
        caseId: String(caseId),
      });
    } catch (err) {
      console.error('Ban failed:', err);
      await interaction.reply({ content: t('moderation.banFailed', { error: err.message }, g), flags: MessageFlags.Ephemeral });
    }
  },
};
