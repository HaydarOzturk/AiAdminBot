/**
 * /ai-memory — View and manage community-taught AI memories.
 *
 * Subcommands:
 *   /ai-memory list           — View all stored memories
 *   /ai-memory delete <id>    — Delete a specific memory by ID
 *   /ai-memory clear          — Clear all memories for this server
 *   /ai-memory add <text>     — Manually add a memory
 */

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { createEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/locale');
const { run, get, all } = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ai-memory')
    .setDescription('Manage AI community memories')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('View all stored AI memories')
    )
    .addSubcommand(sub =>
      sub.setName('delete')
        .setDescription('Delete a specific memory by its number')
        .addIntegerOption(opt =>
          opt.setName('id')
            .setDescription('Memory ID (from /ai-memory list)')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('clear')
        .setDescription('Clear all AI memories for this server')
    )
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Manually add a memory')
        .addStringOption(opt =>
          opt.setName('text')
            .setDescription('The fact or information to teach the AI')
            .setRequired(true)
            .setMaxLength(200)
        )
    ),

  async execute(interaction) {
    const g = interaction.guild?.id;
    const guildId = interaction.guild?.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const memories = all(
        'SELECT id, value, taught_by, created_at FROM ai_memories WHERE guild_id = ? ORDER BY created_at DESC',
        [guildId]
      );

      if (!memories || memories.length === 0) {
        return interaction.reply({
          content: t('aiMemory.empty', {}, g),
          flags: MessageFlags.Ephemeral,
        });
      }

      const list = memories.map((m, i) => {
        const member = interaction.guild.members.cache.get(m.taught_by);
        const name = member?.displayName || 'Unknown';
        return `**${m.id}.** ${m.value}\n   _— ${name}_`;
      }).join('\n\n');

      const embed = createEmbed({
        title: t('aiMemory.listTitle', {}, g),
        description: list.slice(0, 4000),
        color: 'info',
        footer: t('aiMemory.listFooter', { count: memories.length }, g),
        timestamp: true,
      });

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

    } else if (sub === 'delete') {
      const memoryId = interaction.options.getInteger('id');

      const existing = get(
        'SELECT id FROM ai_memories WHERE id = ? AND guild_id = ?',
        [memoryId, guildId]
      );

      if (!existing) {
        return interaction.reply({
          content: t('aiMemory.notFound', { id: memoryId }, g),
          flags: MessageFlags.Ephemeral,
        });
      }

      run('DELETE FROM ai_memories WHERE id = ? AND guild_id = ?', [memoryId, guildId]);

      const embed = createEmbed({
        title: t('aiMemory.deletedTitle', {}, g),
        description: t('aiMemory.deletedDesc', { id: memoryId }, g),
        color: 'warning',
        timestamp: true,
      });

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

    } else if (sub === 'clear') {
      const countRow = get(
        'SELECT COUNT(*) as cnt FROM ai_memories WHERE guild_id = ?',
        [guildId]
      );
      const count = countRow?.cnt || 0;

      if (count === 0) {
        return interaction.reply({
          content: t('aiMemory.empty', {}, g),
          flags: MessageFlags.Ephemeral,
        });
      }

      run('DELETE FROM ai_memories WHERE guild_id = ?', [guildId]);

      const embed = createEmbed({
        title: t('aiMemory.clearedTitle', {}, g),
        description: t('aiMemory.clearedDesc', { count }, g),
        color: 'warning',
        timestamp: true,
      });

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

    } else if (sub === 'add') {
      const text = interaction.options.getString('text');

      const key = text.toLowerCase().split(/\s+/).slice(0, 5).join(' ');

      const countRow = get(
        'SELECT COUNT(*) as cnt FROM ai_memories WHERE guild_id = ?',
        [guildId]
      );
      if (countRow && countRow.cnt >= 50) {
        return interaction.reply({
          content: t('aiMemory.limitReached', {}, g),
          flags: MessageFlags.Ephemeral,
        });
      }

      run(
        `INSERT INTO ai_memories (guild_id, key, value, taught_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id, key) DO UPDATE SET
           value = excluded.value,
           taught_by = excluded.taught_by,
           created_at = CURRENT_TIMESTAMP`,
        [guildId, key, text, interaction.user.id]
      );

      const embed = createEmbed({
        title: t('aiMemory.addedTitle', {}, g),
        description: t('aiMemory.addedDesc', { memory: text }, g),
        color: 'success',
        timestamp: true,
      });

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },
};
