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
      // Fetch pinned messages to know which to exempt
      const pinnedMessages = await interaction.channel.messages.fetchPinned().catch(() => new Map());
      const pinnedIds = new Set(pinnedMessages.keys());

      // Fetch messages from the channel
      const fetched = await interaction.channel.messages.fetch({ limit: 100 });

      // Filter messages: include bot + user messages, but exempt pinned and interactive bot messages
      let deletable = fetched.filter(m => {
        // Never delete pinned messages
        if (pinnedIds.has(m.id) || m.pinned) return false;

        // Never delete bot messages that have components (buttons/selects) — these are
        // important interactive messages like verification, role menus, etc.
        if (m.author.bot && m.components && m.components.length > 0) return false;

        // If filtering by user, only include that user's messages
        if (targetUser && m.author.id !== targetUser.id) return false;

        return true;
      });

      // Limit to requested amount
      const toDelete = deletable.first(amount);

      const deleted = await interaction.channel.bulkDelete(toDelete, true);

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
