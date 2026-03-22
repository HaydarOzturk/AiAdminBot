const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { t } = require('../../utils/locale');
const aiSetup = require('../../systems/aiSetup');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ai-setup')
    .setDescription('Start AI-powered server setup (Owner only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt
        .setName('mode')
        .setDescription('Setup mode')
        .setRequired(false)
        .addChoices(
          { name: '⚡ Default Setup (Recommended)', value: 'default' },
          { name: '🤖 Custom Setup (AI Interview)', value: 'custom' }
        )
    )
    .addStringOption(opt =>
      opt
        .setName('language')
        .setDescription('Server language (including channel names)')
        .setRequired(false)
        .addChoices(
          { name: '🇹🇷 Türkçe', value: 'tr' },
          { name: '🇬🇧 English', value: 'en' },
          { name: '🇩🇪 Deutsch', value: 'de' },
          { name: '🇪🇸 Español', value: 'es' },
          { name: '🇫🇷 Français', value: 'fr' },
          { name: '🇧🇷 Português', value: 'pt' },
          { name: '🇷🇺 Русский', value: 'ru' },
          { name: '🇸🇦 العربية', value: 'ar' }
        )
    ),

  async execute(interaction) {
    if (!hasPermission(interaction.member, 'setup-server')) {
      return interaction.reply({
        content: t('setup.ownerOnly'),
        flags: MessageFlags.Ephemeral,
      });
    }

    const mode = interaction.options.getString('mode') || 'default';
    const language = interaction.options.getString('language') || 'tr';

    if (mode === 'default') {
      // Default mode: apply the recommended server config with localized channel names
      await aiSetup.runDefaultSetup(interaction, language);
    } else {
      // Custom mode: start the AI interview
      await aiSetup.startInterview(interaction, language);
    }
  },
};
