const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { createEmbed } = require('../../utils/embedBuilder');
const { hasPermission } = require('../../utils/permissions');
const { t } = require('../../utils/locale');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('give-role')
    .setDescription('Give a role to a user (Moderator+)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to give the role to')
        .setRequired(true)
    )
    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription('Role to give')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for giving the role')
        .setRequired(false)
    ),

  async execute(interaction) {
    // Permission check
    if (!hasPermission(interaction.member, 'mute')) {
      return interaction.reply({
        content: t('general.noPermissionDetailed'),
        flags: MessageFlags.Ephemeral,
      });
    }

    const targetUser = interaction.options.getMember('user');
    const role = interaction.options.getRole('role');
    const reason = interaction.options.getString('reason') || t('moderation.noReason');

    if (!targetUser) {
      return interaction.reply({ content: t('moderation.userNotFound'), flags: MessageFlags.Ephemeral });
    }

    // Prevent giving roles higher than the command user's highest role
    if (role.position >= interaction.member.roles.highest.position) {
      return interaction.reply({
        content: t('roles.cannotGiveHigherRole'),
        flags: MessageFlags.Ephemeral,
      });
    }

    // Check if user already has the role
    if (targetUser.roles.cache.has(role.id)) {
      return interaction.reply({
        content: t('roles.alreadyHasRole', { user: targetUser.user.username, role: role.name }),
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      await targetUser.roles.add(role, reason);

      const embed = createEmbed({
        title: t('roles.roleGiven'),
        color: 'success',
        fields: [
          { name: t('moderation.user'), value: `${targetUser.user.tag}` },
          { name: t('roles.role'), value: `${role.name}` },
          { name: t('roles.giver'), value: `${interaction.user.tag}` },
          { name: t('moderation.reason'), value: reason },
        ],
        timestamp: true,
      });

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('Failed to give role:', error);
      await interaction.reply({
        content: t('roles.giveRoleFailed'),
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
