const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { createEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/locale');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription("View a user's warnings (Moderator+)")
    .addUserOption(opt =>
      opt.setName('user').setDescription('User to view warnings for').setRequired(true)
    ),

  async execute(interaction) {
    if (!hasPermission(interaction.member, 'warn')) {
      return interaction.reply({ content: t('general.noPermission'), flags: MessageFlags.Ephemeral });
    }

    const targetUser = interaction.options.getUser('user');

    const warnings = db.all(
      'SELECT * FROM warnings WHERE user_id = ? AND guild_id = ? ORDER BY created_at DESC LIMIT 10',
      [targetUser.id, interaction.guild.id]
    );

    if (warnings.length === 0) {
      return interaction.reply({
        content: t('moderation.noWarningsFound', { user: targetUser.tag }),
        flags: MessageFlags.Ephemeral,
      });
    }

    const countRow = db.get(
      'SELECT COUNT(*) as count FROM warnings WHERE user_id = ? AND guild_id = ?',
      [targetUser.id, interaction.guild.id]
    );
    const totalCount = countRow ? countRow.count : warnings.length;

    const warningList = warnings.map((w, i) => {
      const date = w.created_at ? new Date(w.created_at + 'Z').toLocaleDateString(process.env.LOCALE === 'tr' ? 'tr-TR' : 'en-US') : '?';
      return `**${i + 1}.** ${w.reason || t('moderation.noReason')} — <@${w.moderator_id}> (${date})`;
    });

    const embed = createEmbed({
      title: t('moderation.warningsTitle', { user: targetUser.tag }),
      description: warningList.join('\n'),
      color: 'warning',
      fields: [
        { name: t('moderation.totalWarnings'), value: `${totalCount}`, inline: true },
      ],
      timestamp: true,
    });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
