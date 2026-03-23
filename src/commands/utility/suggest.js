const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createEmbed } = require('../../utils/embedBuilder');
const { t, channelName } = require('../../utils/locale');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription(t('suggest.commandDesc'))
    .addStringOption(opt =>
      opt.setName('message').setDescription(t('suggest.messageOption')).setRequired(true)
    ),

  async execute(interaction) {
    const suggestion = interaction.options.getString('message');

    if (suggestion.length < 10) {
      return interaction.reply({
        content: t('suggest.tooShort'),
        flags: MessageFlags.Ephemeral,
      });
    }

    if (suggestion.length > 1500) {
      return interaction.reply({
        content: t('suggest.tooLong'),
        flags: MessageFlags.Ephemeral,
      });
    }

    // Find the staff channel — scan all locale names for staff-chat
    const guild = interaction.guild;
    let staffChannel = null;

    // Collect all possible staff-chat channel names from all locales
    const possibleNames = new Set();
    possibleNames.add(channelName('staff-chat'));
    possibleNames.add('staff-chat');
    possibleNames.add('staff-sohbet');

    // Scan all locale files for staff-chat names
    const fs = require('fs');
    const path = require('path');
    const { localesDir } = require('../../utils/paths');

    try {
      const locDir = localesDir();
      const files = fs.readdirSync(locDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(locDir, file), 'utf-8'));
          if (data.channelNames?.['staff-chat']) {
            possibleNames.add(data.channelNames['staff-chat']);
          }
        } catch { /* skip */ }
      }
    } catch { /* locales dir not found */ }

    // Find the first matching channel
    staffChannel = guild.channels.cache.find(
      c => possibleNames.has(c.name) && c.isTextBased()
    );

    if (!staffChannel) {
      return interaction.reply({
        content: t('suggest.noStaffChannel'),
        flags: MessageFlags.Ephemeral,
      });
    }

    // Build the suggestion embed
    const embed = createEmbed({
      title: t('suggest.newSuggestion'),
      description: suggestion,
      color: 'primary',
      fields: [
        { name: t('suggest.from'), value: `${interaction.user.tag}\n<@${interaction.user.id}>`, inline: true },
        { name: t('suggest.channel'), value: `<#${interaction.channel.id}>`, inline: true },
      ],
      thumbnail: interaction.user.displayAvatarURL({ dynamic: true, size: 128 }),
      timestamp: true,
    });

    try {
      await staffChannel.send({ embeds: [embed] });

      await interaction.reply({
        content: t('suggest.sent'),
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      console.error('Suggest command error:', err.message);
      await interaction.reply({
        content: t('suggest.sendFailed'),
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
