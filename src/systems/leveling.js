const fs = require('fs');
const path = require('path');
const db = require('../utils/database');
const { createEmbed } = require('../utils/embedBuilder');
const { loadConfig } = require('../utils/paths');

// Load config
const config = loadConfig('config.json');

const levelingConfig = config.leveling || {};
const tiers = levelingConfig.tiers || [];

// ── XP Settings ───────────────────────────────────────────────────────────
// Message XP: 0.1 – 0.3 per message, daily cap 20
const MSG_XP_MIN = 0.1;
const MSG_XP_MAX = 0.3;
const MSG_XP_DAILY_CAP = 20;

// Voice XP: 3 per hour (handled in voiceXp.js), daily cap 50
const VOICE_XP_DAILY_CAP = 50;

const cooldownMs = levelingConfig.xpCooldown || 60000;

// In-memory cooldown tracker (userId-guildId -> lastXpTimestamp)
const cooldowns = new Map();

// Periodic cleanup: remove stale cooldown entries (every 30 min)
// Prevents unbounded Map growth from users who send one message and leave
setInterval(() => {
  const now = Date.now();
  const staleThreshold = cooldownMs * 2; // Keep entries for 2x cooldown period
  for (const [key, timestamp] of cooldowns) {
    if (now - timestamp > staleThreshold) cooldowns.delete(key);
  }
}, 1800000);

/**
 * Get today's date string in YYYY-MM-DD format (UTC)
 */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Get or create the daily XP record for a user
 */
function getDailyXp(userId, guildId) {
  const date = todayStr();
  let row = db.get(
    'SELECT * FROM daily_xp WHERE user_id = ? AND guild_id = ? AND date = ?',
    [userId, guildId, date]
  );
  if (!row) {
    db.run(
      'INSERT INTO daily_xp (user_id, guild_id, date, message_xp, voice_xp) VALUES (?, ?, ?, 0, 0)',
      [userId, guildId, date]
    );
    row = { user_id: userId, guild_id: guildId, date, message_xp: 0, voice_xp: 0 };
  }
  return row;
}

/**
 * Check how much message XP the user can still earn today
 */
function remainingMessageXp(userId, guildId) {
  const daily = getDailyXp(userId, guildId);
  return Math.max(0, MSG_XP_DAILY_CAP - (daily.message_xp || 0));
}

/**
 * Check how much voice XP the user can still earn today
 */
function remainingVoiceXp(userId, guildId) {
  const daily = getDailyXp(userId, guildId);
  return Math.max(0, VOICE_XP_DAILY_CAP - (daily.voice_xp || 0));
}

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
 * XP per message: 0.1 – 0.3 (fractional, accumulated in DB as REAL)
 * Daily cap: 20 XP from messages
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

  // Check daily cap
  const remaining = remainingMessageXp(userId, guildId);
  if (remaining <= 0) return null;

  // Random XP (fractional: 0.1 – 0.3)
  const rawXpGain = MSG_XP_MIN + Math.random() * (MSG_XP_MAX - MSG_XP_MIN);
  // Cap to remaining daily allowance
  const xpGain = Math.min(rawXpGain, remaining);

  // Get or create user record
  let userData = db.get(
    'SELECT * FROM levels WHERE user_id = ? AND guild_id = ?',
    [userId, guildId]
  );

  if (!userData) {
    db.run(
      'INSERT INTO levels (user_id, guild_id, xp, level, messages, voice_minutes, last_xp_at) VALUES (?, ?, 0, 0, 0, 0, ?)',
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

  // Save (xp stored as REAL for fractional accumulation)
  db.run(
    'UPDATE levels SET xp = ?, level = ?, messages = ?, last_xp_at = ? WHERE user_id = ? AND guild_id = ?',
    [currentXp, currentLevel, messages, new Date().toISOString(), userId, guildId]
  );

  // Update daily message XP counter
  const date = todayStr();
  db.run(
    'UPDATE daily_xp SET message_xp = message_xp + ? WHERE user_id = ? AND guild_id = ? AND date = ?',
    [xpGain, userId, guildId, date]
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
 * Award XP directly (used by /award command). Bypasses daily caps.
 * @param {string} userId
 * @param {string} guildId
 * @param {number} amount - XP to award
 * @returns {object} { oldLevel, newLevel, xp, tier, tierChanged }
 */
function awardXp(userId, guildId, amount) {
  let userData = db.get(
    'SELECT * FROM levels WHERE user_id = ? AND guild_id = ?',
    [userId, guildId]
  );

  if (!userData) {
    db.run(
      'INSERT INTO levels (user_id, guild_id, xp, level, messages, voice_minutes, last_xp_at) VALUES (?, ?, 0, 0, 0, 0, ?)',
      [userId, guildId, new Date().toISOString()]
    );
    userData = { xp: 0, level: 0, messages: 0 };
  }

  const oldLevel = userData.level;
  let currentXp = userData.xp + amount;
  let currentLevel = userData.level;

  while (currentXp >= xpForLevel(currentLevel)) {
    currentXp -= xpForLevel(currentLevel);
    currentLevel++;
  }

  db.run(
    'UPDATE levels SET xp = ?, level = ?, last_xp_at = ? WHERE user_id = ? AND guild_id = ?',
    [currentXp, currentLevel, new Date().toISOString(), userId, guildId]
  );

  const tier = getTierForLevel(currentLevel);
  const oldTier = getTierForLevel(oldLevel);

  return {
    oldLevel,
    newLevel: currentLevel,
    xp: currentXp,
    tier,
    oldTier,
    tierChanged: tier?.name !== oldTier?.name,
  };
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
    return { xp: 0, level: 0, messages: 0, voiceMinutes: 0, xpNeeded: xpForLevel(0), rank: null };
  }

  // Get rank
  const rankRow = db.get(
    'SELECT COUNT(*) as rank FROM levels WHERE guild_id = ? AND (level > ? OR (level = ? AND xp > ?))',
    [guildId, data.level, data.level, data.xp]
  );

  return {
    xp: Math.round(data.xp * 10) / 10,
    totalXp: Math.round((totalXpForLevel(data.level) + (data.xp || 0)) * 10) / 10,
    level: data.level,
    messages: data.messages || 0,
    voiceMinutes: data.voice_minutes || 0,
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
  awardXp,
  updateTierRole,
  getUserData,
  getLeaderboard,
  xpForLevel,
  totalXpForLevel,
  getTierForLevel,
  remainingVoiceXp,
  VOICE_XP_DAILY_CAP,
};
