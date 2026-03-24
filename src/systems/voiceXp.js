/**
 * Voice XP System — Awards 1 XP per hour spent in voice channels.
 *
 * Tracks when users join/leave voice channels and periodically awards XP.
 * Uses an interval-based approach: every 60 minutes, all users currently
 * in voice channels receive 1 XP.
 */

const db = require('../utils/database');
const { createEmbed } = require('../utils/embedBuilder');
const { t } = require('../utils/locale');
const { loadConfig } = require('../utils/paths');

const config = loadConfig('config.json');
const levelingConfig = config.leveling || {};

// How often to award voice XP (ms) — default 1 hour
const VOICE_XP_INTERVAL = parseInt(process.env.VOICE_XP_INTERVAL) || 3600000;
// How much XP to award per interval
const VOICE_XP_AMOUNT = parseInt(process.env.VOICE_XP_AMOUNT) || 1;

// Track users currently in voice: Map<guildId, Set<userId>>
const voiceUsers = new Map();

// Track when users joined voice: Map<"guildId-userId", timestamp>
const voiceJoinTimes = new Map();

// Reference to the interval timer
let _xpInterval = null;

/**
 * Called when a user joins a voice channel
 * @param {string} guildId
 * @param {string} userId
 */
function trackJoin(guildId, userId) {
  if (!levelingConfig.enabled) return;

  if (!voiceUsers.has(guildId)) {
    voiceUsers.set(guildId, new Set());
  }
  voiceUsers.get(guildId).add(userId);
  voiceJoinTimes.set(`${guildId}-${userId}`, Date.now());
}

/**
 * Called when a user leaves a voice channel
 * @param {string} guildId
 * @param {string} userId
 */
function trackLeave(guildId, userId) {
  const guildSet = voiceUsers.get(guildId);
  if (guildSet) {
    guildSet.delete(userId);
    if (guildSet.size === 0) voiceUsers.delete(guildId);
  }

  // Save accumulated voice time to DB
  const key = `${guildId}-${userId}`;
  const joinTime = voiceJoinTimes.get(key);
  if (joinTime) {
    const minutesSpent = Math.floor((Date.now() - joinTime) / 60000);
    if (minutesSpent > 0) {
      try {
        // Ensure user row exists
        const existing = db.get(
          'SELECT voice_minutes FROM levels WHERE user_id = ? AND guild_id = ?',
          [userId, guildId]
        );
        if (existing) {
          db.run(
            'UPDATE levels SET voice_minutes = voice_minutes + ? WHERE user_id = ? AND guild_id = ?',
            [minutesSpent, userId, guildId]
          );
        } else {
          db.run(
            'INSERT INTO levels (user_id, guild_id, xp, level, messages, voice_minutes, last_xp_at) VALUES (?, ?, 0, 0, 0, ?, ?)',
            [userId, guildId, minutesSpent, new Date().toISOString()]
          );
        }
      } catch (err) {
        console.error(`Failed to save voice minutes for ${userId}:`, err.message);
      }
    }
    voiceJoinTimes.delete(key);
  }
}

/**
 * XP formula (imported from leveling.js logic)
 */
function xpForLevel(level) {
  return 5 * (level * level) + 50 * level + 100;
}

/**
 * Award voice XP to all currently tracked users.
 * Called on a timer interval.
 * @param {import('discord.js').Client} client - Discord client for sending level-up messages
 */
async function awardVoiceXp(client) {
  if (!levelingConfig.enabled) return;

  for (const [guildId, users] of voiceUsers) {
    for (const userId of users) {
      try {
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
        let currentXp = userData.xp + VOICE_XP_AMOUNT;
        let currentLevel = userData.level;

        // Check for level ups
        while (currentXp >= xpForLevel(currentLevel)) {
          currentXp -= xpForLevel(currentLevel);
          currentLevel++;
        }

        // Save — messages count stays the same (voice XP doesn't count as message)
        // Also add the interval minutes to voice_minutes
        const intervalMinutes = Math.round(VOICE_XP_INTERVAL / 60000);
        db.run(
          'UPDATE levels SET xp = ?, level = ?, voice_minutes = voice_minutes + ?, last_xp_at = ? WHERE user_id = ? AND guild_id = ?',
          [currentXp, currentLevel, intervalMinutes, new Date().toISOString(), userId, guildId]
        );

        // Level up notification
        if (currentLevel > oldLevel && client) {
          try {
            const guild = client.guilds.cache.get(guildId);
            if (!guild) continue;

            const leveling = require('./leveling');
            const tier = leveling.getTierForLevel(currentLevel);
            const oldTier = leveling.getTierForLevel(oldLevel);
            const tierChanged = tier?.name !== oldTier?.name;

            // Find level-up channel
            const levelUpChannelName = config.leveling?.levelUpChannelName;
            const targetChannel = levelUpChannelName
              ? guild.channels.cache.find(c => c.name === levelUpChannelName)
              : null;

            if (targetChannel) {
              const member = await guild.members.fetch(userId).catch(() => null);
              if (member) {
                const description = tierChanged
                  ? t('leveling.levelUpTierDesc', { user: member.user.username, level: currentLevel, tier: tier.name }, guildId)
                  : t('leveling.levelUpDesc', { user: member.user.username, level: currentLevel }, guildId);

                const embed = createEmbed({
                  title: t('leveling.levelUp', {}, guildId),
                  description: `${description}\n🔊 ${t('voiceXp.source', {}, guildId)}`,
                  color: tier?.color ? undefined : 'success',
                  fields: [
                    { name: t('leveling.level', {}, guildId), value: `${currentLevel}`, inline: true },
                    { name: t('leveling.tier', {}, guildId), value: tier?.name || '-', inline: true },
                  ],
                  thumbnail: member.user.displayAvatarURL({ dynamic: true, size: 128 }),
                  timestamp: true,
                });

                if (tier?.color) embed.setColor(tier.color);
                await targetChannel.send({ embeds: [embed] });

                // Update tier role
                if (tierChanged && tier) {
                  await leveling.updateTierRole(member, tier);
                }
              }
            }
          } catch (err) {
            console.error(`Voice XP level-up notification error (${userId}):`, err.message);
          }
        }
      } catch (err) {
        console.error(`Voice XP award error for ${userId} in ${guildId}:`, err.message);
      }
    }
  }
}

/**
 * Start the voice XP interval timer
 * @param {import('discord.js').Client} client
 */
function startVoiceXpTimer(client) {
  if (!levelingConfig.enabled) return;
  if (_xpInterval) return; // Already running

  _xpInterval = setInterval(() => awardVoiceXp(client), VOICE_XP_INTERVAL);
  console.log(`✅ Voice XP timer started (${VOICE_XP_AMOUNT} XP every ${VOICE_XP_INTERVAL / 60000} min)`);
}

/**
 * Stop the voice XP interval timer
 */
function stopVoiceXpTimer() {
  if (_xpInterval) {
    clearInterval(_xpInterval);
    _xpInterval = null;
  }
}

/**
 * Initialize voice tracking by scanning all current voice states.
 * Call this on bot startup to track users already in voice channels.
 * @param {import('discord.js').Client} client
 */
function initVoiceTracking(client) {
  if (!levelingConfig.enabled) return;

  let count = 0;
  for (const [, guild] of client.guilds.cache) {
    for (const [, state] of guild.voiceStates.cache) {
      if (state.channelId && !state.member?.user?.bot) {
        trackJoin(guild.id, state.member.id);
        count++;
      }
    }
  }

  if (count > 0) {
    console.log(`🔊 Initialized voice tracking for ${count} users already in voice channels`);
  }
}

module.exports = {
  trackJoin,
  trackLeave,
  startVoiceXpTimer,
  stopVoiceXpTimer,
  initVoiceTracking,
  voiceUsers,
};
