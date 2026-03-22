const { Events } = require('discord.js');
const { createEmbed } = require('../utils/embedBuilder');
const { t, channelName } = require('../utils/locale');
const { config } = require('../utils/permissions');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    console.log(`👤 Member left: ${member.user.tag}`);

    // Log to join/leave log channel
    try {
      const logChannelName = config.moderation?.logChannels?.joinLeave || channelName('join-leave-log');
      const logChannel = member.guild.channels.cache.find(
        c => c.name === logChannelName
      );

      if (logChannel) {
        const roles = member.roles.cache
          .filter(r => r.name !== '@everyone')
          .map(r => r.name)
          .join(', ') || t('general.none');

        const joinedAgo = member.joinedTimestamp
          ? `${Math.floor((Date.now() - member.joinedTimestamp) / 86400000)} days ago`
          : t('general.unknown');

        const embed = createEmbed({
          title: t('logging.memberLeft'),
          color: 'danger',
          fields: [
            { name: t('moderation.user'), value: `${member.user.tag}` },
            { name: t('goodbye.roles'), value: roles },
            { name: t('goodbye.joinedAgo'), value: joinedAgo },
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
