const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { createEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/locale');
const db = require('../../utils/database');
const { getPermissionLevel } = require('../../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blocklist')
    .setDescription(t('blocklist.commandDesc'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription(t('blocklist.addDesc'))
        .addStringOption(opt =>
          opt.setName('word')
            .setDescription(t('blocklist.wordOption'))
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription(t('blocklist.removeDesc'))
        .addStringOption(opt =>
          opt.setName('word')
            .setDescription(t('blocklist.wordOption'))
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription(t('blocklist.listDesc'))
    ),

  async execute(interaction) {
    const g = interaction.guild?.id;
    const member = interaction.member;
    const permLevel = getPermissionLevel(member);

    // Moderator+ only (level >= 2)
    if (permLevel < 2) {
      return interaction.reply({
        content: t('general.noPermission', {}, g),
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'add') {
      const word = interaction.options.getString('word').toLowerCase().trim();

      if (word.length < 2) {
        return interaction.reply({
          content: t('blocklist.tooShort', {}, g),
          flags: MessageFlags.Ephemeral,
        });
      }

      // Check if already exists
      const existing = db.get(
        'SELECT id FROM blocked_words WHERE guild_id = ? AND word = ?',
        [guildId, word]
      );

      if (existing) {
        return interaction.reply({
          content: t('blocklist.alreadyExists', { word }, g),
          flags: MessageFlags.Ephemeral,
        });
      }

      db.run(
        'INSERT INTO blocked_words (guild_id, word, added_by) VALUES (?, ?, ?)',
        [guildId, word, interaction.user.id]
      );

      // Clear the cache so aiModeration picks up the new word
      clearBlocklistCache(guildId);

      const embed = createEmbed({
        title: t('blocklist.addedTitle', {}, g),
        description: t('blocklist.addedDesc', { word }, g),
        color: 'success',
      });

      return interaction.reply({ embeds: [embed] });

    } else if (sub === 'remove') {
      const word = interaction.options.getString('word').toLowerCase().trim();

      const existing = db.get(
        'SELECT id FROM blocked_words WHERE guild_id = ? AND word = ?',
        [guildId, word]
      );

      if (!existing) {
        return interaction.reply({
          content: t('blocklist.notFound', { word }, g),
          flags: MessageFlags.Ephemeral,
        });
      }

      db.run(
        'DELETE FROM blocked_words WHERE guild_id = ? AND word = ?',
        [guildId, word]
      );

      clearBlocklistCache(guildId);

      const embed = createEmbed({
        title: t('blocklist.removedTitle', {}, g),
        description: t('blocklist.removedDesc', { word }, g),
        color: 'success',
      });

      return interaction.reply({ embeds: [embed] });

    } else if (sub === 'list') {
      const rows = db.all(
        'SELECT word, added_by, added_at FROM blocked_words WHERE guild_id = ? ORDER BY word',
        [guildId]
      );

      if (rows.length === 0) {
        return interaction.reply({
          content: t('blocklist.empty', {}, g),
          flags: MessageFlags.Ephemeral,
        });
      }

      const wordList = rows.map(r => `\`${r.word}\``).join(', ');

      const embed = createEmbed({
        title: t('blocklist.listTitle', {}, g),
        description: t('blocklist.listDesc2', { count: rows.length }, g),
        color: 'primary',
        fields: [
          { name: t('blocklist.wordsField', {}, g), value: wordList.length > 1024 ? wordList.slice(0, 1021) + '...' : wordList },
        ],
      });

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },
};

// ── Cache invalidation helper ───────────────────────────────────────────────
// The aiModeration module caches blocked words per guild.
// When the blocklist changes, we need to clear that cache.

function clearBlocklistCache(guildId) {
  try {
    const aiMod = require('../../systems/aiModeration');
    if (typeof aiMod.clearGuildCache === 'function') {
      aiMod.clearGuildCache(guildId);
    }
  } catch { /* aiModeration not loaded yet */ }
}
