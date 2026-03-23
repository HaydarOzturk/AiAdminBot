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

/**
 * Core sync logic — scans members and assigns roles.
 * @param {import('discord.js').Guild} guild
 * @param {boolean} dryRun - If true, only count but don't assign roles
 * @returns {Promise<Object>} Results
 */
async function syncMembers(guild, dryRun = false) {
  const { config } = require('../../utils/permissions');

  const unverifiedRole = findRole(guild, config.verification?.unverifiedRoleName, 'roles.unverified', 'Unverified');
  const verifiedRole = findRole(guild, config.verification?.verifiedRoleName, 'roles.verified', 'New Member');

  if (!unverifiedRole && !verifiedRole) {
    return { error: 'no_roles' };
  }

  // Fetch all members
  await guild.members.fetch();

  let assignedUnverified = 0;
  let assignedVerified = 0;
  let alreadyHasRole = 0;
  let botSkipped = 0;
  let errors = 0;

  for (const [, member] of guild.members.cache) {
    if (member.user.bot) {
      botSkipped++;
      continue;
    }

    const hasAnyRole = member.roles.cache.size > 1;
    if (hasAnyRole) {
      alreadyHasRole++;
      continue;
    }

    try {
      const isVerified = db.get(
        'SELECT * FROM verified_users WHERE user_id = ? AND guild_id = ?',
        [member.id, guild.id]
      );

      if (dryRun) {
        if (isVerified && verifiedRole) assignedVerified++;
        else if (unverifiedRole) assignedUnverified++;
      } else {
        if (isVerified && verifiedRole) {
          await member.roles.add(verifiedRole);
          assignedVerified++;
          console.log(`  🔄 Sync: Gave "${verifiedRole.name}" to ${member.user.tag} (was verified)`);
        } else if (unverifiedRole) {
          await member.roles.add(unverifiedRole);
          assignedUnverified++;
          console.log(`  🔄 Sync: Gave "${unverifiedRole.name}" to ${member.user.tag} (not verified)`);
        }
      }
    } catch (err) {
      console.error(`  ❌ Sync failed for ${member.user.tag}: ${err.message}`);
      errors++;
    }
  }

  const totalMembers = guild.members.cache.filter(m => !m.user.bot).size;
  return {
    totalMembers,
    assignedUnverified,
    assignedVerified,
    alreadyHasRole,
    botSkipped,
    errors,
    unverifiedRoleName: unverifiedRole?.name || 'Unverified',
    verifiedRoleName: verifiedRole?.name || 'Verified',
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sync')
    .setDescription('Sync member roles or slash commands (Owner)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub
        .setName('check')
        .setDescription('Check how many members need role fixes (dry run)')
    )
    .addSubcommand(sub =>
      sub
        .setName('apply')
        .setDescription('Assign roles to all members who have no roles')
    )
    .addSubcommand(sub =>
      sub
        .setName('commands')
        .setDescription('Re-register all slash commands with Discord')
    ),

  // Export for use in ready.js auto-sync
  syncMembers,

  async execute(interaction) {
    if (!hasPermission(interaction.member, 'setup-server')) {
      return interaction.reply({
        content: t('setup.ownerOnly'),
        flags: MessageFlags.Ephemeral,
      });
    }

    const subcommand = interaction.options.getSubcommand();

    // ── /sync commands — re-register slash commands ─────────────────────
    if (subcommand === 'commands') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const { REST, Routes } = require('discord.js');
        const allCommands = require('../../commands');
        const commands = allCommands
          .filter(cmd => 'data' in cmd)
          .map(cmd => cmd.data.toJSON());

        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

        await rest.put(
          Routes.applicationGuildCommands(interaction.client.user.id, interaction.guild.id),
          { body: commands }
        );

        return interaction.editReply({
          content: t('sync.commandsSynced', { count: commands.length }),
        });
      } catch (err) {
        console.error('Command sync failed:', err);
        return interaction.editReply({
          content: t('sync.commandsFailed', { error: err.message }),
        });
      }
    }

    // ── /sync check or /sync apply ─────────────────────────────────────
    const dryRun = subcommand === 'check';
    await interaction.deferReply();

    const result = await syncMembers(interaction.guild, dryRun);

    if (result.error === 'no_roles') {
      return interaction.editReply({
        content: t('sync.noRolesFound'),
      });
    }

    const totalFixed = result.assignedUnverified + result.assignedVerified;

    const embed = createEmbed({
      title: dryRun ? t('sync.checkTitle') : t('sync.applyTitle'),
      color: result.errors > 0 ? 'warning' : 'success',
      fields: [
        { name: t('sync.totalMembers'), value: `${result.totalMembers}`, inline: true },
        { name: t('sync.alreadyHasRole'), value: `${result.alreadyHasRole}`, inline: true },
        { name: t('sync.botsSkipped'), value: `${result.botSkipped}`, inline: true },
        { name: `${result.unverifiedRoleName}`, value: `${result.assignedUnverified}`, inline: true },
        { name: `${result.verifiedRoleName}`, value: `${result.assignedVerified}`, inline: true },
        { name: t('sync.errors'), value: `${result.errors}`, inline: true },
      ],
      footer: dryRun
        ? t('sync.checkFooter', { count: totalFixed })
        : t('sync.applyFooter', { count: totalFixed }),
      timestamp: true,
    });

    await interaction.editReply({ embeds: [embed] });
    console.log(`🔄 Sync ${dryRun ? 'check' : 'apply'}: ${totalFixed} ${dryRun ? 'need fixing' : 'fixed'}, ${result.alreadyHasRole} already ok, ${result.errors} errors`);
  },
};
