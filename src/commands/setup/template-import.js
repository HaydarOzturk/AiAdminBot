const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { createEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/locale');
const { validateTemplate, previewImport, importTemplate } = require('../../systems/templateManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('template-import')
    .setDescription('Import a server structure from a JSON template file (Owner)')
    .setDefaultMemberPermissions(0x0000000000000008) // Administrator
    .addAttachmentOption(opt =>
      opt.setName('file').setDescription('JSON template file').setRequired(true)
    ),

  async execute(interaction) {
    const g = interaction.guild?.id;
    if (!hasPermission(interaction.member, 'setup-server')) {
      return interaction.reply({
        content: t('setup.ownerOnly', {}, g),
        flags: MessageFlags.Ephemeral,
      });
    }

    const attachment = interaction.options.getAttachment('file');

    // Validate file
    if (!attachment.name.endsWith('.json')) {
      return interaction.reply({
        content: t('template.mustBeJson', {}, g),
        flags: MessageFlags.Ephemeral,
      });
    }

    if (attachment.size > 512000) { // 500KB max
      return interaction.reply({
        content: t('template.fileTooLarge', {}, g),
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // Download and parse the template
      const response = await fetch(attachment.url);
      const json = await response.text();
      const template = JSON.parse(json);

      // Validate structure
      const validation = validateTemplate(template);
      if (!validation.valid) {
        return interaction.editReply({
          content: t('template.invalidTemplate', { errors: validation.errors.join(', ') }, g),
        });
      }

      // Preview what will be created
      const preview = previewImport(template, interaction.guild);

      const embed = createEmbed({
        title: t('template.previewTitle', {}, g),
        description: t('template.previewDescription', { name: preview.templateName }, g),
        color: 'primary',
        fields: [
          { name: t('template.newRoles', {}, g), value: `${preview.newRoles}`, inline: true },
          { name: t('template.existingRoles', {}, g), value: `${preview.existingRoleCount}`, inline: true },
          { name: t('template.newCategories', {}, g), value: `${preview.newCategories}`, inline: true },
          { name: t('template.newChannels', {}, g), value: `${preview.newChannels}`, inline: true },
          { name: t('template.existingChannels', {}, g), value: `${preview.existingChannelCount}`, inline: true },
          { name: t('template.locale', {}, g), value: preview.locale, inline: true },
        ],
        footer: t('template.previewFooter', {}, g),
        timestamp: true,
      });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('template_confirm')
          .setLabel(t('template.confirmImport', {}, g))
          .setStyle(ButtonStyle.Success)
          .setEmoji('✅'),
        new ButtonBuilder()
          .setCustomId('template_cancel')
          .setLabel(t('template.cancelImport', {}, g))
          .setStyle(ButtonStyle.Danger)
          .setEmoji('❌'),
      );

      const reply = await interaction.editReply({
        embeds: [embed],
        components: [row],
      });

      // Wait for confirmation
      const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
      });

      collector.on('collect', async i => {
        collector.stop();

        if (i.customId === 'template_cancel') {
          return i.update({
            content: t('template.importCancelled', {}, g),
            embeds: [],
            components: [],
          });
        }

        // Confirmed — import the template
        await i.update({
          content: t('template.importing', {}, g),
          embeds: [],
          components: [],
        });

        try {
          const results = await importTemplate(template, interaction.guild);

          const resultEmbed = createEmbed({
            title: t('template.importCompleteTitle', {}, g),
            color: results.errors.length > 0 ? 'warning' : 'success',
            fields: [
              { name: t('template.rolesCreated', {}, g), value: `${results.rolesCreated}`, inline: true },
              { name: t('template.categoriesCreated', {}, g), value: `${results.categoriesCreated}`, inline: true },
              { name: t('template.channelsCreated', {}, g), value: `${results.channelsCreated}`, inline: true },
            ],
            timestamp: true,
          });

          if (results.errors.length > 0) {
            resultEmbed.addFields({
              name: t('template.importErrors', {}, g),
              value: results.errors.slice(0, 5).join('\n'),
              inline: false,
            });
          }

          await interaction.editReply({ content: null, embeds: [resultEmbed] });
        } catch (err) {
          console.error('Template import failed:', err);
          await interaction.editReply({
            content: t('template.importFailed', { error: err.message }, g),
          });
        }
      });

      collector.on('end', (collected, reason) => {
        if (reason === 'time') {
          interaction.editReply({
            content: t('template.importTimedOut', {}, g),
            embeds: [],
            components: [],
          }).catch(() => {});
        }
      });
    } catch (err) {
      console.error('Template parse failed:', err);
      await interaction.editReply({
        content: t('template.parseFailed', { error: err.message }, g),
      });
    }
  },
};
