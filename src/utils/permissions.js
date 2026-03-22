const fs = require('fs');
const path = require('path');

// Load config
let config;
try {
  const configPath = path.join(__dirname, '..', '..', 'config', 'config.json');
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch {
  // Fallback to example config if no real config exists
  const examplePath = path.join(__dirname, '..', '..', 'config', 'config.example.json');
  config = JSON.parse(fs.readFileSync(examplePath, 'utf-8'));
}

/**
 * Get the permission level of a guild member
 * @param {import('discord.js').GuildMember} member
 * @returns {number} Permission level (0-4)
 */
function getPermissionLevel(member) {
  // Server owner is always level 4
  if (member.id === member.guild.ownerId) return 4;

  // Check role names for permission levels
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
