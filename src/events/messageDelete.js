const { Events } = require('discord.js');
const { createEmbed } = require('../utils/embedBuilder');
const { t, channelName } = require('../utils/locale');
const { config } = require('../utils/permissions');

module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    // Ignore bot messages and DMs
    if (!message.guild) return;
    if (message.author?.bot) return;

    // Partial messages may not have content
    if (message.partial) return;

    const g = message.guild?.id;

    try {
      const logChannelName = config.moderation?.logChannels?.message || channelName('message-log', g);
      const logChannel = message.guild.channels.cache.find(
        c => c.name === logChannelName && c.isTextBased()
      );

      if (!logChannel) return;

      const content = message.content || t('general.noContent', {}, g);
      // Truncate long messages
      const displayContent = content.length > 1024 ? content.slice(0, 1021) + '...' : content;

      const fields = [
        { name: t('logging.author', {}, g), value: `${message.author.tag}\n<@${message.author.id}>`, inline: true },
        { name: t('logging.channel', {}, g), value: `<#${message.channel.id}>`, inline: true },
        { name: t('logging.oldContent', {}, g), value: displayContent, inline: false },
      ];

      // If the message had attachments, note them
      if (message.attachments.size > 0) {
        const attachmentList = message.attachments.map(a => a.name).join(', ');
        fields.push({ name: t('general.attachments', {}, g), value: attachmentList, inline: false });
      }

      const embed = createEmbed({
        title: t('logging.messageDeleted', {}, g),
        color: 'danger',
        fields,
        timestamp: true,
      });

      await logChannel.send({ embeds: [embed] });
    } catch (error) {
      console.error('❌ Failed to log message delete:', error.message);
    }
  },
};
