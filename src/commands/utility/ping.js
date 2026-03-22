const { SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embedBuilder');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Show bot latency'),

  async execute(interaction) {
    const sent = await interaction.reply({
      content: '🏓 Pinging...',
      fetchReply: true,
    });

    const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
    const wsLatency = interaction.client.ws.ping;

    const embed = createEmbed({
      title: '🏓 Pong!',
      color: roundtrip < 200 ? 'success' : roundtrip < 500 ? 'warning' : 'danger',
      fields: [
        { name: 'Roundtrip', value: `${roundtrip}ms` },
        { name: 'WebSocket', value: `${wsLatency}ms` },
      ],
    });

    await interaction.editReply({ content: null, embeds: [embed] });
  },
};
