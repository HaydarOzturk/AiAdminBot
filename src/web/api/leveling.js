const express = require('express');
const router = express.Router();
const db = require('../../utils/database');

/**
 * GET /api/leveling/:guildId/leaderboard
 * Returns top users by level and XP
 * Query params: limit (default 25)
 */
router.get('/:guildId/leaderboard', (req, res) => {
  try {
    const { guildId } = req.params;
    const { limit } = req.query;
    const leveling = require('../../systems/leveling');

    const rows = db.all(
      'SELECT user_id, level, xp FROM levels WHERE guild_id = ?',
      [guildId]
    );

    const leaderboard = rows.map(r => ({
      user_id: r.user_id,
      level: r.level,
      xp: Math.round((leveling.totalXpForLevel(r.level) + (r.xp || 0)) * 10) / 10,
      currentLevelXp: Math.round(r.xp * 10) / 10,
      xpNeeded: leveling.xpForLevel(r.level),
    }));

    // Sort by total XP descending so rank matches displayed values
    leaderboard.sort((a, b) => b.xp - a.xp);

    return res.json({ leaderboard: limit ? leaderboard.slice(0, parseInt(limit)) : leaderboard });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /api/leveling/:guildId/user/:userId
 * Returns XP and level data for a specific user
 */
router.get('/:guildId/user/:userId', (req, res) => {
  try {
    const { guildId, userId } = req.params;

    const userLevel = db.get(
      'SELECT user_id, level, xp, total_xp FROM levels WHERE guild_id = ? AND user_id = ?',
      [guildId, userId]
    );

    if (!userLevel) {
      return res.json({
        userId,
        level: 0,
        xp: 0,
        totalXp: 0,
      });
    }

    return res.json(userLevel);
  } catch (error) {
    console.error('Error fetching user level:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * POST /api/leveling/:guildId/award
 * Awards XP to a user
 * Body: { userId, amount (max 30) }
 */
router.post('/:guildId/award', (req, res) => {
  try {
    const { guildId } = req.params;
    const { userId, amount } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({ error: 'userId and amount are required' });
    }

    const xpAmount = parseInt(amount);
    if (isNaN(xpAmount) || xpAmount <= 0 || xpAmount > 30) {
      return res.status(400).json({ error: 'amount must be a number between 1 and 30' });
    }

    // Use the leveling system directly (correct schema, handles level-ups)
    try {
      const levelingSystem = require('../../systems/leveling');
      levelingSystem.awardXp(userId, guildId, xpAmount);
    } catch (e) {
      // Fallback: manual database update with correct schema
      // Use ON CONFLICT to prevent duplicate entries (the old bug)
      db.run(
        `INSERT INTO levels (user_id, guild_id, xp, level, messages, voice_minutes, last_xp_at)
         VALUES (?, ?, 0, 0, 0, 0, ?)
         ON CONFLICT(user_id, guild_id) DO NOTHING`,
        [userId, guildId, new Date().toISOString()]
      );
      db.run(
        'UPDATE levels SET xp = xp + ?, last_xp_at = ? WHERE user_id = ? AND guild_id = ?',
        [xpAmount, new Date().toISOString(), userId, guildId]
      );
    }

    return res.json({
      success: true,
      message: `Awarded ${xpAmount} XP to user ${userId}`,
    });
  } catch (error) {
    console.error('Error awarding XP:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
