/**
 * Unified guild-scoped API router
 * All routes: /api/guilds/:guildId/<section>/...
 * Maps frontend URLs to the correct backend logic.
 */
const express = require('express');
const router = express.Router();
const db = require('../../utils/database');

// ── Helper: get Discord guild from client ────────────────────────────────
function getGuild(req) {
  const client = req.app.locals.client;
  if (!client) return null;
  return client.guilds.cache.get(req.params.guildId) || null;
}

// ══════════════════════════════════════════════════════════════════════════
// MODERATION
// ══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/guilds/:guildId/moderation/actions
 * Query: page, limit, filter (action_type), search (user_id)
 */
router.get('/:guildId/moderation/actions', (req, res) => {
  try {
    const { guildId } = req.params;
    const { page = 1, limit = 20, filter, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = 'SELECT * FROM mod_actions WHERE guild_id = ?';
    const params = [guildId];

    if (filter && filter !== 'all') {
      query += ' AND action_type = ?';
      params.push(filter);
    }
    if (search) {
      query += ' AND (user_id = ? OR moderator_id = ?)';
      params.push(search, search);
    }

    // Count first
    let countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as count');
    const total = db.get(countQuery, params)?.count || 0;

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const actions = db.all(query, params);

    res.json({
      actions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('API moderation/actions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/guilds/:guildId/moderation/warnings
 * Query: search (user_id)
 */
router.get('/:guildId/moderation/warnings', (req, res) => {
  try {
    const { guildId } = req.params;
    const { search } = req.query;

    let query = 'SELECT * FROM warnings WHERE guild_id = ?';
    const params = [guildId];

    if (search) {
      query += ' AND user_id = ?';
      params.push(search);
    }

    query += ' ORDER BY created_at DESC LIMIT 50';
    const warnings = db.all(query, params);

    res.json({ warnings });
  } catch (err) {
    console.error('API moderation/warnings error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/guilds/:guildId/moderation/warnings
 * Body: { userId, reason }
 */
router.post('/:guildId/moderation/warnings', async (req, res) => {
  try {
    const { guildId } = req.params;
    const { userId, reason } = req.body;

    if (!userId || !reason) {
      return res.status(400).json({ error: 'userId and reason are required' });
    }

    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const client = req.app.locals.client;

    db.run(
      'INSERT INTO warnings (guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?)',
      [guildId, userId, client.user.id, reason]
    );
    db.run(
      'INSERT INTO mod_actions (action_type, guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?, ?)',
      ['warn', guildId, userId, client.user.id, reason]
    );

    // Try DM
    try {
      const user = await client.users.fetch(userId);
      await user.send(`You have been warned in **${guild.name}** for: ${reason}`);
    } catch { /* DM failed, ignore */ }

    res.json({ success: true });
  } catch (err) {
    console.error('API warn error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/guilds/:guildId/moderation/warnings/:warningId
 */
router.delete('/:guildId/moderation/warnings/:warningId', (req, res) => {
  try {
    const { guildId, warningId } = req.params;
    db.run('DELETE FROM warnings WHERE id = ? AND guild_id = ?', [warningId, guildId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/guilds/:guildId/moderation/stats
 */
router.get('/:guildId/moderation/stats', (req, res) => {
  try {
    const { guildId } = req.params;

    const totalActions = db.get(
      'SELECT COUNT(*) as count FROM mod_actions WHERE guild_id = ?', [guildId]
    )?.count || 0;

    const totalWarnings = db.get(
      'SELECT COUNT(*) as count FROM warnings WHERE guild_id = ?', [guildId]
    )?.count || 0;

    const typeBreakdown = db.all(
      'SELECT action_type as type, COUNT(*) as count FROM mod_actions WHERE guild_id = ? GROUP BY action_type',
      [guildId]
    );

    const topModerators = db.all(
      'SELECT moderator_id, COUNT(*) as actions FROM mod_actions WHERE guild_id = ? GROUP BY moderator_id ORDER BY actions DESC LIMIT 10',
      [guildId]
    );

    res.json({ totalActions, totalWarnings, typeBreakdown, topModerators });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ROLES
// ══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/guilds/:guildId/roles
 */
router.get('/:guildId/roles', (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const roles = guild.roles.cache
      .filter(r => r.name !== '@everyone')
      .sort((a, b) => b.position - a.position)
      .map(r => ({
        id: r.id,
        name: r.name,
        color: r.hexColor,
        members: r.members.size,
        position: r.position,
        managed: r.managed,
      }));

    res.json({ roles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/guilds/:guildId/roles/:roleId/members/:userId
 * Give role to user
 */
router.put('/:guildId/roles/:roleId/members/:userId', async (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const member = await guild.members.fetch(req.params.userId).catch(() => null);
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const role = guild.roles.cache.get(req.params.roleId);
    if (!role) return res.status(404).json({ error: 'Role not found' });

    await member.roles.add(role);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/guilds/:guildId/roles/:roleId/members/:userId
 * Remove role from user
 */
router.delete('/:guildId/roles/:roleId/members/:userId', async (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const member = await guild.members.fetch(req.params.userId).catch(() => null);
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const role = guild.roles.cache.get(req.params.roleId);
    if (!role) return res.status(404).json({ error: 'Role not found' });

    await member.roles.remove(role);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// LEVELING
// ══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/guilds/:guildId/leveling/leaderboard
 * Query: search (user_id), limit
 */
router.get('/:guildId/leveling/leaderboard', (req, res) => {
  try {
    const { guildId } = req.params;
    const { search, limit = 25 } = req.query;

    let query = 'SELECT * FROM levels WHERE guild_id = ?';
    const params = [guildId];

    if (search) {
      query += ' AND user_id = ?';
      params.push(search);
    }

    query += ' ORDER BY level DESC, xp DESC LIMIT ?';
    params.push(parseInt(limit));

    const users = db.all(query, params);
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/guilds/:guildId/leveling/stats
 */
router.get('/:guildId/leveling/stats', (req, res) => {
  try {
    const { guildId } = req.params;

    const totalUsers = db.get(
      'SELECT COUNT(*) as count FROM levels WHERE guild_id = ?', [guildId]
    )?.count || 0;

    const topLevel = db.get(
      'SELECT MAX(level) as maxLevel FROM levels WHERE guild_id = ?', [guildId]
    )?.maxLevel || 0;

    const totalMessages = db.get(
      'SELECT SUM(messages) as total FROM levels WHERE guild_id = ?', [guildId]
    )?.total || 0;

    res.json({ totalUsers, topLevel, totalMessages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/guilds/:guildId/leveling/xp
 * Body: { userId, amount }
 */
router.post('/:guildId/leveling/xp', (req, res) => {
  try {
    const { guildId } = req.params;
    const { userId, amount } = req.body;

    if (!userId || !amount || amount <= 0 || amount > 30) {
      return res.status(400).json({ error: 'userId and amount (1-30) are required' });
    }

    const leveling = require('../../systems/leveling');
    const result = leveling.awardXp(userId, guildId, amount);

    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/guilds/:guildId/config
 */
router.get('/:guildId/config', (req, res) => {
  try {
    const { loadConfig, projectPath } = require('../../utils/paths');
    const fs = require('fs');

    const config = loadConfig('config.json');

    // Safe env vars (never expose tokens/passwords)
    const safeEnvKeys = ['LOCALE', 'LOG_LEVEL', 'AI_CHAT_ENABLED', 'AI_CHAT_CHANNEL',
      'AI_MODERATION_ENABLED', 'AI_MOD_CONFIDENCE_THRESHOLD', 'AI_TIMEOUT_MINUTES',
      'WEB_PORT', 'VOICE_XP_INTERVAL', 'VOICE_XP_AMOUNT'];

    const env = {};
    safeEnvKeys.forEach(key => {
      if (process.env[key]) env[key] = process.env[key];
    });

    res.json({ config, env });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/guilds/:guildId/config
 * Body: { config: {...} }
 */
router.put('/:guildId/config', (req, res) => {
  try {
    const { projectPath } = require('../../utils/paths');
    const fs = require('fs');

    const newConfig = req.body.config;
    if (!newConfig) return res.status(400).json({ error: 'config object is required' });

    const configFilePath = projectPath('config', 'config.json');
    fs.writeFileSync(configFilePath, JSON.stringify(newConfig, null, 2), 'utf-8');

    res.json({ success: true, message: 'Config saved. Restart the bot to apply changes.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
