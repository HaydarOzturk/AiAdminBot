const { SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/locale');
const leveling = require('../../systems/leveling');
const { getLiveVoiceMinutes } = require('../../systems/voiceXp');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('View your level and XP info')
    .addUserOption(opt =>
      opt.setName('user').setDescription("View another user's level").setRequired(false)
    ),

  async execute(interaction) {
    const g = interaction.guild?.id;
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const data = leveling.getUserData(targetUser.id, interaction.guild.id);

    // Build a simple XP progress bar
    const progress = data.xpNeeded > 0 ? data.xp / data.xpNeeded : 0;
    const barLength = 12;
    const filled = Math.round(progress * barLength);
    const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);

    // Format voice time nicely (DB stored + current live session)
    const liveMinutes = getLiveVoiceMinutes(interaction.guild.id, targetUser.id);
    const voiceMinutes = (data.voiceMinutes || 0) + liveMinutes;
    let voiceTimeStr;
    if (voiceMinutes < 60) {
      voiceTimeStr = `${voiceMinutes}m`;
    } else {
      const hours = Math.floor(voiceMinutes / 60);
      const mins = voiceMinutes % 60;
      voiceTimeStr = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }

    const fields = [
      { name: t('leveling.level', {}, g), value: `${data.level}`, inline: true },
      { name: t('leveling.xp', {}, g), value: `${data.xp} / ${data.xpNeeded}`, inline: true },
      { name: t('leveling.rank', {}, g), value: data.rank ? `#${data.rank}` : '-', inline: true },
      { name: t('leveling.progress', {}, g), value: `${bar} ${Math.round(progress * 100)}%`, inline: false },
      { name: t('leveling.messages', {}, g), value: `${data.messages}`, inline: true },
      { name: t('leveling.voiceTime', {}, g), value: `🔊 ${voiceTimeStr}`, inline: true },
      { name: t('leveling.tier', {}, g), value: data.tier?.name || '-', inline: true },
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
