const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { cancelInterview } = require('../../systems/aiSetup');
const { t } = require('../../utils/locale');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ai-setup-cancel')
    .setDescription('Cancel active AI setup session (Owner only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!hasPermission(interaction.member, 'setup-server')) {
      return interaction.reply({
        content: t('setup.ownerOnly'),
        flags: MessageFlags.Ephemeral,
      });
    }

    const cancelled = cancelInterview(interaction.guild.id);

    if (cancelled) {
      await interaction.reply({ content: '✅ AI setup interview cancelled.' });
    } else {
      await interaction.reply({
        content: '❌ No active AI setup interview found.',
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
