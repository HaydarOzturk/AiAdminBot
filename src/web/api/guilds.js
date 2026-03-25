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

function getClient(req) {
  return req.app.locals.client || null;
}

// ══════════════════════════════════════════════════════════════════════════
// MEMBERS & CHANNELS  (shared helpers for dropdowns)
// ══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/guilds/:guildId/members
 * Query: search (name/id fragment), limit (default 25)
 */
router.get('/:guildId/members', async (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const { search = '', limit = 25 } = req.query;
    let members;

    if (search) {
      members = await guild.members.fetch({ query: search, limit: parseInt(limit) });
    } else {
      // Return cached members (fetching all is expensive)
      members = guild.members.cache;
    }

    const list = [...members.values()]
      .slice(0, parseInt(limit))
      .map(m => ({
        id: m.id,
        username: m.user.username,
        displayName: m.displayName,
        avatar: m.user.displayAvatarURL({ size: 32 }),
        bot: m.user.bot,
      }));

    res.json({ members: list });
  } catch (err) {
    console.error('API members error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Friendly permission names ────────────────────────────────────────────
const PERM_LABELS = {
  ViewChannel:          { label: 'View Channel',      category: 'General',  icon: '👁️'  },
  SendMessages:         { label: 'Send Messages',     category: 'Text',     icon: '💬' },
  SendMessagesInThreads:{ label: 'Send in Threads',   category: 'Text',     icon: '🧵' },
  EmbedLinks:           { label: 'Embed Links',       category: 'Text',     icon: '🔗' },
  AttachFiles:          { label: 'Attach Files',      category: 'Text',     icon: '📎' },
  AddReactions:         { label: 'Add Reactions',     category: 'Text',     icon: '😀' },
  ReadMessageHistory:   { label: 'Read History',      category: 'Text',     icon: '📜' },
  ManageMessages:       { label: 'Manage Messages',   category: 'Text',     icon: '🗑️'  },
  MentionEveryone:      { label: 'Mention @everyone', category: 'Text',     icon: '📢' },
  UseExternalEmojis:    { label: 'External Emojis',   category: 'Text',     icon: '🎭' },
  Connect:              { label: 'Connect',           category: 'Voice',    icon: '🔊' },
  Speak:                { label: 'Speak',             category: 'Voice',    icon: '🎙️'  },
  Stream:               { label: 'Video / Screen',    category: 'Voice',    icon: '📺' },
  UseVAD:               { label: 'Voice Activity',    category: 'Voice',    icon: '🎚️'  },
  MuteMembers:          { label: 'Mute Members',      category: 'Voice',    icon: '🔇' },
  DeafenMembers:        { label: 'Deafen Members',    category: 'Voice',    icon: '🔈' },
  MoveMembers:          { label: 'Move Members',      category: 'Voice',    icon: '↔️'  },
  ManageChannels:       { label: 'Manage Channel',    category: 'Admin',    icon: '⚙️'  },
  ManageRoles:          { label: 'Manage Permissions',category: 'Admin',    icon: '🔑' },
  ManageWebhooks:       { label: 'Manage Webhooks',   category: 'Admin',    icon: '🪝' },
  CreateInstantInvite:  { label: 'Create Invite',     category: 'General',  icon: '✉️'  },
};

const CHANNEL_TYPE_NAMES = { 0: 'Text', 2: 'Voice', 4: 'Category', 5: 'Announcement', 13: 'Stage', 15: 'Forum' };

function serializeOverwrites(channel, guild) {
  const overwrites = [];
  channel.permissionOverwrites.cache.forEach(ow => {
    const target = ow.type === 0
      ? guild.roles.cache.get(ow.id)
      : guild.members.cache.get(ow.id);

    const allow = ow.allow.toArray();
    const deny  = ow.deny.toArray();

    overwrites.push({
      id:        ow.id,
      type:      ow.type === 0 ? 'role' : 'member',
      name:      target ? (ow.type === 0 ? target.name : target.user.username) : ow.id,
      color:     ow.type === 0 && target ? target.hexColor : null,
      allow,
      deny,
    });
  });
  return overwrites;
}

/**
 * GET /api/guilds/:guildId/channels
 * Query: type (text, voice, category, all), detail (true = include permissions)
 */
router.get('/:guildId/channels', (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const { type = 'all', detail = 'false' } = req.query;
    const typeMap = { text: [0], voice: [2], category: [4], all: null };
    const allowedTypes = typeMap[type] || null;
    const includeDetail = detail === 'true';

    const channels = guild.channels.cache
      .filter(c => !allowedTypes || allowedTypes.includes(c.type))
      .sort((a, b) => {
        // Sort categories first, then by position
        if (a.type === 4 && b.type !== 4) return -1;
        if (a.type !== 4 && b.type === 4) return 1;
        if (a.parentId === b.parentId) return a.position - b.position;
        const aParent = a.parentId ? (guild.channels.cache.get(a.parentId)?.position ?? 999) : -1;
        const bParent = b.parentId ? (guild.channels.cache.get(b.parentId)?.position ?? 999) : -1;
        return aParent - bParent || a.position - b.position;
      })
      .map(c => {
        const base = {
          id: c.id,
          name: c.name,
          type: c.type,
          typeName: CHANNEL_TYPE_NAMES[c.type] || 'Unknown',
          parent: c.parentId,
          parentName: c.parentId ? guild.channels.cache.get(c.parentId)?.name || null : null,
          position: c.position,
          topic: c.topic || null,
          nsfw: c.nsfw || false,
        };

        if (includeDetail) {
          base.overwrites = serializeOverwrites(c, guild);
        }

        return base;
      });

    const response = { channels };
    if (includeDetail) {
      response.permissionLabels = PERM_LABELS;
    }

    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/guilds/:guildId/channels
 * Body: { name, type, parent, topic, nsfw, permissionOverwrites }
 * type: 'text' | 'voice' | 'category' | 'announcement' | 'stage' | 'forum'
 * permissionOverwrites: [ { id: roleId, allow: ['ViewChannel'], deny: ['SendMessages'] } ]
 */
router.post('/:guildId/channels', async (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const { name, type = 'text', parent, topic, nsfw = false, permissionOverwrites } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const typeMap = { text: 0, voice: 2, category: 4, announcement: 5, stage: 13, forum: 15 };
    const channelType = typeMap[type];
    if (channelType === undefined) return res.status(400).json({ error: `Invalid type. Use: ${Object.keys(typeMap).join(', ')}` });

    const opts = {
      name,
      type: channelType,
      reason: 'Created via Dashboard',
    };

    if (parent) opts.parent = parent;
    if (topic && channelType === 0) opts.topic = topic;
    if (nsfw) opts.nsfw = true;

    // Build permission overwrites
    if (Array.isArray(permissionOverwrites) && permissionOverwrites.length > 0) {
      opts.permissionOverwrites = permissionOverwrites.map(ow => ({
        id: ow.id,
        allow: ow.allow || [],
        deny:  ow.deny  || [],
      }));
    }

    const channel = await guild.channels.create(opts);

    res.json({
      success: true,
      channel: { id: channel.id, name: channel.name, type: channel.type },
    });
  } catch (err) {
    console.error('API create channel error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/guilds/:guildId/channels/:channelId
 */
router.delete('/:guildId/channels/:channelId', async (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const channel = guild.channels.cache.get(req.params.channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const name = channel.name;
    await channel.delete('Deleted via Dashboard');

    res.json({ success: true, deleted: name });
  } catch (err) {
    console.error('API delete channel error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/guilds/:guildId/channels/:channelId/permissions
 * Returns detailed permission overwrites for one channel
 */
router.get('/:guildId/channels/:channelId/permissions', (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const channel = guild.channels.cache.get(req.params.channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const overwrites = serializeOverwrites(channel, guild);

    // Get all roles for the "add role" dropdown
    const roles = guild.roles.cache
      .sort((a, b) => b.position - a.position)
      .map(r => ({ id: r.id, name: r.name, color: r.hexColor }));

    res.json({
      channelId: channel.id,
      channelName: channel.name,
      channelType: channel.type,
      overwrites,
      roles,
      permissionLabels: PERM_LABELS,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/guilds/:guildId/channels/:channelId/permissions
 * Body: { overwrites: [ { id, type, allow: [...], deny: [...] } ] }
 * Replaces ALL permission overwrites for the channel
 */
router.put('/:guildId/channels/:channelId/permissions', async (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const channel = guild.channels.cache.get(req.params.channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const { overwrites } = req.body;
    if (!Array.isArray(overwrites)) return res.status(400).json({ error: 'overwrites array is required' });

    // Clear existing overwrites and set new ones
    // First remove all current overwrites
    const existing = [...channel.permissionOverwrites.cache.keys()];
    for (const id of existing) {
      await channel.permissionOverwrites.delete(id, 'Updated via Dashboard');
    }

    // Apply new overwrites
    for (const ow of overwrites) {
      if (!ow.id) continue;
      await channel.permissionOverwrites.create(ow.id, {}, { reason: 'Updated via Dashboard' });
      // Now set the actual permissions
      const allowPerms = {};
      const denyPerms = {};
      if (Array.isArray(ow.allow)) ow.allow.forEach(p => { allowPerms[p] = true; });
      if (Array.isArray(ow.deny))  ow.deny.forEach(p =>  { denyPerms[p] = true; });

      // Merge: allowed = true, denied = false, inherit = null
      const merged = {};
      Object.keys(PERM_LABELS).forEach(perm => {
        if (allowPerms[perm]) merged[perm] = true;
        else if (denyPerms[perm]) merged[perm] = false;
        else merged[perm] = null;
      });

      await channel.permissionOverwrites.edit(ow.id, merged, { reason: 'Updated via Dashboard' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('API update permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/guilds/:guildId/channels/:channelId
 * Body: { name, topic, nsfw, parent }
 */
router.put('/:guildId/channels/:channelId', async (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const channel = guild.channels.cache.get(req.params.channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const updates = {};
    if (req.body.name !== undefined)  updates.name = req.body.name;
    if (req.body.topic !== undefined) updates.topic = req.body.topic;
    if (req.body.nsfw !== undefined)  updates.nsfw = !!req.body.nsfw;
    if (req.body.parent !== undefined) updates.parent = req.body.parent || null;

    await channel.edit({ ...updates, reason: 'Edited via Dashboard' });

    res.json({ success: true });
  } catch (err) {
    console.error('API edit channel error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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
      actions: actions.map(a => ({
        id: a.id,
        type: a.action_type,
        user: a.user_id,
        moderator: a.moderator_id,
        reason: a.reason,
        duration: a.duration,
        date: a.created_at,
      })),
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

    // Group by user
    const grouped = {};
    warnings.forEach(w => {
      if (!grouped[w.user_id]) {
        grouped[w.user_id] = { userId: w.user_id, user: w.user_id, count: 0, latestDate: w.created_at, latestReason: w.reason, warnings: [] };
      }
      grouped[w.user_id].count++;
      grouped[w.user_id].warnings.push(w);
    });

    res.json({ warnings: Object.values(grouped) });
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

    const client = getClient(req);

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

    // Build breakdown object
    const breakdown = {};
    typeBreakdown.forEach(t => { breakdown[t.type] = t.count; });

    res.json({
      total: totalActions,
      warnings: totalWarnings,
      mutes: breakdown.mute || 0,
      kicks: breakdown.kick || 0,
      bans: breakdown.ban || 0,
      timeouts: breakdown.timeout || 0,
      typeBreakdown,
      topModerators: topModerators.map(m => ({
        name: m.moderator_id,
        actions: m.actions,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/guilds/:guildId/moderation/ban
 * Body: { userId, reason, deleteMessageDays }
 */
router.post('/:guildId/moderation/ban', async (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const { userId, reason, deleteMessageDays = 0 } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const client = getClient(req);

    // Try DM before ban
    try {
      const user = await client.users.fetch(userId);
      await user.send(`You have been **banned** from **${guild.name}**${reason ? ` for: ${reason}` : ''}`);
    } catch { /* DM failed */ }

    await guild.members.ban(userId, {
      reason: reason || 'No reason provided (Dashboard)',
      deleteMessageSeconds: Math.min(parseInt(deleteMessageDays) || 0, 7) * 86400,
    });

    db.run(
      'INSERT INTO mod_actions (action_type, guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?, ?)',
      ['ban', guild.id, userId, client.user.id, reason || 'Dashboard action']
    );

    res.json({ success: true });
  } catch (err) {
    console.error('API ban error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/guilds/:guildId/moderation/kick
 * Body: { userId, reason }
 */
router.post('/:guildId/moderation/kick', async (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const { userId, reason } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const client = getClient(req);

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return res.status(404).json({ error: 'Member not found in server' });

    // Try DM before kick
    try {
      await member.send(`You have been **kicked** from **${guild.name}**${reason ? ` for: ${reason}` : ''}`);
    } catch { /* DM failed */ }

    await member.kick(reason || 'No reason provided (Dashboard)');

    db.run(
      'INSERT INTO mod_actions (action_type, guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?, ?)',
      ['kick', guild.id, userId, client.user.id, reason || 'Dashboard action']
    );

    res.json({ success: true });
  } catch (err) {
    console.error('API kick error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/guilds/:guildId/moderation/timeout
 * Body: { userId, reason, duration } (duration in minutes)
 */
router.post('/:guildId/moderation/timeout', async (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const { userId, reason, duration = 60 } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const client = getClient(req);

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return res.status(404).json({ error: 'Member not found in server' });

    const ms = Math.min(parseInt(duration), 40320) * 60 * 1000; // max 28 days
    await member.timeout(ms, reason || 'No reason provided (Dashboard)');

    db.run(
      'INSERT INTO mod_actions (action_type, guild_id, user_id, moderator_id, reason, duration) VALUES (?, ?, ?, ?, ?, ?)',
      ['timeout', guild.id, userId, client.user.id, reason || 'Dashboard action', `${duration}m`]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('API timeout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/guilds/:guildId/moderation/clear
 * Body: { channelId, amount }
 */
router.post('/:guildId/moderation/clear', async (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const { channelId, amount = 10 } = req.body;
    if (!channelId) return res.status(400).json({ error: 'channelId is required' });

    const channel = guild.channels.cache.get(channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (!channel.isTextBased()) return res.status(400).json({ error: 'Not a text channel' });

    const count = Math.min(parseInt(amount), 100);
    const deleted = await channel.bulkDelete(count, true);

    const client = getClient(req);
    db.run(
      'INSERT INTO mod_actions (action_type, guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?, ?)',
      ['clear', guild.id, channelId, client.user.id, `Cleared ${deleted.size} messages in #${channel.name}`]
    );

    res.json({ success: true, deleted: deleted.size });
  } catch (err) {
    console.error('API clear error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/guilds/:guildId/moderation/blocklist
 */
router.get('/:guildId/moderation/blocklist', (req, res) => {
  try {
    const { guildId } = req.params;
    const words = db.all('SELECT * FROM blocked_words WHERE guild_id = ? ORDER BY added_at DESC', [guildId]);
    res.json({ words });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/guilds/:guildId/moderation/blocklist
 * Body: { word }
 */
router.post('/:guildId/moderation/blocklist', (req, res) => {
  try {
    const { guildId } = req.params;
    const { word } = req.body;
    if (!word) return res.status(400).json({ error: 'word is required' });

    const client = getClient(req);
    db.run(
      'INSERT OR IGNORE INTO blocked_words (guild_id, word, added_by) VALUES (?, ?, ?)',
      [guildId, word.toLowerCase().trim(), client.user.id]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/guilds/:guildId/moderation/blocklist/:wordId
 */
router.delete('/:guildId/moderation/blocklist/:wordId', (req, res) => {
  try {
    const { guildId, wordId } = req.params;
    db.run('DELETE FROM blocked_words WHERE id = ? AND guild_id = ?', [wordId, guildId]);
    res.json({ success: true });
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
        memberCount: r.members.size,
        position: r.position,
        managed: r.managed,
        hoist: r.hoist,
        mentionable: r.mentionable,
        permissions: r.permissions.toArray(),
      }));

    res.json({ roles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/guilds/:guildId/roles
 * Body: { name, color, hoist, mentionable }
 */
router.post('/:guildId/roles', async (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const { name, color, hoist = false, mentionable = false } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const role = await guild.roles.create({
      name,
      color: color || undefined,
      hoist: !!hoist,
      mentionable: !!mentionable,
      reason: 'Created via Dashboard',
    });

    res.json({ success: true, role: { id: role.id, name: role.name, color: role.hexColor } });
  } catch (err) {
    console.error('API create role error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/guilds/:guildId/roles/:roleId
 * Body: { name, color, hoist, mentionable }
 */
router.put('/:guildId/roles/:roleId', async (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const role = guild.roles.cache.get(req.params.roleId);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.managed) return res.status(400).json({ error: 'Cannot edit managed/bot roles' });

    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.color !== undefined) updates.color = req.body.color || null;
    if (req.body.hoist !== undefined) updates.hoist = !!req.body.hoist;
    if (req.body.mentionable !== undefined) updates.mentionable = !!req.body.mentionable;

    await role.edit({ ...updates, reason: 'Edited via Dashboard' });

    res.json({ success: true });
  } catch (err) {
    console.error('API edit role error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/guilds/:guildId/roles/:roleId
 */
router.delete('/:guildId/roles/:roleId', async (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const role = guild.roles.cache.get(req.params.roleId);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.managed) return res.status(400).json({ error: 'Cannot delete managed/bot roles' });

    await role.delete('Deleted via Dashboard');
    res.json({ success: true });
  } catch (err) {
    console.error('API delete role error:', err.message);
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
router.get('/:guildId/leveling/leaderboard', async (req, res) => {
  try {
    const { guildId } = req.params;
    const { search, limit = 25 } = req.query;
    const guild = getGuild(req);

    let query = 'SELECT * FROM levels WHERE guild_id = ?';
    const params = [guildId];

    if (search) {
      query += ' AND user_id = ?';
      params.push(search);
    }

    query += ' ORDER BY level DESC, xp DESC LIMIT ?';
    params.push(parseInt(limit));

    const users = db.all(query, params);

    // Enrich with usernames from cache
    const enriched = [];
    for (const u of users) {
      let username = u.user_id;
      if (guild) {
        const member = guild.members.cache.get(u.user_id);
        if (member) username = member.user.username;
      }
      enriched.push({
        userId: u.user_id,
        username,
        level: u.level,
        xp: Math.round(u.xp * 10) / 10,
        messageCount: u.messages,
        voiceMinutes: u.voice_minutes || 0,
      });
    }

    res.json({ users: enriched });
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

    const totalXp = db.get(
      'SELECT SUM(xp) as total FROM levels WHERE guild_id = ?', [guildId]
    )?.total || 0;

    const avgLevel = db.get(
      'SELECT AVG(level) as avg FROM levels WHERE guild_id = ?', [guildId]
    )?.avg || 0;

    const topLevel = db.get(
      'SELECT MAX(level) as maxLevel FROM levels WHERE guild_id = ?', [guildId]
    )?.maxLevel || 0;

    const totalMessages = db.get(
      'SELECT SUM(messages) as total FROM levels WHERE guild_id = ?', [guildId]
    )?.total || 0;

    res.json({
      totalUsers,
      activeUsers: totalUsers,
      totalXp: Math.round(totalXp),
      averageLevel: avgLevel,
      topLevel,
      totalMessages,
      topTierMembers: 0,
    });
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

/**
 * POST /api/guilds/:guildId/leveling/reset
 * Body: { userId }  — reset single user
 */
router.post('/:guildId/leveling/reset', (req, res) => {
  try {
    const { guildId } = req.params;
    const { userId } = req.body;

    if (!userId) return res.status(400).json({ error: 'userId is required' });

    db.run('DELETE FROM levels WHERE user_id = ? AND guild_id = ?', [userId, guildId]);
    db.run('DELETE FROM daily_xp WHERE user_id = ? AND guild_id = ?', [userId, guildId]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/guilds/:guildId/leveling/reset-all
 * Resets ALL user XP for the guild
 */
router.post('/:guildId/leveling/reset-all', (req, res) => {
  try {
    const { guildId } = req.params;

    db.run('DELETE FROM levels WHERE guild_id = ?', [guildId]);
    db.run('DELETE FROM daily_xp WHERE guild_id = ?', [guildId]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// CONFIG & SETUP
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

    // Get guild locale
    const { guildId } = req.params;
    const guildSetting = db.get('SELECT locale FROM guild_settings WHERE guild_id = ?', [guildId]);

    res.json({ config, env, locale: guildSetting?.locale || process.env.LOCALE || 'en' });
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

/**
 * POST /api/guilds/:guildId/config/language
 * Body: { locale }
 */
router.post('/:guildId/config/language', (req, res) => {
  try {
    const { guildId } = req.params;
    const { locale } = req.body;

    const supported = ['en', 'tr', 'de', 'es', 'fr', 'pt', 'ru', 'ar'];
    if (!locale || !supported.includes(locale)) {
      return res.status(400).json({ error: `Unsupported locale. Supported: ${supported.join(', ')}` });
    }

    // Upsert guild locale
    const existing = db.get('SELECT guild_id FROM guild_settings WHERE guild_id = ?', [guildId]);
    if (existing) {
      db.run('UPDATE guild_settings SET locale = ?, updated_at = ? WHERE guild_id = ?',
        [locale, new Date().toISOString(), guildId]);
    } else {
      db.run('INSERT INTO guild_settings (guild_id, locale, updated_at) VALUES (?, ?, ?)',
        [guildId, locale, new Date().toISOString()]);
    }

    res.json({ success: true, locale });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// AFK CHANNEL SETUP
// ══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/guilds/:guildId/setup/afk
 * Creates the AFK voice channel + category if not already present
 */
router.post('/:guildId/setup/afk', async (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const { createAfkChannel } = require('../../commands/setup/afk-setup');
    const result = await createAfkChannel(guild);

    res.json(result);
  } catch (err) {
    console.error('API AFK setup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/guilds/:guildId/setup/channel-status
 * Returns the status of every bot feature channel group (which exist, which are missing).
 */
router.get('/:guildId/setup/channel-status', (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const { buildLocalizedDefaultConfig } = require('../../systems/serverSetup');
    const { channelName } = require('../../utils/locale');
    const config = buildLocalizedDefaultConfig();

    // Define the 9 feature groups mapped to their category index in config.categories
    const GROUP_META = {
      verification:  { label: 'Verification',       icon: '✅', catIndex: 0, description: 'Rules & verify channels for new members' },
      roles:         { label: 'Role Menus',          icon: '🎨', catIndex: 1, description: 'Self-assign color, game, and platform roles' },
      chat:          { label: 'Chat Channels',       icon: '💬', catIndex: 2, description: 'General chat, media, bot commands, AI chat' },
      welcome:       { label: 'Welcome & Goodbye',   icon: '👋', catIndex: 3, description: 'Automated welcome and farewell messages' },
      voice:         { label: 'Voice Channels',      icon: '🔊', catIndex: 4, description: 'General voice, gaming, and music channels' },
      logs:          { label: 'Log Channels',        icon: '📋', catIndex: 5, description: 'Staff-only audit and moderation logs' },
      staff:         { label: 'Staff Area',          icon: '🛡️', catIndex: 6, description: 'Private staff chat, commands, and voice' },
      streaming:     { label: 'Streaming',           icon: '🎬', catIndex: 7, description: 'Live stream announcements and chat' },
      afk:           { label: 'AFK Channel',         icon: '💤', catIndex: 8, description: 'Idle members auto-moved here after timeout' },
    };

    const channelNames = guild.channels.cache.map(c => c.name.toLowerCase());

    const groups = {};

    for (const [groupKey, meta] of Object.entries(GROUP_META)) {
      const catCfg = config.categories[meta.catIndex];
      if (!catCfg) continue;

      const expectedChannels = catCfg.channels.map(ch => ({
        name: ch.name,
        type: ch.type,
        exists: channelNames.some(n => n === ch.name.toLowerCase()),
      }));

      const existingCount = expectedChannels.filter(c => c.exists).length;
      const totalCount = expectedChannels.length;

      // Check if category exists
      const catExists = guild.channels.cache.some(
        c => c.type === 4 && c.name.toLowerCase() === catCfg.name.toLowerCase()
      );

      // Special AFK check: also verify guild.afkChannelId is set
      let afkConfigured = false;
      if (groupKey === 'afk') {
        afkConfigured = !!guild.afkChannelId && !!guild.channels.cache.get(guild.afkChannelId);
      }

      groups[groupKey] = {
        ...meta,
        categoryName: catCfg.name,
        categoryExists: catExists,
        channels: expectedChannels,
        existingCount,
        totalCount,
        complete: existingCount === totalCount && (groupKey !== 'afk' || afkConfigured),
        afkConfigured: groupKey === 'afk' ? afkConfigured : undefined,
        afkTimeoutMinutes: groupKey === 'afk' ? Math.floor((guild.afkTimeout || 0) / 60) : undefined,
      };
    }

    res.json({ groups });
  } catch (err) {
    console.error('API channel-status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/guilds/:guildId/setup/channel-group
 * Body: { group: 'verification' | 'roles' | 'chat' | ... }
 * Creates the specified feature channel group (category + channels + permissions).
 */
router.post('/:guildId/setup/channel-group', async (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const { group } = req.body;
    if (!group) return res.status(400).json({ error: 'group is required' });

    // Special case: AFK uses the existing dedicated handler
    if (group === 'afk') {
      const { createAfkChannel } = require('../../commands/setup/afk-setup');
      const result = await createAfkChannel(guild);
      return res.json({ success: true, created: result.created ? 1 : 0, skipped: result.created ? 0 : 1, message: result.message });
    }

    const { ChannelType: CT, PermissionFlagsBits: PFB } = require('discord.js');
    const { buildLocalizedDefaultConfig } = require('../../systems/serverSetup');
    const config = buildLocalizedDefaultConfig();

    const GROUP_CAT_INDEX = {
      verification: 0, roles: 1, chat: 2, welcome: 3, voice: 4, logs: 5, staff: 6, streaming: 7, afk: 8,
    };

    const catIndex = GROUP_CAT_INDEX[group];
    if (catIndex === undefined) return res.status(400).json({ error: `Unknown group: ${group}` });

    const catCfg = config.categories[catIndex];
    if (!catCfg) return res.status(400).json({ error: 'Group config not found' });

    const PERM_MAP = {
      ViewChannel: PFB.ViewChannel, SendMessages: PFB.SendMessages, ReadMessageHistory: PFB.ReadMessageHistory,
      AddReactions: PFB.AddReactions, AttachFiles: PFB.AttachFiles, EmbedLinks: PFB.EmbedLinks,
      Connect: PFB.Connect, Speak: PFB.Speak, ManageMessages: PFB.ManageMessages,
      KickMembers: PFB.KickMembers, MuteMembers: PFB.MuteMembers, DeafenMembers: PFB.DeafenMembers,
      MoveMembers: PFB.MoveMembers, ManageNicknames: PFB.ManageNicknames, ModerateMembers: PFB.ModerateMembers,
      Administrator: PFB.Administrator,
    };

    const everyoneRole = guild.roles.everyone;
    const staffRoles = guild.roles.cache.filter(
      r => r.permissions.has(PFB.Administrator) || r.permissions.has(PFB.ManageMessages)
    );

    // Find or create category
    let category = guild.channels.cache.find(
      c => c.type === CT.GuildCategory && c.name.toLowerCase() === catCfg.name.toLowerCase()
    );

    let created = 0;
    let skipped = 0;

    if (!category) {
      const catPerms = [];
      if (catCfg.staffOnly) {
        catPerms.push({ id: everyoneRole.id, deny: [PFB.ViewChannel] });
        for (const [, sr] of staffRoles) {
          catPerms.push({ id: sr.id, allow: [PFB.ViewChannel, PFB.SendMessages] });
        }
      }
      category = await guild.channels.create({
        name: catCfg.name, type: CT.GuildCategory,
        permissionOverwrites: catPerms, reason: 'Quick Setup via Dashboard',
      });
    }

    // Create channels
    for (const chCfg of catCfg.channels) {
      const channelType = chCfg.type === 'voice' ? CT.GuildVoice : CT.GuildText;

      const exists = guild.channels.cache.find(
        c => c.name.toLowerCase() === chCfg.name.toLowerCase() && c.parentId === category.id
      );
      if (exists) { skipped++; continue; }

      // Build permission overwrites
      const overwrites = [];
      if (catCfg.staffOnly) {
        overwrites.push({ id: everyoneRole.id, deny: [PFB.ViewChannel] });
        for (const [, sr] of staffRoles) {
          overwrites.push({ id: sr.id, allow: [PFB.ViewChannel, PFB.SendMessages] });
        }
      } else if (chCfg.permissions) {
        for (const [roleName, perms] of Object.entries(chCfg.permissions)) {
          let targetId;
          if (roleName === 'everyone') {
            targetId = everyoneRole.id;
          } else {
            const role = guild.roles.cache.find(r => r.name === roleName);
            if (!role) continue;
            targetId = role.id;
          }
          const ow = { id: targetId };
          if (perms.allow) ow.allow = perms.allow.map(p => PERM_MAP[p]).filter(Boolean);
          if (perms.deny)  ow.deny  = perms.deny.map(p => PERM_MAP[p]).filter(Boolean);
          overwrites.push(ow);
        }
      }

      await guild.channels.create({
        name: chCfg.name, type: channelType, parent: category.id,
        topic: chCfg.topic || null, permissionOverwrites: overwrites,
        reason: 'Quick Setup via Dashboard',
      });
      created++;
    }

    res.json({ success: true, created, skipped, categoryName: catCfg.name });
  } catch (err) {
    console.error('API channel-group setup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/guilds/:guildId/setup/afk
 * Returns current AFK channel status for the guild
 */
router.get('/:guildId/setup/afk', (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const afkChannel = guild.afkChannelId
      ? guild.channels.cache.get(guild.afkChannelId)
      : null;

    res.json({
      hasAfkChannel: !!afkChannel,
      channelId: afkChannel?.id || null,
      channelName: afkChannel?.name || null,
      afkTimeout: guild.afkTimeout || 0,
      afkTimeoutMinutes: Math.floor((guild.afkTimeout || 0) / 60),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
