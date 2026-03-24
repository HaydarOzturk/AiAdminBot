const { Events } = require('discord.js');
const { createEmbed } = require('../utils/embedBuilder');
const { t } = require('../utils/locale');
const { config } = require('../utils/permissions');

/**
 * Helper: find the channel-log channel
 */
function getLogChannel(guild) {
  const logChannelName = config.moderation?.logChannels?.channel || t('channelNames.channel-log');
  return guild.channels.cache.find(
    c => c.name === logChannelName && c.isTextBased()
  );
}

module.exports = [
  {
    name: Events.ChannelCreate,
    async execute(channel) {
      if (!channel.guild) return;

      const g = channel.guild?.id;
      const logChannel = getLogChannel(channel.guild);
      if (!logChannel) return;

      try {
        const embed = createEmbed({
          title: t('logging.channelCreated', {}, g),
          color: 'success',
          fields: [
            { name: t('logging.channel', {}, g), value: `${channel.name}\n<#${channel.id}>`, inline: true },
            { name: t('logging.type', {}, g), value: channelTypeName(channel.type, g), inline: true },
            { name: t('logging.channel', {}, g), value: channel.parent?.name || t('general.none', {}, g), inline: true },
          ],
          timestamp: true,
        });

        await logChannel.send({ embeds: [embed] });
      } catch (error) {
        console.error('❌ Failed to log channel create:', error.message);
      }
    },
  },
  {
    name: Events.ChannelDelete,
    async execute(channel) {
      if (!channel.guild) return;

      const g = channel.guild?.id;
      const logChannel = getLogChannel(channel.guild);
      if (!logChannel) return;

      try {
        const embed = createEmbed({
          title: t('logging.channelDeleted', {}, g),
          color: 'danger',
          fields: [
            { name: t('logging.channel', {}, g), value: channel.name, inline: true },
            { name: t('logging.type', {}, g), value: channelTypeName(channel.type, g), inline: true },
            { name: t('logging.channel', {}, g), value: channel.parent?.name || t('general.none', {}, g), inline: true },
          ],
          timestamp: true,
        });

        await logChannel.send({ embeds: [embed] });
      } catch (error) {
        console.error('❌ Failed to log channel delete:', error.message);
      }
    },
  },
  {
    name: Events.ChannelUpdate,
    async execute(oldChannel, newChannel) {
      if (!newChannel.guild) return;

      const g = newChannel.guild?.id;
      const logChannel = getLogChannel(newChannel.guild);
      if (!logChannel) return;

      const changes = [];

      if (oldChannel.name !== newChannel.name) {
        changes.push({ name: t('logging.oldName', {}, g), value: `${oldChannel.name} → ${newChannel.name}` });
      }

      if (oldChannel.topic !== newChannel.topic) {
        const oldTopic = oldChannel.topic || t('general.empty', {}, g);
        const newTopic = newChannel.topic || t('general.empty', {}, g);
        changes.push({ name: t('logging.topic', {}, g), value: `${oldTopic} → ${newTopic}` });
      }

      if (oldChannel.parentId !== newChannel.parentId) {
        const oldCat = oldChannel.parent?.name || t('general.none', {}, g);
        const newCat = newChannel.parent?.name || t('general.none', {}, g);
        changes.push({ name: t('logging.channel', {}, g), value: `${oldCat} → ${newCat}` });
      }

      if (oldChannel.nsfw !== newChannel.nsfw) {
        changes.push({ name: 'NSFW', value: `${oldChannel.nsfw} → ${newChannel.nsfw}` });
      }

      // Only log if something visible changed
      if (changes.length === 0) return;

      try {
        const fields = [
          { name: t('logging.channel', {}, g), value: `<#${newChannel.id}>`, inline: true },
          ...changes.map(c => ({ name: c.name, value: c.value, inline: true })),
        ];

        const embed = createEmbed({
          title: t('logging.channelUpdated', {}, g),
          color: 'info',
          fields,
          timestamp: true,
        });

        await logChannel.send({ embeds: [embed] });
      } catch (error) {
        console.error('❌ Failed to log channel update:', error.message);
      }
    },
  },
];

function channelTypeName(type, guildId) {
  const { ChannelType } = require('discord.js');
  const names = {
    [ChannelType.GuildText]: t('channelTypes.text', {}, guildId),
    [ChannelType.GuildVoice]: t('channelTypes.voice', {}, guildId),
    [ChannelType.GuildCategory]: t('channelTypes.category', {}, guildId),
    [ChannelType.GuildAnnouncement]: t('channelTypes.announcement', {}, guildId),
    [ChannelType.GuildStageVoice]: t('channelTypes.stage', {}, guildId),
    [ChannelType.GuildForum]: t('channelTypes.forum', {}, guildId),
  };
  return names[type] || t('channelTypes.other', {}, guildId);
}
