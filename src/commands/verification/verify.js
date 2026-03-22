const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { sendVerificationMessage } = require('../../systems/verification');
const { t } = require('../../utils/locale');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify-setup')
    .setDescription('Send the verification message to this channel (Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      await sendVerificationMessage(interaction.channel);
      await interaction.editReply({
        content: t('verification.messageSent'),
      });
    } catch (error) {
      console.error('Failed to send verification message:', error);
      await interaction.editReply({
        content: t('verification.messageSendFailed'),
      });
    }
  },
};
