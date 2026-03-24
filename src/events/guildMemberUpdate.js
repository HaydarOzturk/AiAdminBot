const { Events } = require('discord.js');
const { createEmbed } = require('../utils/embedBuilder');
const { t, channelName } = require('../utils/locale');
const { config } = require('../utils/permissions');

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    const g = newMember.guild?.id;
    // ── 1. Role changes → #rol-log ─────────────────────────────────────────
    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;

    const addedRoles = newRoles.filter(r => !oldRoles.has(r.id));
    const removedRoles = oldRoles.filter(r => !newRoles.has(r.id));

    if (addedRoles.size > 0 || removedRoles.size > 0) {
      try {
        const logChannelName = config.moderation?.logChannels?.role || channelName('role-log', g);
        const logChannel = newMember.guild.channels.cache.find(
          c => c.name === logChannelName && c.isTextBased()
        );

        if (logChannel) {
          const fields = [
            { name: t('moderation.user', {}, g), value: `${newMember.user.tag}\n<@${newMember.id}>`, inline: true },
          ];

          if (addedRoles.size > 0) {
            fields.push({
              name: t('logging.addedRole', {}, g),
              value: addedRoles.map(r => r.name).join(', '),
              inline: true,
            });
          }

          if (removedRoles.size > 0) {
            fields.push({
              name: t('logging.removedRole', {}, g),
              value: removedRoles.map(r => r.name).join(', '),
              inline: true,
            });
          }

          const embed = createEmbed({
            title: t('logging.roleChanged', {}, g),
            color: addedRoles.size > 0 ? 'success' : 'danger',
            fields,
            thumbnail: newMember.user.displayAvatarURL({ dynamic: true, size: 64 }),
            timestamp: true,
          });

          await logChannel.send({ embeds: [embed] });
        }
      } catch (error) {
        console.error('❌ Failed to log role change:', error.message);
      }
    }

    // ── 2. Nickname changes → #isim-log ─────────────────────────────────────
    if (oldMember.nickname !== newMember.nickname) {
      try {
        const logChannelName = config.moderation?.logChannels?.name || channelName('name-log', g);
        const logChannel = newMember.guild.channels.cache.find(
          c => c.name === logChannelName && c.isTextBased()
        );

        if (logChannel) {
          const oldNick = oldMember.nickname || oldMember.user.username;
          const newNick = newMember.nickname || newMember.user.username;

          const embed = createEmbed({
            title: t('logging.nicknameChanged', {}, g),
            color: 'info',
            fields: [
              { name: t('moderation.user', {}, g), value: `<@${newMember.id}>`, inline: true },
              { name: t('logging.oldNickname', {}, g), value: oldNick, inline: true },
              { name: t('logging.newNickname', {}, g), value: newNick, inline: true },
            ],
            timestamp: true,
          });

          await logChannel.send({ embeds: [embed] });
        }
      } catch (error) {
        console.error('❌ Failed to log nickname change:', error.message);
      }
    }
  },
};
