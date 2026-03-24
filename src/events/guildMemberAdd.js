const { Events } = require('discord.js');
const { createEmbed } = require('../utils/embedBuilder');
const { t, channelName } = require('../utils/locale');
const { config } = require('../utils/permissions');

/**
 * Find a role by checking multiple possible names (config, locale, English fallback).
 * Case-insensitive to handle servers where role names were tweaked slightly.
 */
function findRole(guild, configName, localeKey, englishFallback, guildId) {
  const names = [configName, t(localeKey, {}, guildId), englishFallback].filter(Boolean);
  for (const name of names) {
    const role = guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
    if (role) return role;
  }
  return null;
}

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    const g = member.guild?.id;
    console.log(`👤 New member joined: ${member.user.tag}`);

    // 1. Assign unverified role
    try {
      const unverifiedRole = findRole(
        member.guild,
        config.verification?.unverifiedRoleName,
        'roles.unverified',
        'Unverified',
        g
      );

      if (unverifiedRole) {
        await member.roles.add(unverifiedRole);
        console.log(`  ✅ Assigned "${unverifiedRole.name}" to ${member.user.tag}`);
      } else {
        console.warn(`  ⚠️ Role "${t('roles.unverified', {}, g)}" not found. Create it or run /setup.`);
      }
    } catch (error) {
      console.error(`  ❌ Failed to assign unverified role:`, error.message);
    }

    // 2. Send welcome message
    try {
      const welcomeChannelName = config.verification?.welcomeChannelName || channelName('welcome', g);
      const welcomeChannel = member.guild.channels.cache.find(
        c => c.name === welcomeChannelName
      );

      if (welcomeChannel) {
        const memberCount = member.guild.memberCount;

        const embed = createEmbed({
          title: t('welcome.title', {}, g),
          description: t('welcome.description', {
            user: member.user.username,
            count: memberCount,
          }, g),
          color: 'success',
          footer: t('welcome.memberCount', { count: memberCount }, g),
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
      const logChannelName = config.moderation?.logChannels?.joinLeave || channelName('join-leave-log', g);
      const logChannel = member.guild.channels.cache.find(
        c => c.name === logChannelName
      );

      if (logChannel) {
        const accountAge = Math.floor((Date.now() - member.user.createdTimestamp) / 86400000);
        const unverifiedRole = findRole(
          member.guild,
          config.verification?.unverifiedRoleName,
          'roles.unverified',
          'Unverified',
          g
        );

        const embed = createEmbed({
          title: t('logging.memberJoined', {}, g),
          color: 'success',
          fields: [
            { name: t('moderation.user', {}, g), value: `${member.user.tag}\n<@${member.id}>` },
            { name: t('logging.accountAge', {}, g), value: t('general.days', { count: accountAge }, g) },
            { name: t('logging.memberNumber', {}, g), value: `#${member.guild.memberCount}` },
            { name: t('logging.assignedRole', {}, g), value: unverifiedRole?.name || t('roles.unverified', {}, g) },
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
