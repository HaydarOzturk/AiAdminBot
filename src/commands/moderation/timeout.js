const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { createEmbed } = require('../../utils/embedBuilder');
const { sendModLog, logModAction } = require('../../utils/modLogger');
const { t } = require('../../utils/locale');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a user (Admin+)')
    .addUserOption(opt =>
      opt.setName('user').setDescription('User to timeout').setRequired(true)
    )
    .addIntegerOption(opt =>
      opt
        .setName('duration')
        .setDescription('Duration (minutes)')
        .setRequired(true)
        .addChoices(
          { name: '1 minute', value: 1 },
          { name: '5 minutes', value: 5 },
          { name: '10 minutes', value: 10 },
          { name: '30 minutes', value: 30 },
          { name: '1 hour', value: 60 },
          { name: '1 day', value: 1440 },
          { name: '1 week', value: 10080 }
        )
    )
    .addStringOption(opt =>
      opt.setName('reason').setDescription('Timeout reason').setRequired(false)
    ),

  async execute(interaction) {
    const g = interaction.guild?.id;
    if (!hasPermission(interaction.member, 'timeout')) {
      return interaction.reply({ content: t('general.noPermission', {}, g), flags: MessageFlags.Ephemeral });
    }

    const targetUser = interaction.options.getUser('user');
    const durationMinutes = interaction.options.getInteger('duration');
    const reason = interaction.options.getString('reason') || t('moderation.noReason', {}, g);
    const durationMs = durationMinutes * 60 * 1000;

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (!member) {
      return interaction.reply({ content: t('moderation.userNotFound', {}, g), flags: MessageFlags.Ephemeral });
    }

    if (targetUser.id === interaction.user.id) {
      return interaction.reply({ content: t('moderation.cannotTimeoutSelf', {}, g), flags: MessageFlags.Ephemeral });
    }

    if (!member.moderatable) {
      return interaction.reply({ content: t('moderation.cannotTimeoutUser', {}, g), flags: MessageFlags.Ephemeral });
    }

    let durationText;
    if (durationMinutes >= 1440) durationText = t('time.days', { count: durationMinutes / 1440 }, g);
    else if (durationMinutes >= 60) durationText = t('time.hours', { count: durationMinutes / 60 }, g);
    else durationText = t('time.minutes', { count: durationMinutes }, g);

    try {
      await member.timeout(durationMs, reason);

      const caseId = logModAction('timeout', targetUser.id, interaction.guild.id, interaction.user.id, reason, durationText);

      const embed = createEmbed({
        title: t('moderation.timeoutTitle', {}, g),
        color: 'orange',
        fields: [
          { name: t('moderation.user', {}, g), value: `${targetUser} (${targetUser.tag})`, inline: true },
          { name: t('moderation.moderator', {}, g), value: `${interaction.user}`, inline: true },
          { name: t('moderation.reason', {}, g), value: reason, inline: false },
          { name: t('moderation.duration', {}, g), value: durationText, inline: true },
          { name: t('moderation.caseId', {}, g), value: `#${caseId}`, inline: true },
        ],
        timestamp: true,
      });

      await interaction.reply({ embeds: [embed] });

      await sendModLog(interaction.guild, 'punishment', {
        title: t('moderation.timeoutTitle', {}, g),
        color: 'orange',
        targetUser,
        moderator: interaction.user,
        reason,
        duration: durationText,
        caseId: String(caseId),
      });
    } catch (err) {
      console.error('Timeout failed:', err);
      await interaction.reply({ content: t('moderation.timeoutFailed', { error: err.message }, g), flags: MessageFlags.Ephemeral });
    }
  },
};
