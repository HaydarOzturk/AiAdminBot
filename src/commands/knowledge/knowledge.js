const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createEmbed } = require('../../utils/embedBuilder');
const { hasPermission } = require('../../utils/permissions');
const { t } = require('../../utils/locale');
const kb = require('../../systems/knowledgeBase');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('knowledge')
    .setDescription('Manage the server knowledge base')
    .addSubcommand(sub =>
      sub.setName('add').setDescription('Add knowledge to the server')
        .addStringOption(opt =>
          opt.setName('category').setDescription('Category').setRequired(true)
            .addChoices(
              { name: 'General', value: 'general' },
              { name: 'Game Info', value: 'game' },
              { name: 'Team', value: 'team' },
              { name: 'Schedule', value: 'schedule' },
              { name: 'Rule', value: 'rule' }
            )
        )
        .addStringOption(opt =>
          opt.setName('content').setDescription('The information to store').setRequired(true).setMaxLength(500)
        )
    )
    .addSubcommand(sub =>
      sub.setName('add-faq').setDescription('Add a frequently asked question')
        .addStringOption(opt =>
          opt.setName('question').setDescription('The question').setRequired(true).setMaxLength(200)
        )
        .addStringOption(opt =>
          opt.setName('answer').setDescription('The answer').setRequired(true).setMaxLength(500)
        )
    )
    .addSubcommand(sub =>
      sub.setName('search').setDescription('Search the knowledge base')
        .addStringOption(opt =>
          opt.setName('query').setDescription('What to search for').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('list').setDescription('List all knowledge entries')
        .addStringOption(opt =>
          opt.setName('category').setDescription('Filter by category')
            .addChoices(
              { name: 'All', value: 'all' },
              { name: 'General', value: 'general' },
              { name: 'Game Info', value: 'game' },
              { name: 'Team', value: 'team' },
              { name: 'Schedule', value: 'schedule' },
              { name: 'Rule', value: 'rule' },
              { name: 'FAQ', value: 'faq' }
            )
        )
    )
    .addSubcommand(sub =>
      sub.setName('delete').setDescription('Delete a knowledge entry')
        .addIntegerOption(opt =>
          opt.setName('id').setDescription('Entry ID to delete').setRequired(true)
        )
    ),

  async execute(interaction) {
    const g = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      if (!hasPermission(interaction.member, 'knowledge')) {
        return interaction.reply({ content: t('general.noPermission', {}, g), flags: MessageFlags.Ephemeral });
      }

      const category = interaction.options.getString('category');
      const content = interaction.options.getString('content');
      const id = kb.addKnowledge(g, category, content, interaction.user.id);

      return interaction.reply({
        embeds: [createEmbed({
          title: t('knowledge.added', {}, g),
          description: `[${category}] ${content}`,
          color: 'success',
          footer: `ID: ${id}`,
          timestamp: true,
        })],
      });
    }

    if (sub === 'add-faq') {
      if (!hasPermission(interaction.member, 'knowledge')) {
        return interaction.reply({ content: t('general.noPermission', {}, g), flags: MessageFlags.Ephemeral });
      }

      const question = interaction.options.getString('question');
      const answer = interaction.options.getString('answer');
      const id = kb.addKnowledge(g, 'faq', answer, interaction.user.id, question);

      return interaction.reply({
        embeds: [createEmbed({
          title: t('knowledge.faqAdded', {}, g),
          fields: [
            { name: t('knowledge.question', {}, g), value: question, inline: false },
            { name: t('knowledge.answer', {}, g), value: answer, inline: false },
          ],
          color: 'success',
          footer: `ID: ${id}`,
          timestamp: true,
        })],
      });
    }

    if (sub === 'search') {
      await interaction.deferReply();
      const query = interaction.options.getString('query');
      const results = await kb.searchKnowledge(g, query);

      if (results.length === 0) {
        return interaction.editReply({ content: t('knowledge.noResults', {}, g) });
      }

      const list = results.slice(0, 10).map(r =>
        `**#${r.id}** [${r.category}] ${r.question ? `Q: ${r.question}\n` : ''}${r.content}`
      ).join('\n\n');

      return interaction.editReply({
        embeds: [createEmbed({
          title: `🔍 ${t('knowledge.searchResults', { count: results.length }, g)}`,
          description: list.slice(0, 4096),
          color: 'primary',
          timestamp: true,
        })],
      });
    }

    if (sub === 'list') {
      const category = interaction.options.getString('category');
      const entries = kb.listKnowledge(g, category === 'all' ? null : category);

      if (entries.length === 0) {
        return interaction.reply({ content: t('knowledge.empty', {}, g), flags: MessageFlags.Ephemeral });
      }

      const list = entries.slice(0, 20).map(r =>
        `**#${r.id}** [${r.category}] ${r.question ? `Q: ${r.question} → ` : ''}${r.content.slice(0, 80)}${r.content.length > 80 ? '...' : ''}`
      ).join('\n');

      return interaction.reply({
        embeds: [createEmbed({
          title: `📚 ${t('knowledge.listTitle', { count: entries.length }, g)}`,
          description: list.slice(0, 4096),
          color: 'primary',
          timestamp: true,
        })],
      });
    }

    if (sub === 'delete') {
      if (!hasPermission(interaction.member, 'knowledge')) {
        return interaction.reply({ content: t('general.noPermission', {}, g), flags: MessageFlags.Ephemeral });
      }

      const id = interaction.options.getInteger('id');
      const deleted = kb.deleteKnowledge(g, id);

      if (!deleted) {
        return interaction.reply({ content: t('knowledge.notFound', {}, g), flags: MessageFlags.Ephemeral });
      }

      return interaction.reply({
        embeds: [createEmbed({ title: t('knowledge.deleted', { id }, g), color: 'danger', timestamp: true })],
      });
    }
  },
};
