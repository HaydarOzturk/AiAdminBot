const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { t } = require('../../utils/locale');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Bulk delete messages in a channel (Moderator+)')
    .addIntegerOption(opt =>
      opt
        .setName('amount')
        .setDescription('Number of messages to delete (1-100)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    )
    .addUserOption(opt =>
      opt.setName('user').setDescription('Only delete messages from this user').setRequired(false)
    ),

  async execute(interaction) {
    if (!hasPermission(interaction.member, 'clear')) {
      return interaction.reply({ content: t('general.noPermission'), flags: MessageFlags.Ephemeral });
    }

    const amount = interaction.options.getInteger('amount');
    const targetUser = interaction.options.getUser('user');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      let deleted;

      if (targetUser) {
        // Fetch more messages and filter by user, then delete
        const messages = await interaction.channel.messages.fetch({ limit: 100 });
        const userMessages = messages
          .filter(m => m.author.id === targetUser.id)
          .first(amount);

        deleted = await interaction.channel.bulkDelete(userMessages, true);
      } else {
        deleted = await interaction.channel.bulkDelete(amount, true);
      }

      const response = targetUser
        ? t('moderation.messagesDeletedByUser', { count: deleted.size, user: targetUser.tag })
        : t('moderation.messagesDeleted', { count: deleted.size });

      await interaction.editReply({ content: response });

      // If fewer messages were deleted than requested, it's because they're older than 14 days
      if (deleted.size < amount) {
        await interaction.followUp({
          content: t('moderation.oldMessagesWarning'),
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (err) {
      console.error('Clear failed:', err);
      await interaction.editReply({ content: t('moderation.clearFailed', { error: err.message }) });
    }
  },
};
