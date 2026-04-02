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
    const { limit = 100 } = req.query;

    const leaderboard = db.all(
      `SELECT user_id, level, xp, total_xp FROM levels
       WHERE guild_id = ? ORDER BY level DESC, xp DESC LIMIT ?`,
      [guildId, parseInt(limit)]
    );

    return res.json({ leaderboard });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return res.status(500).json({ error: error.message });
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
    return res.status(500).json({ error: error.message });
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

    // Try to use the leveling system if available
    try {
      const levelingSystem = require('../../systems/leveling');
      if (levelingSystem && levelingSystem.awardXp) {
        levelingSystem.awardXp(userId, guildId, xpAmount);
      } else {
        // Fallback: manual database update
        const userLevel = db.get(
          'SELECT * FROM levels WHERE guild_id = ? AND user_id = ?',
          [guildId, userId]
        );

        if (userLevel) {
          db.run(
            'UPDATE levels SET xp = xp + ?, total_xp = total_xp + ? WHERE guild_id = ? AND user_id = ?',
            [xpAmount, xpAmount, guildId, userId]
          );
        } else {
          db.run(
            'INSERT INTO levels (guild_id, user_id, level, xp, total_xp) VALUES (?, ?, ?, ?, ?)',
            [guildId, userId, 0, xpAmount, xpAmount]
          );
        }
      }
    } catch (e) {
      // Fallback: manual database update if leveling system not available
      const userLevel = db.get(
        'SELECT * FROM levels WHERE guild_id = ? AND user_id = ?',
        [guildId, userId]
      );

      if (userLevel) {
        db.run(
          'UPDATE levels SET xp = xp + ?, total_xp = total_xp + ? WHERE guild_id = ? AND user_id = ?',
          [xpAmount, xpAmount, guildId, userId]
        );
      } else {
        db.run(
          'INSERT INTO levels (guild_id, user_id, level, xp, total_xp) VALUES (?, ?, ?, ?, ?)',
          [guildId, userId, 0, xpAmount, xpAmount]
        );
      }
    }

    return res.json({
      success: true,
      message: `Awarded ${xpAmount} XP to user ${userId}`,
    });
  } catch (error) {
    console.error('Error awarding XP:', error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
