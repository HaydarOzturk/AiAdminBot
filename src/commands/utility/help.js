const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/locale');
const { getInviteLink } = require('../../utils/inviteLink');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show bot commands and features'),

  async execute(interaction) {
    const embed = createEmbed({
      title: t('help.title'),
      description: t('help.description'),
      color: 'primary',
      fields: [
        {
          name: t('help.verification'),
          value: t('help.verificationValue'),
          inline: false,
        },
        {
          name: t('help.roleManagement'),
          value: t('help.roleManagementValue'),
          inline: false,
        },
        {
          name: t('help.moderation'),
          value: t('help.moderationValue'),
          inline: false,
        },
        {
          name: t('help.modLogs'),
          value: t('help.modLogsValue'),
          inline: false,
        },
        {
          name: t('help.leveling'),
          value: t('help.levelingValue'),
          inline: false,
        },
        {
          name: t('help.setup'),
          value: t('help.setupValue'),
          inline: false,
        },
        {
          name: t('help.aiFeatures'),
          value: t('help.aiFeaturesValue'),
          inline: false,
        },
        {
          name: t('help.suggestFeature'),
          value: t('help.suggestValue'),
          inline: false,
        },
        {
          name: t('help.info'),
          value: t('help.infoValue'),
          inline: false,
        },
      ],
      footer: t('help.footer'),
    });

    // Build reply components — add invite button if we have a client ID
    const components = [];
    const inviteUrl = getInviteLink(interaction.client);
    if (inviteUrl) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel(t('help.inviteButton'))
          .setStyle(ButtonStyle.Link)
          .setURL(inviteUrl)
          .setEmoji('🔗')
      );
      components.push(row);
    }

    await interaction.reply({
      embeds: [embed],
      components,
      flags: MessageFlags.Ephemeral,
    });
  },
};
