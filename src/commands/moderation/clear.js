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
    )
    .addStringOption(opt =>
      opt
        .setName('filter')
        .setDescription('Filter which messages to delete')
        .setRequired(false)
        .addChoices(
          { name: 'All messages (default)', value: 'all' },
          { name: 'Bot/AI messages only', value: 'bots' },
          { name: 'User messages only (no bots)', value: 'users' },
        )
    ),

  async execute(interaction) {
    const g = interaction.guild?.id;
    if (!hasPermission(interaction.member, 'clear')) {
      return interaction.reply({ content: t('general.noPermission', {}, g), flags: MessageFlags.Ephemeral });
    }

    const amount = interaction.options.getInteger('amount');
    const targetUser = interaction.options.getUser('user');
    const filter = interaction.options.getString('filter') || 'all';

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // Fetch pinned messages to know which to exempt
      const pinnedMessages = await interaction.channel.messages.fetchPinned().catch(() => new Map());
      const pinnedIds = new Set(pinnedMessages.keys());

      // Fetch messages from the channel
      // Fetch more than needed so we can fill the requested amount after filtering
      const fetched = await interaction.channel.messages.fetch({ limit: 100 });

      // Filter messages
      let deletable = fetched.filter(m => {
        // Never delete pinned messages
        if (pinnedIds.has(m.id) || m.pinned) return false;

        // Never delete bot messages that have components (buttons/selects) — these are
        // important interactive messages like verification, role menus, etc.
        if (m.author.bot && m.components && m.components.length > 0) return false;

        // Apply filter option
        if (filter === 'bots' && !m.author.bot) return false;
        if (filter === 'users' && m.author.bot) return false;

        // If filtering by user, only include that user's messages
        if (targetUser && m.author.id !== targetUser.id) return false;

        return true;
      });

      // Limit to requested amount
      const toDelete = deletable.first(amount);

      if (toDelete.length === 0) {
        await interaction.editReply({ content: t('moderation.noMessagesToDelete', {}, g) });
        return;
      }

      const deleted = await interaction.channel.bulkDelete(toDelete, true);

      const response = targetUser
        ? t('moderation.messagesDeletedByUser', { count: deleted.size, user: targetUser.tag }, g)
        : t('moderation.messagesDeleted', { count: deleted.size }, g);

      await interaction.editReply({ content: response });

      // If fewer messages were deleted than requested, it's because they're older than 14 days
      if (deleted.size < amount && deleted.size < toDelete.length) {
        await interaction.followUp({
          content: t('moderation.oldMessagesWarning', {}, g),
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (err) {
      console.error('Clear failed:', err);
      await interaction.editReply({ content: t('moderation.clearFailed', { error: err.message }, g) });
    }
  },
};
