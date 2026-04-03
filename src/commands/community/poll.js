const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/locale');
const polls = require('../../systems/polls');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create a poll')
    .addSubcommand(sub =>
      sub.setName('create').setDescription('Create a poll with your own options')
        .addStringOption(opt => opt.setName('question').setDescription('The poll question').setRequired(true))
        .addStringOption(opt => opt.setName('option1').setDescription('Option 1').setRequired(true))
        .addStringOption(opt => opt.setName('option2').setDescription('Option 2').setRequired(true))
        .addStringOption(opt => opt.setName('option3').setDescription('Option 3'))
        .addStringOption(opt => opt.setName('option4').setDescription('Option 4'))
        .addStringOption(opt => opt.setName('option5').setDescription('Option 5'))
        .addIntegerOption(opt => opt.setName('duration').setDescription('Duration in minutes (0 = no limit)').setMinValue(0).setMaxValue(10080))
    )
    .addSubcommand(sub =>
      sub.setName('ai').setDescription('AI generates a poll from your topic')
        .addStringOption(opt => opt.setName('topic').setDescription('What should the poll be about?').setRequired(true))
        .addIntegerOption(opt => opt.setName('duration').setDescription('Duration in minutes (0 = no limit)').setMinValue(0).setMaxValue(10080))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const question = interaction.options.getString('question');
      const options = [];
      for (let i = 1; i <= 5; i++) {
        const opt = interaction.options.getString(`option${i}`);
        if (opt) options.push(opt);
      }
      const duration = interaction.options.getInteger('duration') || 0;
      await polls.createPoll(interaction, question, options, duration);
    }

    if (sub === 'ai') {
      const topic = interaction.options.getString('topic');
      const duration = interaction.options.getInteger('duration') || 0;
      const g = interaction.guild.id;

      await interaction.deferReply();

      const suggestion = await polls.aiSuggestPoll(topic);
      if (!suggestion || !suggestion.question || !suggestion.options?.length) {
        return interaction.editReply({ content: t('polls.aiGenerateFailed', {}, g) || 'AI could not generate a poll. Try again or create one manually.' });
      }

      await polls.createPoll(
        interaction,
        suggestion.question,
        suggestion.options.slice(0, 5),
        duration
      );
    }
  },
};
