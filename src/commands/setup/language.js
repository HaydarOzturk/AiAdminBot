const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createEmbed } = require('../../utils/embedBuilder');
const { t, setGuildLocale, getGuildLocale } = require('../../utils/locale');

// Supported languages with display labels
const LANGUAGES = [
  { value: 'tr', label: 'Türkçe', flag: '🇹🇷' },
  { value: 'en', label: 'English', flag: '🇬🇧' },
  { value: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { value: 'es', label: 'Español', flag: '🇪🇸' },
  { value: 'fr', label: 'Français', flag: '🇫🇷' },
  { value: 'pt', label: 'Português', flag: '🇧🇷' },
  { value: 'ru', label: 'Русский', flag: '🇷🇺' },
  { value: 'ar', label: 'العربية', flag: '🇸🇦' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('language')
    .setDescription('Change the bot language for this server')
    .addStringOption(opt =>
      opt
        .setName('lang')
        .setDescription('Select a language')
        .setRequired(true)
        .addChoices(...LANGUAGES.map(l => ({ name: `${l.flag} ${l.label}`, value: l.value })))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const g = interaction.guild?.id;
    const newLocale = interaction.options.getString('lang');
    const oldLocale = getGuildLocale(g) || process.env.LOCALE || 'tr';

    // Save to DB + cache
    setGuildLocale(g, newLocale);

    const langInfo = LANGUAGES.find(l => l.value === newLocale);
    const langDisplay = langInfo ? `${langInfo.flag} ${langInfo.label}` : newLocale;

    // Reply using the NEW locale so the user sees the confirmation in their chosen language
    const embed = createEmbed({
      title: t('language.changed', {}, g),
      description: t('language.changedDesc', { language: langDisplay }, g),
      color: 'success',
      timestamp: true,
    });

    await interaction.reply({ embeds: [embed] });
  },
};
