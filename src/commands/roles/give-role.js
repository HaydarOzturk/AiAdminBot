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

    // Prevent giving roles higher than the command user's highest role
    if (role.position >= interaction.member.roles.highest.position) {
      return interaction.reply({
        content: t('roles.cannotGiveHigherRole', {}, g),
        flags: MessageFlags.Ephemeral,
      });
    }

    // Check if user already has the role
    if (targetUser.roles.cache.has(role.id)) {
      return interaction.reply({
        content: t('roles.alreadyHasRole', { user: targetUser.user.username, role: role.name }, g),
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      await targetUser.roles.add(role, reason);

      const embed = createEmbed({
        title: t('roles.roleGiven', {}, g),
        color: 'success',
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
      console.error('Failed to give role:', error);
      await interaction.reply({
        content: t('roles.giveRoleFailed', {}, g),
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
