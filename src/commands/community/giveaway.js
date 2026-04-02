const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createEmbed } = require('../../utils/embedBuilder');
const { hasPermission } = require('../../utils/permissions');
const { t } = require('../../utils/locale');
const giveawaySystem = require('../../systems/giveaway');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Manage giveaways')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName('start').setDescription('Start a new giveaway')
        .addStringOption(opt =>
          opt.setName('prize').setDescription('What are you giving away?').setRequired(true)
        )
        .addIntegerOption(opt =>
          opt.setName('duration').setDescription('Duration in minutes').setRequired(true).setMinValue(1).setMaxValue(43200)
        )
        .addIntegerOption(opt =>
          opt.setName('winners').setDescription('Number of winners (default: 1)').setMinValue(1).setMaxValue(10)
        )
    )
    .addSubcommand(sub =>
      sub.setName('reroll').setDescription('Re-roll winners for an ended giveaway')
        .addStringOption(opt =>
          opt.setName('message-id').setDescription('Giveaway message ID').setRequired(true)
        )
    ),

  async execute(interaction) {
    const g = interaction.guild.id;

    if (!hasPermission(interaction.member, 'giveaway')) {
      return interaction.reply({ content: t('general.noPermission', {}, g), flags: MessageFlags.Ephemeral });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'start') {
      const prize = interaction.options.getString('prize');
      const duration = interaction.options.getInteger('duration');
      const winners = interaction.options.getInteger('winners') || 1;

      await giveawaySystem.createGiveaway(interaction, prize, duration, winners);
    }

    if (sub === 'reroll') {
      const messageId = interaction.options.getString('message-id');
      const newWinners = await giveawaySystem.rerollGiveaway(messageId, g, interaction.client);

      if (!newWinners) {
        return interaction.reply({ content: t('giveaway.notFound', {}, g), flags: MessageFlags.Ephemeral });
      }

      if (newWinners.length === 0) {
        return interaction.reply({ content: t('giveaway.noEntries', {}, g), flags: MessageFlags.Ephemeral });
      }

      const winnerText = newWinners.map(id => `<@${id}>`).join(', ');
      await interaction.reply({
        content: `🎉 ${t('giveaway.rerolled', {}, g)} ${winnerText}!`,
      });
    }
  },
};
