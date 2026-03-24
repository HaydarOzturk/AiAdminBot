const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { createEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/locale');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Auto-setup server: categories, channels, roles, verification & role menus (Owner only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const g = interaction.guild?.id;
    // Only server owner (permission level 4) can run this
    if (!hasPermission(interaction.member, 'setup-server')) {
      return interaction.reply({
        content: t('setup.ownerOnly', {}, g),
        flags: MessageFlags.Ephemeral,
      });
    }

    // Defer because setup takes a while
    await interaction.deferReply();

    const serverSetup = require('../../systems/serverSetup');

    try {
      const result = await serverSetup.runSetup(interaction.guild);

      const fields = [
        { name: t('setup.roles', {}, g), value: t('setup.created-skipped', { created: result.rolesCreated, skipped: result.rolesSkipped }, g) },
        { name: t('setup.categories', {}, g), value: t('setup.created-skipped', { created: result.categoriesCreated, skipped: result.categoriesSkipped }, g) },
        { name: t('setup.channels', {}, g), value: t('setup.created-skipped', { created: result.channelsCreated, skipped: result.channelsSkipped }, g) },
      ];

      if (result.verificationSent) {
        fields.push({ name: t('setup.verification', {}, g), value: t('setup.verificationSent', {}, g) });
      }

      if (result.roleMenusSent.length > 0) {
        fields.push({
          name: t('setup.roleMenus', {}, g),
          value: result.roleMenusSent.map(m => `#${m}`).join(', '),
        });
      }

      if (result.errors.length > 0) {
        fields.push({
          name: t('setup.warnings', {}, g),
          value: result.errors.slice(0, 5).join('\n'),
        });
      }

      const embed = createEmbed({
        title: t('setup.setupComplete', {}, g),
        description: t('setup.setupCompleteSummary', {}, g),
        color: result.errors.length > 0 ? 'warning' : 'success',
        fields,
        timestamp: true,
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Setup failed:', error);
      await interaction.editReply({
        content: t('setup.setupFailed', { error: error.message }, g),
      });
    }
  },
};
