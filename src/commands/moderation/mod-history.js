const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { createEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/locale');
const db = require('../../utils/database');

const PAGE_SIZE = 10;

const typeEmoji = {
  warn: '⚠️',
  mute: '🔇',
  kick: '🚫',
  ban: '🔨',
  timeout: '⏱️',
  'ai-flag': '🤖',
};

function getTypeLabel(type) {
  const labels = {
    warn: t('moderation.actionTypes.warn'),
    mute: t('moderation.actionTypes.mute'),
    kick: t('moderation.actionTypes.kick'),
    ban: t('moderation.actionTypes.ban'),
    timeout: t('moderation.actionTypes.timeout'),
    'ai-flag': t('moderation.actionTypes.aiFlag'),
  };
  return labels[type] || type;
}

/**
 * Fetch paginated mod actions
 */
function getActions(userId, guildId, type, page) {
  const offset = page * PAGE_SIZE;

  if (type) {
    const total = db.get(
      'SELECT COUNT(*) as cnt FROM mod_actions WHERE user_id = ? AND guild_id = ? AND action_type = ?',
      [userId, guildId, type]
    );
    const rows = db.all(
      'SELECT * FROM mod_actions WHERE user_id = ? AND guild_id = ? AND action_type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [userId, guildId, type, PAGE_SIZE, offset]
    );
    return { rows, total: total?.cnt || 0 };
  }

  const total = db.get(
    'SELECT COUNT(*) as cnt FROM mod_actions WHERE user_id = ? AND guild_id = ?',
    [userId, guildId]
  );
  const rows = db.all(
    'SELECT * FROM mod_actions WHERE user_id = ? AND guild_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [userId, guildId, PAGE_SIZE, offset]
  );
  return { rows, total: total?.cnt || 0 };
}

/**
 * Build the embed for a page of actions
 */
function buildPageEmbed(actions, targetUser, page, totalPages, totalCount, filterType) {
  const lines = actions.map(a => {
    const emoji = typeEmoji[a.action_type] || '📌';
    const label = getTypeLabel(a.action_type);
    const date = a.created_at ? new Date(a.created_at + 'Z').toLocaleDateString(process.env.LOCALE === 'tr' ? 'tr-TR' : 'en-US') : '?';
    const reason = a.reason || t('moderation.noReason');
    const duration = a.duration ? ` (${a.duration})` : '';
    return `**#${a.id}** ${emoji} ${label}${duration} — ${reason}\n  <@${a.moderator_id}> • ${date}`;
  });

  const title = filterType
    ? t('moderation.modHistoryTitle', { user: targetUser.tag }) + ` [${getTypeLabel(filterType)}]`
    : t('moderation.modHistoryTitle', { user: targetUser.tag });

  return createEmbed({
    title,
    description: lines.join('\n\n') || t('moderation.noHistoryFound', { user: targetUser.tag }),
    color: 'orange',
    thumbnail: targetUser.displayAvatarURL({ dynamic: true, size: 64 }),
    footer: `${t('moderation.page')} ${page + 1}/${totalPages} • ${totalCount} ${t('moderation.totalActions')}`,
    timestamp: true,
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mod-history')
    .setDescription("View a user's full moderation history (Moderator+)")
    .addUserOption(opt =>
      opt.setName('user').setDescription('User to view history for').setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('type')
        .setDescription('Filter by action type')
        .setRequired(false)
        .addChoices(
          { name: 'Warn', value: 'warn' },
          { name: 'Mute', value: 'mute' },
          { name: 'Kick', value: 'kick' },
          { name: 'Ban', value: 'ban' },
          { name: 'Timeout', value: 'timeout' },
          { name: 'AI Flag', value: 'ai-flag' },
        )
    )
    .addBooleanOption(opt =>
      opt.setName('export').setDescription('Export history as a text file').setRequired(false)
    ),

  async execute(interaction) {
    if (!hasPermission(interaction.member, 'warn')) {
      return interaction.reply({ content: t('general.noPermission'), flags: MessageFlags.Ephemeral });
    }

    const targetUser = interaction.options.getUser('user');
    const filterType = interaction.options.getString('type');
    const exportFile = interaction.options.getBoolean('export');

    // ── Export mode ──────────────────────────────────────────────────────
    if (exportFile) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const allActions = filterType
        ? db.all(
            'SELECT * FROM mod_actions WHERE user_id = ? AND guild_id = ? AND action_type = ? ORDER BY created_at DESC',
            [targetUser.id, interaction.guild.id, filterType]
          )
        : db.all(
            'SELECT * FROM mod_actions WHERE user_id = ? AND guild_id = ? ORDER BY created_at DESC',
            [targetUser.id, interaction.guild.id]
          );

      if (allActions.length === 0) {
        return interaction.editReply({
          content: t('moderation.noHistoryFound', { user: targetUser.tag }),
        });
      }

      const lines = allActions.map(a => {
        const date = a.created_at ? new Date(a.created_at + 'Z').toISOString() : '?';
        return `#${a.id} | ${a.action_type.toUpperCase().padEnd(8)} | ${date} | Mod: ${a.moderator_id} | ${a.reason || 'No reason'}${a.duration ? ` | Duration: ${a.duration}` : ''}`;
      });

      const header = `Moderation History for ${targetUser.tag} (${targetUser.id})\nServer: ${interaction.guild.name}\nExported: ${new Date().toISOString()}\nTotal: ${allActions.length} action(s)${filterType ? ` (filtered: ${filterType})` : ''}\n${'='.repeat(80)}\n`;
      const content = header + lines.join('\n');

      const { AttachmentBuilder } = require('discord.js');
      const attachment = new AttachmentBuilder(Buffer.from(content, 'utf-8'), {
        name: `mod-history-${targetUser.id}.txt`,
      });

      return interaction.editReply({ files: [attachment] });
    }

    // ── Paginated view ───────────────────────────────────────────────────
    let currentPage = 0;
    const { rows, total } = getActions(targetUser.id, interaction.guild.id, filterType, currentPage);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    if (total === 0) {
      return interaction.reply({
        content: t('moderation.noHistoryFound', { user: targetUser.tag }),
        flags: MessageFlags.Ephemeral,
      });
    }

    const embed = buildPageEmbed(rows, targetUser, currentPage, totalPages, total, filterType);

    // Build navigation buttons
    function buildButtons(page) {
      return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('mod_history_prev')
          .setLabel('◀')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId('mod_history_page')
          .setLabel(`${page + 1}/${totalPages}`)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('mod_history_next')
          .setLabel('▶')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page >= totalPages - 1),
      );
    }

    const reply = await interaction.reply({
      embeds: [embed],
      components: totalPages > 1 ? [buildButtons(currentPage)] : [],
      flags: MessageFlags.Ephemeral,
    });

    if (totalPages <= 1) return;

    // Collector for button clicks
    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120000, // 2 minutes
    });

    collector.on('collect', async i => {
      if (i.customId === 'mod_history_prev' && currentPage > 0) {
        currentPage--;
      } else if (i.customId === 'mod_history_next' && currentPage < totalPages - 1) {
        currentPage++;
      }

      const { rows: newRows } = getActions(targetUser.id, interaction.guild.id, filterType, currentPage);
      const newEmbed = buildPageEmbed(newRows, targetUser, currentPage, totalPages, total, filterType);

      await i.update({
        embeds: [newEmbed],
        components: [buildButtons(currentPage)],
      });
    });

    collector.on('end', async () => {
      try {
        await interaction.editReply({ components: [] });
      } catch { /* message may have been deleted */ }
    });
  },
};
