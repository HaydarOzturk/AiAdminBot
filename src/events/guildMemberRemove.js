const { Events } = require('discord.js');
const { createEmbed } = require('../utils/embedBuilder');
const { t, channelName } = require('../utils/locale');
const { config } = require('../utils/permissions');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    const g = member.guild?.id;
    console.log(`👤 Member left: ${member.user.tag}`);

    // Log to join/leave log channel
    try {
      const logChannelName = config.moderation?.logChannels?.joinLeave || channelName('join-leave-log', g);
      const logChannel = member.guild.channels.cache.find(
        c => c.name === logChannelName
      );

      if (logChannel) {
        const roles = member.roles.cache
          .filter(r => r.name !== '@everyone')
          .map(r => r.name)
          .join(', ') || t('general.none', {}, g);

        const joinedAgo = member.joinedTimestamp
          ? `${Math.floor((Date.now() - member.joinedTimestamp) / 86400000)} days ago`
          : t('general.unknown', {}, g);

        const embed = createEmbed({
          title: t('logging.memberLeft', {}, g),
          color: 'danger',
          fields: [
            { name: t('moderation.user', {}, g), value: `${member.user.tag}` },
            { name: t('goodbye.roles', {}, g), value: roles },
            { name: t('goodbye.joinedAgo', {}, g), value: joinedAgo },
          ],
          thumbnail: member.user.displayAvatarURL({ dynamic: true, size: 64 }),
          timestamp: true,
        });

        await logChannel.send({ embeds: [embed] });
      }
    } catch (error) {
      console.error(`  ❌ Failed to log member leave:`, error.message);
    }
  },
};
