const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { createEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/locale');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mod-stats')
    .setDescription('Server-wide moderation statistics (Moderator+)')
    .addStringOption(opt =>
      opt
        .setName('period')
        .setDescription('Time period to view')
        .setRequired(false)
        .addChoices(
          { name: '7 days', value: '7' },
          { name: '30 days', value: '30' },
          { name: '90 days', value: '90' },
          { name: 'All time', value: 'all' },
        )
    ),

  async execute(interaction) {
    const g = interaction.guild?.id;
    if (!hasPermission(interaction.member, 'warn')) {
      return interaction.reply({ content: t('general.noPermission', {}, g), flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const period = interaction.options.getString('period') || '30';
    const guildId = interaction.guild.id;

    // Build date filter
    let dateFilter = '';
    let dateParam = [];
    if (period !== 'all') {
      dateFilter = "AND created_at >= datetime('now', ?)";
      dateParam = [`-${period} days`];
    }

    // Total actions
    const totalRow = db.get(
      `SELECT COUNT(*) as cnt FROM mod_actions WHERE guild_id = ? ${dateFilter}`,
      [guildId, ...dateParam]
    );
    const totalActions = totalRow?.cnt || 0;

    // Actions by type
    const byType = db.all(
      `SELECT action_type, COUNT(*) as cnt FROM mod_actions WHERE guild_id = ? ${dateFilter} GROUP BY action_type ORDER BY cnt DESC`,
      [guildId, ...dateParam]
    );

    const typeEmoji = {
      warn: '⚠️', mute: '🔇', kick: '🚫', ban: '🔨',
      timeout: '⏱️', 'ai-flag': '🤖',
    };

    const typeBreakdown = byType.map(r => {
      const emoji = typeEmoji[r.action_type] || '📌';
      return `${emoji} **${r.action_type}**: ${r.cnt}`;
    }).join('\n') || t('general.none', {}, g);

    // Top 5 moderators
    const topMods = db.all(
      `SELECT moderator_id, COUNT(*) as cnt FROM mod_actions WHERE guild_id = ? ${dateFilter} GROUP BY moderator_id ORDER BY cnt DESC LIMIT 5`,
      [guildId, ...dateParam]
    );

    const topModsList = topMods.map((r, i) => {
      const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
      return `${medal} <@${r.moderator_id}> — ${r.cnt} ${t('moderation.actions', {}, g)}`;
    }).join('\n') || t('general.none', {}, g);

    // Top 5 most warned users
    const topUsers = db.all(
      `SELECT user_id, COUNT(*) as cnt FROM mod_actions WHERE guild_id = ? ${dateFilter} GROUP BY user_id ORDER BY cnt DESC LIMIT 5`,
      [guildId, ...dateParam]
    );

    const topUsersList = topUsers.map((r, i) => {
      return `${i + 1}. <@${r.user_id}> — ${r.cnt} ${t('moderation.actions', {}, g)}`;
    }).join('\n') || t('general.none', {}, g);

    // AI vs Manual breakdown
    const aiCount = db.get(
      `SELECT COUNT(*) as cnt FROM mod_actions WHERE guild_id = ? AND action_type = 'ai-flag' ${dateFilter}`,
      [guildId, ...dateParam]
    );
    const manualCount = totalActions - (aiCount?.cnt || 0);

    const periodLabel = period === 'all' ? t('moderation.allTime', {}, g) : t('moderation.lastDays', { days: period }, g);

    const embed = createEmbed({
      title: t('moderation.modStatsTitle', {}, g),
      description: `${periodLabel} • ${interaction.guild.name}`,
      color: 'primary',
      fields: [
        { name: t('moderation.totalActions', {}, g), value: `${totalActions}`, inline: true },
        { name: t('moderation.manualActions', {}, g), value: `${manualCount}`, inline: true },
        { name: t('moderation.aiActions', {}, g), value: `${aiCount?.cnt || 0}`, inline: true },
        { name: t('moderation.actionBreakdown', {}, g), value: typeBreakdown, inline: false },
        { name: t('moderation.topModerators', {}, g), value: topModsList, inline: false },
        { name: t('moderation.mostWarned', {}, g), value: topUsersList, inline: false },
      ],
      timestamp: true,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};
