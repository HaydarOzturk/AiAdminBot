const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createEmbed } = require('../../utils/embedBuilder');
const { hasPermission } = require('../../utils/permissions');
const { t } = require('../../utils/locale');
const customCommands = require('../../systems/customCommands');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('custom-command')
    .setDescription('Manage custom commands')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName('add').setDescription('Add a custom command')
        .addStringOption(opt =>
          opt.setName('name').setDescription('Command name (triggered with !name)').setRequired(true).setMaxLength(32)
        )
        .addStringOption(opt =>
          opt.setName('response').setDescription('Response text. Use {user}, {server}, {members}, {channel}').setRequired(true).setMaxLength(2000)
        )
        .addBooleanOption(opt =>
          opt.setName('embed').setDescription('Send as embed? (default: no)')
        )
        .addBooleanOption(opt =>
          opt.setName('ai').setDescription('AI-powered? Response becomes AI system prompt (default: no)')
        )
    )
    .addSubcommand(sub =>
      sub.setName('remove').setDescription('Remove a custom command')
        .addStringOption(opt =>
          opt.setName('name').setDescription('Command name to remove').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('list').setDescription('List all custom commands')
    ),

  async execute(interaction) {
    const g = interaction.guild.id;

    if (!hasPermission(interaction.member, 'custom-command')) {
      return interaction.reply({ content: t('general.noPermission', {}, g), flags: MessageFlags.Ephemeral });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const name = interaction.options.getString('name');
      const response = interaction.options.getString('response');
      const embedMode = interaction.options.getBoolean('embed') || false;
      const aiMode = interaction.options.getBoolean('ai') || false;

      const normalized = customCommands.setCommand(g, name, response, interaction.user.id, embedMode, aiMode);

      if (!normalized) {
        return interaction.reply({
          content: t('customCommands.invalidName', {}, g),
          flags: MessageFlags.Ephemeral,
        });
      }

      const embed = createEmbed({
        title: t('customCommands.added', {}, g),
        description: t('customCommands.addedDesc', { name: normalized }, g),
        color: 'success',
        fields: [
          { name: t('customCommands.trigger', {}, g), value: `\`!${normalized}\``, inline: true },
          { name: t('customCommands.embedMode', {}, g), value: embedMode ? '✅' : '❌', inline: true },
          { name: 'AI Mode', value: aiMode ? '🧠 Yes' : '❌', inline: true },
        ],
        timestamp: true,
      });

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'remove') {
      const name = interaction.options.getString('name');
      const deleted = customCommands.deleteCommand(g, name);

      if (!deleted) {
        return interaction.reply({
          content: t('customCommands.notFound', { name }, g),
          flags: MessageFlags.Ephemeral,
        });
      }

      return interaction.reply({
        embeds: [createEmbed({
          title: t('customCommands.removed', {}, g),
          description: t('customCommands.removedDesc', { name }, g),
          color: 'danger',
          timestamp: true,
        })],
      });
    }

    if (sub === 'list') {
      const commands = customCommands.listCommands(g);

      if (commands.length === 0) {
        return interaction.reply({
          content: t('customCommands.noneFound', {}, g),
          flags: MessageFlags.Ephemeral,
        });
      }

      const list = commands.map(cmd =>
        `\`!${cmd.name}\` — ${cmd.response.slice(0, 50)}${cmd.response.length > 50 ? '...' : ''} (${cmd.uses || 0} uses)`
      ).join('\n');

      const embed = createEmbed({
        title: t('customCommands.listTitle', {}, g),
        description: list,
        color: 'primary',
        timestamp: true,
      });

      return interaction.reply({ embeds: [embed] });
    }
  },
};
