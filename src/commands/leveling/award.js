const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/locale');
const leveling = require('../../systems/leveling');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('award')
    .setDescription('Award XP to a user (Owner only)')
    .addUserOption(opt =>
      opt.setName('user').setDescription('The user to award XP to').setRequired(true)
    )
    .addNumberOption(opt =>
      opt.setName('amount').setDescription('XP amount (max 30)').setRequired(true).setMinValue(0.1).setMaxValue(30)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const g = interaction.guild?.id;

    // Only server owner or DEBUG_OWNER_ID can use this
    const isOwner =
      interaction.user.id === interaction.guild.ownerId ||
      interaction.user.id === process.env.DEBUG_OWNER_ID;

    if (!isOwner) {
      return interaction.reply({
        content: t('award.ownerOnly', {}, g),
        ephemeral: true,
      });
    }

    const targetUser = interaction.options.getUser('user');
    const amount = interaction.options.getNumber('amount');

    const result = leveling.awardXp(targetUser.id, interaction.guild.id, amount);

    const fields = [
      { name: t('award.xpAwarded', {}, g), value: `+${amount}`, inline: true },
      { name: t('leveling.level', {}, g), value: `${result.newLevel}`, inline: true },
      { name: t('leveling.xp', {}, g), value: `${Math.round(result.xp * 10) / 10}`, inline: true },
    ];

    if (result.newLevel > result.oldLevel) {
      fields.push({
        name: t('leveling.levelUp', {}, g),
        value: `${result.oldLevel} → ${result.newLevel}`,
        inline: false,
      });
    }

    if (result.tierChanged && result.tier) {
      fields.push({
        name: t('leveling.tier', {}, g),
        value: `${result.tier.name}`,
        inline: true,
      });
    }

    const embed = createEmbed({
      title: t('award.title', { user: targetUser.username }, g),
      color: 'success',
      fields,
      thumbnail: targetUser.displayAvatarURL({ dynamic: true, size: 128 }),
      timestamp: true,
    });

    await interaction.reply({ embeds: [embed] });

    // Update tier role if needed
    if (result.tierChanged && result.tier) {
      try {
        const member = await interaction.guild.members.fetch(targetUser.id);
        await leveling.updateTierRole(member, result.tier);
      } catch (err) {
        console.error(`Failed to update tier role after award:`, err.message);
      }
    }
  },
};
