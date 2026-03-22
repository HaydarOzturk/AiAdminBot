const { SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/locale');
const leveling = require('../../systems/leveling');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('View your level and XP info')
    .addUserOption(opt =>
      opt.setName('user').setDescription("View another user's level").setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const data = leveling.getUserData(targetUser.id, interaction.guild.id);

    // Build a simple XP progress bar
    const progress = data.xpNeeded > 0 ? data.xp / data.xpNeeded : 0;
    const barLength = 12;
    const filled = Math.round(progress * barLength);
    const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);

    const fields = [
      { name: t('leveling.level'), value: `${data.level}`, inline: true },
      { name: t('leveling.xp'), value: `${data.xp} / ${data.xpNeeded}`, inline: true },
      { name: t('leveling.rank'), value: data.rank ? `#${data.rank}` : '-', inline: true },
      { name: t('leveling.progress'), value: `${bar} ${Math.round(progress * 100)}%`, inline: false },
      { name: t('leveling.messages'), value: `${data.messages}`, inline: true },
      { name: t('leveling.tier'), value: data.tier?.name || '-', inline: true },
    ];

    const embed = createEmbed({
      title: `📊 ${targetUser.username}`,
      color: 'primary',
      fields,
      thumbnail: targetUser.displayAvatarURL({ dynamic: true, size: 128 }),
      timestamp: true,
    });

    // Set tier color if available
    if (data.tier?.color) {
      embed.setColor(data.tier.color);
    }

    await interaction.reply({ embeds: [embed] });
  },
};
