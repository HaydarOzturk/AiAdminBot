const express = require('express');
const router = express.Router();
const db = require('../../utils/database');

/**
 * GET /api/moderation/:guildId/actions
 * List moderation actions with pagination
 * Query params: page (default 1), limit (default 20), type, userId
 */
router.get('/:guildId/actions', (req, res) => {
  try {
    const { guildId } = req.params;
    const { page = 1, limit = 20, type, userId } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    let query = 'SELECT * FROM mod_actions WHERE guild_id = ?';
    const params = [guildId];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    if (userId) {
      query += ' AND user_id = ?';
      params.push(userId);
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const actions = db.all(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as count FROM mod_actions WHERE guild_id = ?';
    const countParams = [guildId];

    if (type) {
      countQuery += ' AND type = ?';
      countParams.push(type);
    }

    if (userId) {
      countQuery += ' AND user_id = ?';
      countParams.push(userId);
    }

    const { count } = db.get(countQuery, countParams);

    return res.json({
      actions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Error fetching moderation actions:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/moderation/:guildId/warnings/:userId
 * Get all warnings for a user in a guild
 */
router.get('/:guildId/warnings/:userId', (req, res) => {
  try {
    const { guildId, userId } = req.params;

    const warnings = db.all(
      'SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY timestamp DESC',
      [guildId, userId]
    );

    return res.json({ warnings });
  } catch (error) {
    console.error('Error fetching warnings:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/moderation/:guildId/stats
 * Get moderation statistics for a guild
 */
router.get('/:guildId/stats', (req, res) => {
  try {
    const { guildId } = req.params;

    // Total actions
    const { count: totalActions } = db.get(
      'SELECT COUNT(*) as count FROM mod_actions WHERE guild_id = ?',
      [guildId]
    ) || { count: 0 };

    // Actions by type
    const typeBreakdown = db.all(
      `SELECT type, COUNT(*) as count FROM mod_actions
       WHERE guild_id = ? GROUP BY type`,
      [guildId]
    );

    // Top moderators
    const topMods = db.all(
      `SELECT moderator_id, COUNT(*) as actions FROM mod_actions
       WHERE guild_id = ? GROUP BY moderator_id ORDER BY actions DESC LIMIT 10`,
      [guildId]
    );

    // Total warnings
    const { count: totalWarnings } = db.get(
      'SELECT COUNT(*) as count FROM warnings WHERE guild_id = ?',
      [guildId]
    ) || { count: 0 };

    const stats = {
      totalActions,
      totalWarnings,
      typeBreakdown: typeBreakdown.reduce((acc, row) => {
        acc[row.type] = row.count;
        return acc;
      }, {}),
      topModerators: topMods,
    };

    return res.json(stats);
  } catch (error) {
    console.error('Error fetching moderation stats:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/moderation/:guildId/warn
 * Issue a warning to a user
 * Body: { userId, reason }
 */
router.post('/:guildId/warn', async (req, res) => {
  try {
    const { guildId } = req.params;
    const { userId, reason } = req.body;

    if (!userId || !reason) {
      return res.status(400).json({ error: 'userId and reason are required' });
    }

    const client = req.app.locals.client;
    if (!client) {
      return res.status(500).json({ error: 'Discord client not available' });
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: 'Guild not found' });
    }

    const now = new Date().toISOString();

    // Insert warning into database
    db.run(
      `INSERT INTO warnings (guild_id, user_id, reason, timestamp, moderator_id)
       VALUES (?, ?, ?, ?, ?)`,
      [guildId, userId, reason, now, client.user.id]
    );

    // Insert into mod_actions
    db.run(
      `INSERT INTO mod_actions (guild_id, user_id, moderator_id, type, reason, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [guildId, userId, client.user.id, 'warn', reason, now]
    );

    // Try to send DM to user
    try {
      const user = await client.users.fetch(userId);
      await user.send(`You have been warned in **${guild.name}** for: ${reason}`);
    } catch (dmError) {
      console.warn(`Could not DM user ${userId}:`, dmError.message);
    }

    return res.json({
      success: true,
      message: 'Warning issued',
      warning: { userId, reason, timestamp: now },
    });
  } catch (error) {
    console.error('Error issuing warning:', error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
