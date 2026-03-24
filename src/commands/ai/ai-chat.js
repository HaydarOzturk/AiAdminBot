const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createEmbed } = require('../../utils/embedBuilder');
const { isConfigured } = require('../../utils/openrouter');
const { resetConversation } = require('../../systems/aiChat');
const { t } = require('../../utils/locale');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ai-chat')
    .setDescription('AI chat assistant settings')
    .addSubcommand(sub =>
      sub.setName('reset').setDescription('Reset AI chat history')
    )
    .addSubcommand(sub =>
      sub.setName('status').setDescription('Show AI chat status')
    ),

  async execute(interaction) {
    const g = interaction.guild?.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'reset') {
      resetConversation(interaction.user.id);
      await interaction.reply({
        content: t('aiChat.historyReset', {}, g),
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'status') {
      const configured = isConfigured();
      const enabled = process.env.AI_CHAT_ENABLED === 'true';
      const chatChannelName = process.env.AI_CHAT_CHANNEL || 'ai-sohbet';

      const embed = createEmbed({
        title: t('aiChat.statusTitle', {}, g),
        color: configured && enabled ? 'success' : 'danger',
        fields: [
          { name: t('aiChat.api', {}, g), value: configured ? t('general.connected', {}, g) : t('general.notConfigured', {}, g), inline: true },
          { name: t('aiChat.status', {}, g), value: enabled ? t('general.active', {}, g) : t('general.inactive', {}, g), inline: true },
          { name: t('aiChat.channel', {}, g), value: `#${chatChannelName}`, inline: true },
        ],
      });

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },
};
