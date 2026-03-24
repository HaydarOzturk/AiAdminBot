const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { createEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/locale');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('Look up a specific moderation case by ID (Moderator+)')
    .addIntegerOption(opt =>
      opt.setName('id').setDescription('Case ID number').setRequired(true).setMinValue(1)
    ),

  async execute(interaction) {
    const g = interaction.guild?.id;
    if (!hasPermission(interaction.member, 'warn')) {
      return interaction.reply({ content: t('general.noPermission', {}, g), flags: MessageFlags.Ephemeral });
    }

    const caseId = interaction.options.getInteger('id');

    const action = db.get(
      'SELECT * FROM mod_actions WHERE id = ? AND guild_id = ?',
      [caseId, interaction.guild.id]
    );

    if (!action) {
      return interaction.reply({
        content: t('moderation.caseNotFound', { id: caseId }, g),
        flags: MessageFlags.Ephemeral,
      });
    }

    const typeEmoji = {
      warn: '⚠️', mute: '🔇', kick: '🚫', ban: '🔨',
      timeout: '⏱️', 'ai-flag': '🤖',
    };

    const typeLabel = {
      warn: t('moderation.actionTypes.warn', {}, g),
      mute: t('moderation.actionTypes.mute', {}, g),
      kick: t('moderation.actionTypes.kick', {}, g),
      ban: t('moderation.actionTypes.ban', {}, g),
      timeout: t('moderation.actionTypes.timeout', {}, g),
      'ai-flag': t('moderation.actionTypes.aiFlag', {}, g),
    };

    const emoji = typeEmoji[action.action_type] || '📌';
    const label = typeLabel[action.action_type] || action.action_type;
    const date = action.created_at ? new Date(action.created_at + 'Z') : null;

    const fields = [
      { name: t('moderation.caseType', {}, g), value: `${emoji} ${label}`, inline: true },
      { name: t('moderation.user', {}, g), value: `<@${action.user_id}>`, inline: true },
      { name: t('moderation.moderator', {}, g), value: `<@${action.moderator_id}>`, inline: true },
      { name: t('moderation.reason', {}, g), value: action.reason || t('moderation.noReason', {}, g), inline: false },
    ];

    if (action.duration) {
      fields.push({ name: t('moderation.duration', {}, g), value: action.duration, inline: true });
    }

    if (date) {
      fields.push({ name: t('moderation.date', {}, g), value: `<t:${Math.floor(date.getTime() / 1000)}:F>`, inline: true });
    }

    // Check for related warnings
    const warnings = db.all(
      'SELECT * FROM warnings WHERE user_id = ? AND guild_id = ? ORDER BY created_at DESC LIMIT 5',
      [action.user_id, interaction.guild.id]
    );

    if (warnings.length > 0) {
      const warningCount = db.get(
        'SELECT COUNT(*) as cnt FROM warnings WHERE user_id = ? AND guild_id = ?',
        [action.user_id, interaction.guild.id]
      );
      fields.push({
        name: t('moderation.activeWarnings', {}, g),
        value: `${warningCount?.cnt || 0}`,
        inline: true,
      });
    }

    const embed = createEmbed({
      title: `${t('moderation.caseTitle', {}, g)} #${caseId}`,
      color: action.action_type === 'ban' || action.action_type === 'threat' ? 'danger' : 'orange',
      fields,
      timestamp: true,
    });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
