const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./paths');

// Load config
const config = loadConfig('config.json');

/**
 * Get the permission level of a guild member
 * @param {import('discord.js').GuildMember} member
 * @returns {number} Permission level (0-4)
 */
function getPermissionLevel(member) {
  // Server owner is always level 4
  if (member.id === member.guild.ownerId) return 4;

  // DEBUG_OWNER_ID gets level 4 only in development mode
  if (process.env.NODE_ENV === 'development' && process.env.DEBUG_OWNER_ID && member.id === process.env.DEBUG_OWNER_ID) return 4;

  // Check Discord permissions first (most reliable), then fall back to role names
  const perms = member.permissions;
  if (perms.has('Administrator')) return 3;
  if (perms.has('ManageGuild') || perms.has('ManageRoles')) return 3;
  if (perms.has('BanMembers') || perms.has('KickMembers') || perms.has('ModerateMembers')) return 2;
  if (perms.has('ManageMessages')) return 2;

  // Also check role names as fallback for custom setups
  const roleNames = member.roles.cache.map(r => r.name.toLowerCase());

  if (roleNames.some(r => r.includes('admin'))) return 3;
  if (roleNames.some(r => r.includes('moderator') || r.includes('mod'))) return 2;

  // Check if verified (check config name, locale name, and English fallback)
  const { t } = require('./locale');
  const verifiedNames = [
    config.verification?.verifiedRoleName,
    t('roles.verified'),
    'New Member',
  ].filter(Boolean).map(n => n.toLowerCase());
  if (roleNames.some(r => verifiedNames.includes(r))) return 1;

  return 0;
}

/**
 * Check if a member has the required permission level for a command
 * @param {import('discord.js').GuildMember} member
 * @param {string} commandName
 * @returns {boolean}
 */
function hasPermission(member, commandName) {
  const requiredLevel = config.permissions?.commands?.[commandName] ?? 0;
  const memberLevel = getPermissionLevel(member);
  return memberLevel >= requiredLevel;
}

/**
 * Get the required permission level for a command
 * @param {string} commandName
 * @returns {number}
 */
function getRequiredLevel(commandName) {
  return config.permissions?.commands?.[commandName] ?? 0;
}

module.exports = { getPermissionLevel, hasPermission, getRequiredLevel, config };
