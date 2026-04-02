const { SlashCommandBuilder, MessageFlags, ChannelType } = require('discord.js');
const { createEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/locale');
const kb = require('../../systems/knowledgeBase');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('what-did-i-miss')
    .setDescription('Get an AI summary of recent activity in a channel')
    .addIntegerOption(opt =>
      opt.setName('hours').setDescription('Hours to look back (default: 8, max: 48)').setMinValue(1).setMaxValue(48)
    )
    .addChannelOption(opt =>
      opt.setName('channel').setDescription('Channel to summarize (default: current)').addChannelTypes(ChannelType.GuildText)
    ),

  async execute(interaction) {
    const g = interaction.guild.id;
    const hours = interaction.options.getInteger('hours') || 8;
    const channel = interaction.options.getChannel('channel') || interaction.channel;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const summary = await kb.getChannelSummary(g, channel.id, hours);

    if (!summary) {
      return interaction.editReply({
        content: t('knowledge.noActivity', {}, g),
      });
    }

    const embed = createEmbed({
      title: `📋 ${t('knowledge.whatDidIMissTitle', { channel: channel.name, hours }, g)}`,
      description: summary.slice(0, 4096),
      color: 'info',
      timestamp: true,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};
