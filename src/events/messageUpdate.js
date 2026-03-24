const { Events } = require('discord.js');
const { createEmbed } = require('../utils/embedBuilder');
const { t, channelName } = require('../utils/locale');
const { config } = require('../utils/permissions');

module.exports = {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    // Ignore bot messages and DMs
    if (!newMessage.guild) return;
    if (newMessage.author?.bot) return;

    // Partial messages — try to fetch
    if (oldMessage.partial) {
      try {
        await oldMessage.fetch();
      } catch {
        return; // Can't fetch old message, skip
      }
    }

    // If content didn't actually change (could be embed loading), skip
    if (oldMessage.content === newMessage.content) return;

    const g = newMessage.guild?.id;

    try {
      const logChannelName = config.moderation?.logChannels?.message || channelName('message-log', g);
      const logChannel = newMessage.guild.channels.cache.find(
        c => c.name === logChannelName && c.isTextBased()
      );

      if (!logChannel) return;

      const oldContent = oldMessage.content || t('general.empty', {}, g);
      const newContent = newMessage.content || t('general.empty', {}, g);

      // Truncate long messages
      const displayOld = oldContent.length > 512 ? oldContent.slice(0, 509) + '...' : oldContent;
      const displayNew = newContent.length > 512 ? newContent.slice(0, 509) + '...' : newContent;

      const embed = createEmbed({
        title: t('logging.messageEdited', {}, g),
        color: 'warning',
        fields: [
          { name: t('logging.author', {}, g), value: `${newMessage.author.tag}\n<@${newMessage.author.id}>`, inline: true },
          { name: t('logging.channel', {}, g), value: `<#${newMessage.channel.id}>`, inline: true },
          { name: t('logging.oldContent', {}, g), value: displayOld, inline: false },
          { name: t('logging.newContent', {}, g), value: displayNew, inline: false },
        ],
        footer: `${t('general.messageId', {}, g)}: ${newMessage.id}`,
        timestamp: true,
      });

      await logChannel.send({ embeds: [embed] });
    } catch (error) {
      console.error('❌ Failed to log message edit:', error.message);
    }
  },
};
