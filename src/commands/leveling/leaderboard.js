const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/locale');
const leveling = require('../../systems/leveling');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View members with the highest levels'),

  async execute(interaction) {
    const topUsers = leveling.getLeaderboard(interaction.guild.id, 10);

    if (topUsers.length === 0) {
      return interaction.reply({
        content: '📊 No one has earned XP yet!',
        flags: MessageFlags.Ephemeral,
      });
    }

    const medals = ['🥇', '🥈', '🥉'];

    const lines = await Promise.all(
      topUsers.map(async (user, index) => {
        const prefix = medals[index] || `**${index + 1}.**`;
        const tier = leveling.getTierForLevel(user.level);
        const tierText = tier ? ` (${tier.name})` : '';

        // Try to get username
        let username;
        try {
          const member = await interaction.guild.members.fetch(user.user_id);
          username = member.user.username;
        } catch {
          username = `<@${user.user_id}>`;
        }

        return `${prefix} **${username}** — ${t('leveling.level')} ${user.level}${tierText} • ${user.messages || 0} ${t('leveling.messages')}`;
      })
    );

    const embed = createEmbed({
      title: t('leveling.leaderboardTitle'),
      description: lines.join('\n'),
      color: 'primary',
      footer: `Top ${topUsers.length} members`,
      timestamp: true,
    });

    await interaction.reply({ embeds: [embed] });
  },
};
