const { SlashCommandBuilder, MessageFlags, AttachmentBuilder } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { t } = require('../../utils/locale');
const { exportTemplate } = require('../../systems/templateManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('template-export')
    .setDescription('Export current server structure as a JSON template (Owner)')
    .setDefaultMemberPermissions(0x0000000000000008), // Administrator

  async execute(interaction) {
    if (!hasPermission(interaction.member, 'setup-server')) {
      return interaction.reply({
        content: t('setup.ownerOnly'),
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const template = exportTemplate(interaction.guild);
      const json = JSON.stringify(template, null, 2);

      const attachment = new AttachmentBuilder(Buffer.from(json, 'utf-8'), {
        name: `${interaction.guild.name.replace(/[^a-zA-Z0-9]/g, '-')}-template.json`,
      });

      const catCount = template.categories.length;
      const channelCount = template.categories.reduce((a, c) => a + (c.channels?.length || 0), 0);
      const roleCount = template.roles.length;

      await interaction.editReply({
        content: t('template.exportSuccess', {
          categories: catCount,
          channels: channelCount,
          roles: roleCount,
        }),
        files: [attachment],
      });
    } catch (err) {
      console.error('Template export failed:', err);
      await interaction.editReply({
        content: t('template.exportFailed', { error: err.message }),
      });
    }
  },
};
