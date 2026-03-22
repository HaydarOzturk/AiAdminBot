const { Events } = require('discord.js');
const { createEmbed } = require('../utils/embedBuilder');
const { t, channelName } = require('../utils/locale');
const { config } = require('../utils/permissions');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    console.log(`👤 New member joined: ${member.user.tag}`);

    // 1. Assign unverified role
    try {
      const unverifiedRoleName = config.verification?.unverifiedRoleName || t('roles.unverified');
      const unverifiedRole = member.guild.roles.cache.find(
        r => r.name === unverifiedRoleName
      );

      if (unverifiedRole) {
        await member.roles.add(unverifiedRole);
        console.log(`  ✅ Assigned "${unverifiedRoleName}" to ${member.user.tag}`);
      } else {
        console.warn(`  ⚠️ Role "${unverifiedRoleName}" not found. Create it or run /setup-server.`);
      }
    } catch (error) {
      console.error(`  ❌ Failed to assign unverified role:`, error.message);
    }

    // 2. Send welcome message
    try {
      const welcomeChannelName = config.verification?.welcomeChannelName || channelName('welcome');
      const welcomeChannel = member.guild.channels.cache.find(
        c => c.name === welcomeChannelName
      );

      if (welcomeChannel) {
        const memberCount = member.guild.memberCount;

        const embed = createEmbed({
          title: t('welcome.title'),
          description: t('welcome.description', {
            user: member.user.username,
            count: memberCount,
          }),
          color: 'success',
          footer: t('welcome.memberCount', { count: memberCount }),
          thumbnail: member.user.displayAvatarURL({ dynamic: true, size: 128 }),
          timestamp: true,
        });

        await welcomeChannel.send({ embeds: [embed] });
      }
    } catch (error) {
      console.error(`  ❌ Failed to send welcome message:`, error.message);
    }

    // 3. Log to join/leave log channel
    try {
      const logChannelName = config.moderation?.logChannels?.joinLeave || channelName('join-leave-log');
      const logChannel = member.guild.channels.cache.find(
        c => c.name === logChannelName
      );

      if (logChannel) {
        const accountAge = Math.floor((Date.now() - member.user.createdTimestamp) / 86400000);

        const embed = createEmbed({
          title: t('logging.memberJoined'),
          color: 'success',
          fields: [
            { name: t('moderation.user'), value: `${member.user.tag}\n<@${member.id}>` },
            { name: t('logging.accountAge'), value: t('general.days', { count: accountAge }) },
            { name: t('logging.memberNumber'), value: `#${member.guild.memberCount}` },
            { name: t('logging.assignedRole'), value: config.verification?.unverifiedRoleName || t('roles.unverified') },
          ],
          thumbnail: member.user.displayAvatarURL({ dynamic: true, size: 64 }),
          timestamp: true,
        });

        await logChannel.send({ embeds: [embed] });
      }
    } catch (error) {
      console.error(`  ❌ Failed to log member join:`, error.message);
    }
  },
};
