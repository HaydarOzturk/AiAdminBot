const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { createEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/locale');
const db = require('../../utils/database');

/**
 * Find a role by checking multiple possible names (config, locale, English fallback).
 */
function findRole(guild, configName, localeKey, englishFallback) {
  const names = [configName, t(localeKey), englishFallback].filter(Boolean);
  for (const name of names) {
    const role = guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
    if (role) return role;
  }
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sync')
    .setDescription('Assign basic roles to all members who have no roles (Admin+)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!hasPermission(interaction.member, 'setup-server')) {
      return interaction.reply({
        content: t('setup.ownerOnly'),
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    const guild = interaction.guild;
    const { config } = require('../../utils/permissions');

    // Find the unverified and verified roles
    const unverifiedRole = findRole(guild, config.verification?.unverifiedRoleName, 'roles.unverified', 'Unverified');
    const verifiedRole = findRole(guild, config.verification?.verifiedRoleName, 'roles.verified', 'New Member');

    if (!unverifiedRole && !verifiedRole) {
      return interaction.editReply({
        content: "Could not find the Unverified or New Member role. Run /setup first to create them.",
      });
    }

    // Fetch all members (not just cached/online ones)
    await guild.members.fetch();

    let assignedUnverified = 0;
    let assignedVerified = 0;
    let alreadyHasRole = 0;
    let botSkipped = 0;
    let errors = 0;

    for (const [, member] of guild.members.cache) {
      // Skip bots
      if (member.user.bot) {
        botSkipped++;
        continue;
      }

      // Check if member has ANY meaningful role (besides @everyone)
      const hasAnyRole = member.roles.cache.size > 1; // 1 = only @everyone

      if (hasAnyRole) {
        alreadyHasRole++;
        continue;
      }

      // Member has no roles — check if they are in the verified_users database
      try {
        const isVerified = db.get(
          'SELECT * FROM verified_users WHERE user_id = ? AND guild_id = ?',
          [member.id, guild.id]
        );

        if (isVerified && verifiedRole) {
          // They verified before but lost their role somehow
          await member.roles.add(verifiedRole);
          assignedVerified++;
          console.log(`  🔄 Sync: Gave "${verifiedRole.name}" to ${member.user.tag} (was verified)`);
        } else if (unverifiedRole) {
          // Never verified — give them unverified role so they can see the verification channel
          await member.roles.add(unverifiedRole);
          assignedUnverified++;
          console.log(`  🔄 Sync: Gave "${unverifiedRole.name}" to ${member.user.tag} (not verified)`);
        }
      } catch (err) {
        console.error(`  ❌ Sync failed for ${member.user.tag}: ${err.message}`);
        errors++;
      }
    }

    const totalFixed = assignedUnverified + assignedVerified;
    const totalMembers = guild.members.cache.filter(m => !m.user.bot).size;

    const embed = createEmbed({
      title: '🔄 Role Sync Complete',
      color: errors > 0 ? 'warning' : 'success',
      fields: [
        { name: 'Total Members', value: `${totalMembers}`, inline: true },
        { name: 'Already Had Roles', value: `${alreadyHasRole}`, inline: true },
        { name: 'Bots Skipped', value: `${botSkipped}`, inline: true },
        { name: `Assigned "${unverifiedRole?.name || 'Unverified'}"`, value: `${assignedUnverified}`, inline: true },
        { name: `Assigned "${verifiedRole?.name || 'Verified'}"`, value: `${assignedVerified}`, inline: true },
        { name: 'Errors', value: `${errors}`, inline: true },
      ],
      footer: `${totalFixed} member(s) fixed`,
      timestamp: true,
    });

    await interaction.editReply({ embeds: [embed] });
    console.log(`🔄 Sync complete: ${totalFixed} fixed, ${alreadyHasRole} already ok, ${errors} errors`);
  },
};
