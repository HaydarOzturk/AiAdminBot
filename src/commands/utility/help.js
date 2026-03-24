const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/locale');
const { getInviteLink } = require('../../utils/inviteLink');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show bot commands and features'),

  async execute(interaction) {
    const g = interaction.guild?.id;
    const embed = createEmbed({
      title: t('help.title', {}, g),
      description: t('help.description', {}, g),
      color: 'primary',
      fields: [
        {
          name: t('help.verification', {}, g),
          value: t('help.verificationValue', {}, g),
          inline: false,
        },
        {
          name: t('help.roleManagement', {}, g),
          value: t('help.roleManagementValue', {}, g),
          inline: false,
        },
        {
          name: t('help.moderation', {}, g),
          value: t('help.moderationValue', {}, g),
          inline: false,
        },
        {
          name: t('help.modLogs', {}, g),
          value: t('help.modLogsValue', {}, g),
          inline: false,
        },
        {
          name: t('help.leveling', {}, g),
          value: t('help.levelingValue', {}, g),
          inline: false,
        },
        {
          name: t('help.setup', {}, g),
          value: t('help.setupValue', {}, g),
          inline: false,
        },
        {
          name: t('help.aiFeatures', {}, g),
          value: t('help.aiFeaturesValue', {}, g),
          inline: false,
        },
        {
          name: t('help.suggestFeature', {}, g),
          value: t('help.suggestValue', {}, g),
          inline: false,
        },
        {
          name: t('help.info', {}, g),
          value: t('help.infoValue', {}, g),
          inline: false,
        },
      ],
      footer: t('help.footer', {}, g),
    });

    // Build reply components — add invite button if we have a client ID
    const components = [];
    const inviteUrl = getInviteLink(interaction.client);
    if (inviteUrl) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel(t('help.inviteButton', {}, g))
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
