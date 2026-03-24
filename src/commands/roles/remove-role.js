const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { createEmbed } = require('../../utils/embedBuilder');
const { hasPermission } = require('../../utils/permissions');
const { t } = require('../../utils/locale');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove-role')
    .setDescription('Remove a role from a user (Moderator+)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to remove the role from')
        .setRequired(true)
    )
    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription('Role to remove')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for removing the role')
        .setRequired(false)
    ),

  async execute(interaction) {
    const g = interaction.guild?.id;
    // Permission check
    if (!hasPermission(interaction.member, 'mute')) {
      return interaction.reply({
        content: t('general.noPermissionDetailed', {}, g),
        flags: MessageFlags.Ephemeral,
      });
    }

    const targetUser = interaction.options.getMember('user');
    const role = interaction.options.getRole('role');
    const reason = interaction.options.getString('reason') || t('moderation.noReason', {}, g);

    if (!targetUser) {
      return interaction.reply({ content: t('moderation.userNotFound', {}, g), flags: MessageFlags.Ephemeral });
    }

    // Prevent removing roles higher than the command user's highest role
    if (role.position >= interaction.member.roles.highest.position) {
      return interaction.reply({
        content: t('roles.cannotRemoveHigherRole', {}, g),
        flags: MessageFlags.Ephemeral,
      });
    }

    // Check if user has the role
    if (!targetUser.roles.cache.has(role.id)) {
      return interaction.reply({
        content: t('roles.userDoesNotHaveRole', { user: targetUser.user.username, role: role.name }, g),
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      await targetUser.roles.remove(role, reason);

      const embed = createEmbed({
        title: t('roles.roleRemoved', {}, g),
        color: 'danger',
        fields: [
          { name: t('moderation.user', {}, g), value: `${targetUser.user.tag}` },
          { name: t('roles.role', {}, g), value: `${role.name}` },
          { name: t('roles.giver', {}, g), value: `${interaction.user.tag}` },
          { name: t('moderation.reason', {}, g), value: reason },
        ],
        timestamp: true,
      });

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('Failed to remove role:', error);
      await interaction.reply({
        content: t('roles.removeRoleFailed', {}, g),
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
