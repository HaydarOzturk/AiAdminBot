const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { createEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/locale');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mod-history')
    .setDescription("View a user's full moderation history (Moderator+)")
    .addUserOption(opt =>
      opt.setName('user').setDescription('User to view history for').setRequired(true)
    ),

  async execute(interaction) {
    if (!hasPermission(interaction.member, 'warn')) {
      return interaction.reply({ content: t('general.noPermission'), flags: MessageFlags.Ephemeral });
    }

    const targetUser = interaction.options.getUser('user');

    // Get all mod actions for this user
    const actions = db.all(
      'SELECT * FROM mod_actions WHERE user_id = ? AND guild_id = ? ORDER BY created_at DESC LIMIT 15',
      [targetUser.id, interaction.guild.id]
    );

    if (actions.length === 0) {
      return interaction.reply({
        content: t('moderation.noHistoryFound', { user: targetUser.tag }),
        flags: MessageFlags.Ephemeral,
      });
    }

    // Count by type
    const counts = {};
    for (const a of actions) {
      counts[a.action_type] = (counts[a.action_type] || 0) + 1;
    }

    const typeEmoji = {
      warn: '⚠️',
      mute: '🔇',
      kick: '🚫',
      ban: '🔨',
      timeout: '⏱️',
      'ai-flag': '🤖',
    };

    const typeLabel = {
      warn: t('moderation.actionTypes.warn'),
      mute: t('moderation.actionTypes.mute'),
      kick: t('moderation.actionTypes.kick'),
      ban: t('moderation.actionTypes.ban'),
      timeout: t('moderation.actionTypes.timeout'),
      'ai-flag': t('moderation.actionTypes.aiFlag'),
    };

    // Build summary line
    const summaryParts = Object.entries(counts).map(
      ([type, count]) => `${typeEmoji[type] || '📌'} ${count} ${typeLabel[type] || type}`
    );

    // Build action list
    const lines = actions.map((a, i) => {
      const emoji = typeEmoji[a.action_type] || '📌';
      const label = typeLabel[a.action_type] || a.action_type;
      const date = a.created_at ? new Date(a.created_at + 'Z').toLocaleDateString(process.env.LOCALE === 'tr' ? 'tr-TR' : 'en-US') : '?';
      const reason = a.reason || t('moderation.noReason');
      const duration = a.duration ? ` (${a.duration})` : '';
      return `**#${a.id}** ${emoji} ${label}${duration} — ${reason}\n  <@${a.moderator_id}> • ${date}`;
    });

    const embed = createEmbed({
      title: t('moderation.modHistoryTitle', { user: targetUser.tag }),
      description: lines.join('\n\n'),
      color: 'orange',
      fields: [
        { name: t('moderation.summary'), value: summaryParts.join(' • ') || t('general.none'), inline: false },
      ],
      thumbnail: targetUser.displayAvatarURL({ dynamic: true, size: 64 }),
      footer: t('moderation.modHistoryFooter'),
      timestamp: true,
    });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
