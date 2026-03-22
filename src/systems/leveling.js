const fs = require('fs');
const path = require('path');
const db = require('../utils/database');
const { createEmbed } = require('../utils/embedBuilder');

// Load config
let config;
try {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'config.json'), 'utf-8'));
} catch {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'config.example.json'), 'utf-8'));
}

const levelingConfig = config.leveling || {};
const xpMin = levelingConfig.xpPerMessage?.min || 15;
const xpMax = levelingConfig.xpPerMessage?.max || 25;
const cooldownMs = levelingConfig.xpCooldown || 60000;
const tiers = levelingConfig.tiers || [];

// In-memory cooldown tracker (userId -> lastXpTimestamp)
const cooldowns = new Map();

/**
 * Calculate XP required to reach a given level.
 * Formula: 5 * level^2 + 50 * level + 100
 * Level 1 = 155 XP, Level 5 = 475 XP, Level 10 = 1100 XP, etc.
 */
function xpForLevel(level) {
  return 5 * (level * level) + 50 * level + 100;
}

/**
 * Calculate total XP needed from 0 to reach a given level
 */
function totalXpForLevel(level) {
  let total = 0;
  for (let i = 0; i < level; i++) {
    total += xpForLevel(i);
  }
  return total;
}

/**
 * Get the appropriate tier for a given level
 */
function getTierForLevel(level) {
  let bestTier = null;
  for (const tier of tiers) {
    if (level >= tier.minLevel) {
      bestTier = tier;
    }
  }
  return bestTier;
}

/**
 * Process XP gain for a message. Returns level-up info if the user leveled up.
 * @param {import('discord.js').Message} message
 * @returns {object|null} { oldLevel, newLevel, xp, totalXp, tier } or null
 */
async function processMessage(message) {
  if (!levelingConfig.enabled) return null;

  const userId = message.author.id;
  const guildId = message.guild.id;

  // Check cooldown
  const key = `${userId}-${guildId}`;
  const now = Date.now();
  const lastXp = cooldowns.get(key) || 0;

  if (now - lastXp < cooldownMs) return null;

  // Random XP
  const xpGain = Math.floor(Math.random() * (xpMax - xpMin + 1)) + xpMin;

  // Get or create user record
  let userData = db.get(
    'SELECT * FROM levels WHERE user_id = ? AND guild_id = ?',
    [userId, guildId]
  );

  if (!userData) {
    db.run(
      'INSERT INTO levels (user_id, guild_id, xp, level, messages, last_xp_at) VALUES (?, ?, 0, 0, 0, ?)',
      [userId, guildId, new Date().toISOString()]
    );
    userData = { xp: 0, level: 0, messages: 0 };
  }

  const oldLevel = userData.level;
  let currentXp = userData.xp + xpGain;
  let currentLevel = userData.level;
  const messages = (userData.messages || 0) + 1;

  // Check for level ups (can level up multiple times at once)
  while (currentXp >= xpForLevel(currentLevel)) {
    currentXp -= xpForLevel(currentLevel);
    currentLevel++;
  }

  // Save
  db.run(
    'UPDATE levels SET xp = ?, level = ?, messages = ?, last_xp_at = ? WHERE user_id = ? AND guild_id = ?',
    [currentXp, currentLevel, messages, new Date().toISOString(), userId, guildId]
  );

  // Set cooldown
  cooldowns.set(key, now);

  // Return level-up info if leveled up
  if (currentLevel > oldLevel) {
    const tier = getTierForLevel(currentLevel);
    const oldTier = getTierForLevel(oldLevel);

    return {
      oldLevel,
      newLevel: currentLevel,
      xp: currentXp,
      totalXp: totalXpForLevel(currentLevel) + currentXp,
      tier,
      oldTier,
      tierChanged: tier?.name !== oldTier?.name,
    };
  }

  return null;
}

/**
 * Assign the correct tier role and remove old tier roles
 * @param {import('discord.js').GuildMember} member
 * @param {object} tierInfo - The tier object from config
 */
async function updateTierRole(member, tierInfo) {
  if (!tierInfo) return;

  const guild = member.guild;

  // Find or create the tier role
  let tierRole = guild.roles.cache.find(r => r.name === tierInfo.name);
  if (!tierRole) {
    try {
      tierRole = await guild.roles.create({
        name: tierInfo.name,
        colors: { primaryColor: tierInfo.color || '#99aab5' },
        reason: 'Leveling tier role auto-created',
      });
    } catch (err) {
      console.error(`Failed to create tier role ${tierInfo.name}:`, err.message);
      return;
    }
  }

  // Remove all other tier roles from this member
  const tierRoleNames = tiers.map(t => t.name);
  const rolesToRemove = member.roles.cache.filter(r => tierRoleNames.includes(r.name) && r.name !== tierInfo.name);

  for (const [, role] of rolesToRemove) {
    try {
      await member.roles.remove(role);
    } catch (err) {
      console.error(`Failed to remove old tier role ${role.name}:`, err.message);
    }
  }

  // Add the new tier role
  if (!member.roles.cache.has(tierRole.id)) {
    try {
      await member.roles.add(tierRole);
    } catch (err) {
      console.error(`Failed to add tier role ${tierInfo.name}:`, err.message);
    }
  }
}

/**
 * Get user level data
 * @param {string} userId
 * @param {string} guildId
 * @returns {object} { xp, level, messages, xpNeeded, rank }
 */
function getUserData(userId, guildId) {
  const data = db.get(
    'SELECT * FROM levels WHERE user_id = ? AND guild_id = ?',
    [userId, guildId]
  );

  if (!data) {
    return { xp: 0, level: 0, messages: 0, xpNeeded: xpForLevel(0), rank: null };
  }

  // Get rank
  const rankRow = db.get(
    'SELECT COUNT(*) as rank FROM levels WHERE guild_id = ? AND (level > ? OR (level = ? AND xp > ?))',
    [guildId, data.level, data.level, data.xp]
  );

  return {
    xp: data.xp,
    level: data.level,
    messages: data.messages || 0,
    xpNeeded: xpForLevel(data.level),
    rank: rankRow ? rankRow.rank + 1 : 1,
    tier: getTierForLevel(data.level),
  };
}

/**
 * Get top users for leaderboard
 * @param {string} guildId
 * @param {number} limit
 * @returns {Array}
 */
function getLeaderboard(guildId, limit = 10) {
  return db.all(
    'SELECT * FROM levels WHERE guild_id = ? ORDER BY level DESC, xp DESC LIMIT ?',
    [guildId, limit]
  );
}

module.exports = {
  processMessage,
  updateTierRole,
  getUserData,
  getLeaderboard,
  xpForLevel,
  totalXpForLevel,
  getTierForLevel,
};
