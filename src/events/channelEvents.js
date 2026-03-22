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

      const logChannel = getLogChannel(channel.guild);
      if (!logChannel) return;

      try {
        const embed = createEmbed({
          title: t('logging.channelCreated'),
          color: 'success',
          fields: [
            { name: t('logging.channel'), value: `${channel.name}\n<#${channel.id}>`, inline: true },
            { name: t('logging.type'), value: channelTypeName(channel.type), inline: true },
            { name: t('logging.channel'), value: channel.parent?.name || t('general.none'), inline: true },
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

      const logChannel = getLogChannel(channel.guild);
      if (!logChannel) return;

      try {
        const embed = createEmbed({
          title: t('logging.channelDeleted'),
          color: 'danger',
          fields: [
            { name: t('logging.channel'), value: channel.name, inline: true },
            { name: t('logging.type'), value: channelTypeName(channel.type), inline: true },
            { name: t('logging.channel'), value: channel.parent?.name || t('general.none'), inline: true },
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

      const logChannel = getLogChannel(newChannel.guild);
      if (!logChannel) return;

      const changes = [];

      if (oldChannel.name !== newChannel.name) {
        changes.push({ name: t('logging.oldName'), value: `${oldChannel.name} → ${newChannel.name}` });
      }

      if (oldChannel.topic !== newChannel.topic) {
        const oldTopic = oldChannel.topic || t('general.empty');
        const newTopic = newChannel.topic || t('general.empty');
        changes.push({ name: t('logging.topic'), value: `${oldTopic} → ${newTopic}` });
      }

      if (oldChannel.parentId !== newChannel.parentId) {
        const oldCat = oldChannel.parent?.name || t('general.none');
        const newCat = newChannel.parent?.name || t('general.none');
        changes.push({ name: t('logging.channel'), value: `${oldCat} → ${newCat}` });
      }

      if (oldChannel.nsfw !== newChannel.nsfw) {
        changes.push({ name: 'NSFW', value: `${oldChannel.nsfw} → ${newChannel.nsfw}` });
      }

      // Only log if something visible changed
      if (changes.length === 0) return;

      try {
        const fields = [
          { name: t('logging.channel'), value: `<#${newChannel.id}>`, inline: true },
          ...changes.map(c => ({ name: c.name, value: c.value, inline: true })),
        ];

        const embed = createEmbed({
          title: t('logging.channelUpdated'),
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

function channelTypeName(type) {
  const { ChannelType } = require('discord.js');
  const names = {
    [ChannelType.GuildText]: t('channelTypes.text'),
    [ChannelType.GuildVoice]: t('channelTypes.voice'),
    [ChannelType.GuildCategory]: t('channelTypes.category'),
    [ChannelType.GuildAnnouncement]: t('channelTypes.announcement'),
    [ChannelType.GuildStageVoice]: t('channelTypes.stage'),
    [ChannelType.GuildForum]: t('channelTypes.forum'),
  };
  return names[type] || t('channelTypes.other');
}
