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

    const { search = '', limit = 50, page = 1 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));

    let allMembers;

    if (search) {
      allMembers = await guild.members.fetch({ query: search, limit: limitNum });
      allMembers = [...allMembers.values()];
    } else {
      // Fetch all members (Discord.js caches them after first fetch)
      if (guild.members.cache.size < guild.memberCount) {
        try {
          await guild.members.fetch();
        } catch {
          // Fallback to cache if fetch fails
        }
      }
      allMembers = [...guild.members.cache.values()];
    }

    // Sort: non-bots first, then by display name
    allMembers.sort((a, b) => {
      if (a.user.bot !== b.user.bot) return a.user.bot ? 1 : -1;
      return a.displayName.localeCompare(b.displayName);
    });

    // Filter out bots
    const nonBots = allMembers.filter(m => !m.user.bot);

    // Paginate
    const totalMembers = nonBots.length;
    const totalPages = Math.ceil(totalMembers / limitNum);
    const offset = (pageNum - 1) * limitNum;
    const paginated = nonBots.slice(offset, offset + limitNum);

    const list = paginated.map(m => ({
      id: m.id,
      username: m.user.username,
      displayName: m.displayName,
      avatar: m.user.displayAvatarURL({ size: 32 }),
      bot: m.user.bot,
      joinedAt: m.joinedAt?.toISOString() || null,
      roles: m.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).slice(0, 3),
    }));

    res.json({
      members: list,
      pagination: { page: pageNum, limit: limitNum, total: totalMembers, totalPages },
    });
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

    const { name, type = 'text', parent, parentName, topic, nsfw = false, permissionOverwrites } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const typeMap = { text: 0, voice: 2, category: 4, announcement: 5, stage: 13, forum: 15 };
    const channelType = typeof type === 'number' ? type : typeMap[type];
    if (channelType === undefined) return res.status(400).json({ error: `Invalid type. Use: ${Object.keys(typeMap).join(', ')}` });

    const opts = {
      name,
      type: channelType,
      reason: 'Created via Dashboard',
    };

    if (parent) {
      opts.parent = parent;
    } else if (parentName) {
      const cat = guild.channels.cache.find(c => c.type === 4 && c.name.toLowerCase() === parentName.toLowerCase());
      if (cat) opts.parent = cat.id;
    }
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

    // Check bot hierarchy — can't kick members with roles at or above bot's highest
    const botMemberKick = guild.members.me;
    if (botMemberKick && member.roles.highest.position >= botMemberKick.roles.highest.position) {
      return res.status(403).json({ error: `Cannot kick ${member.user.tag} — their highest role is at or above the bot's.` });
    }

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
 * Body: { name, color, hoist, mentionable, permissions }
 * permissions: array of permission flag names to enable (e.g. ['SendMessages', 'ViewChannel'])
 */
router.put('/:guildId/roles/:roleId', async (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const role = guild.roles.cache.get(req.params.roleId);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.managed) return res.status(400).json({ error: 'Cannot edit managed/bot roles' });

    // Check bot role hierarchy
    const botMember = guild.members.me;
    if (botMember && role.position >= botMember.roles.highest.position) {
      return res.status(403).json({ error: `Cannot edit "${role.name}" — it is at or above the bot's highest role. Move the bot's role higher in Server Settings.` });
    }

    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.color !== undefined) updates.color = req.body.color || null;
    if (req.body.hoist !== undefined) updates.hoist = !!req.body.hoist;
    if (req.body.mentionable !== undefined) updates.mentionable = !!req.body.mentionable;

    // Handle permissions update
    if (Array.isArray(req.body.permissions)) {
      const { PermissionsBitField } = require('discord.js');
      const validPerms = Object.keys(PermissionsBitField.Flags);
      const filtered = req.body.permissions.filter(p => validPerms.includes(p));
      updates.permissions = filtered;
    }

    await role.edit({ ...updates, reason: 'Edited via Dashboard' });

    res.json({ success: true });
  } catch (err) {
    console.error('API edit role error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/guilds/:guildId/roles/:roleId/members
 * Returns members with this role (for the role detail view)
 * Query: limit (default 50)
 */
router.get('/:guildId/roles/:roleId/members', (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const role = guild.roles.cache.get(req.params.roleId);
    if (!role) return res.status(404).json({ error: 'Role not found' });

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    const members = [...role.members.values()]
      .slice(0, limit)
      .map(m => ({
        id: m.id,
        username: m.user.username,
        displayName: m.displayName,
        avatar: m.user.displayAvatarURL({ size: 32 }),
        bot: m.user.bot,
      }));

    res.json({ members, total: role.members.size });
  } catch (err) {
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

    // Check bot role hierarchy — bot can only delete roles below its own highest role
    const botMember = guild.members.me;
    if (botMember && role.position >= botMember.roles.highest.position) {
      return res.status(403).json({
        error: `Cannot delete "${role.name}" — it is at position ${role.position}, but the bot's highest role is at position ${botMember.roles.highest.position}. Move the bot's role higher in Server Settings → Roles.`,
      });
    }

    await role.delete('Deleted via Dashboard');
    res.json({ success: true });
  } catch (err) {
    console.error('API delete role error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/guilds/:guildId/roles/bulk-delete
 * Delete multiple roles at once
 * Body: { roleIds: string[] }
 */
router.post('/:guildId/roles/bulk-delete', async (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const { roleIds } = req.body;
    if (!Array.isArray(roleIds) || roleIds.length === 0) {
      return res.status(400).json({ error: 'roleIds array is required' });
    }

    const botMember = guild.members.me;
    const botHighest = botMember ? botMember.roles.highest.position : 0;

    const results = { deleted: [], failed: [] };

    for (const roleId of roleIds) {
      const role = guild.roles.cache.get(roleId);
      if (!role) { results.failed.push({ id: roleId, reason: 'Not found' }); continue; }
      if (role.managed) { results.failed.push({ id: roleId, name: role.name, reason: 'Managed by integration' }); continue; }
      if (role.position >= botHighest) { results.failed.push({ id: roleId, name: role.name, reason: 'Role is above bot' }); continue; }

      try {
        await role.delete('Bulk deleted via Dashboard');
        results.deleted.push({ id: roleId, name: role.name });
      } catch (err) {
        results.failed.push({ id: roleId, name: role.name, reason: err.message });
      }
    }

    res.json({ success: true, ...results });
  } catch (err) {
    console.error('API bulk-delete roles error:', err.message);
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

    // Check bot role hierarchy
    const botMember = guild.members.me;
    if (botMember && role.position >= botMember.roles.highest.position) {
      return res.status(403).json({ error: `Cannot assign "${role.name}" — it is at or above the bot's highest role.` });
    }

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

    // Check bot role hierarchy
    const botMemberRM = guild.members.me;
    if (botMemberRM && role.position >= botMemberRM.roles.highest.position) {
      return res.status(403).json({ error: `Cannot remove "${role.name}" — it is at or above the bot's highest role.` });
    }

    await member.roles.remove(role);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ROLE MENUS
// ══════════════════════════════════════════════════════════════════════════

const roleMenus = require('../../systems/roleMenus');

/** List all role menus for a guild */
router.get('/:guildId/role-menus', (req, res) => {
  try {
    const menus = roleMenus.getMenusForGuild(req.params.guildId);
    res.json({ menus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Seed role menus from JSON config */
router.post('/:guildId/role-menus/seed', (req, res) => {
  try {
    roleMenus.seedMenusFromConfig(req.params.guildId);
    const menus = roleMenus.getMenusForGuild(req.params.guildId);
    res.json({ success: true, menus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Create a new role menu */
router.post('/:guildId/role-menus', (req, res) => {
  try {
    const { slug, title, description, color, singleSelect, requiredRoleId } = req.body;
    if (!slug || !title) return res.status(400).json({ error: 'slug and title are required' });

    const safeSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    if (roleMenus.getMenuBySlug(req.params.guildId, safeSlug)) {
      return res.status(409).json({ error: `Menu with slug "${safeSlug}" already exists` });
    }

    const menuId = roleMenus.createMenu(req.params.guildId, {
      slug: safeSlug, title, description, color, singleSelect, requiredRoleId,
    });
    const menu = roleMenus.getMenuWithItems(menuId);
    res.json({ menu });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Get a single role menu with items */
router.get('/:guildId/role-menus/:menuId', (req, res) => {
  try {
    const menu = roleMenus.getMenuWithItems(parseInt(req.params.menuId, 10));
    if (!menu || menu.guild_id !== req.params.guildId) {
      return res.status(404).json({ error: 'Menu not found' });
    }
    // Attach published messages
    menu.messages = roleMenus.getPublishedMessages(menu.id, req.params.guildId);
    res.json({ menu });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Update a role menu's settings */
router.put('/:guildId/role-menus/:menuId', async (req, res) => {
  try {
    const menuId = parseInt(req.params.menuId, 10);
    const menu = roleMenus.getMenuWithItems(menuId);
    if (!menu || menu.guild_id !== req.params.guildId) {
      return res.status(404).json({ error: 'Menu not found' });
    }

    const fields = {};
    if (req.body.title != null) fields.title = req.body.title;
    if (req.body.description != null) fields.description = req.body.description;
    if (req.body.color != null) fields.color = req.body.color;
    if (req.body.singleSelect != null) fields.single_select = req.body.singleSelect ? 1 : 0;
    if (req.body.requiredRoleId !== undefined) fields.required_role_id = req.body.requiredRoleId || null;

    roleMenus.updateMenu(menuId, fields);

    // Update published Discord messages to reflect changes
    const client = getClient(req);
    if (client) {
      roleMenus.updatePublishedMenus(client, req.params.guildId, menuId).catch(err => {
        console.warn('Failed to update published menus:', err.message);
      });
    }

    res.json({ menu: roleMenus.getMenuWithItems(menuId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Delete a role menu */
router.delete('/:guildId/role-menus/:menuId', (req, res) => {
  try {
    const menuId = parseInt(req.params.menuId, 10);
    const menu = roleMenus.getMenuWithItems(menuId);
    if (!menu || menu.guild_id !== req.params.guildId) {
      return res.status(404).json({ error: 'Menu not found' });
    }
    roleMenus.deleteMenu(menuId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Add a role item to a menu */
router.post('/:guildId/role-menus/:menuId/items', async (req, res) => {
  try {
    const menuId = parseInt(req.params.menuId, 10);
    const menu = roleMenus.getMenuWithItems(menuId);
    if (!menu || menu.guild_id !== req.params.guildId) {
      return res.status(404).json({ error: 'Menu not found' });
    }
    if (roleMenus.getMenuItemCount(menuId) >= 25) {
      return res.status(400).json({ error: 'Maximum 25 roles per menu (Discord button limit)' });
    }

    const { roleName, emoji, color, position } = req.body;
    if (!roleName) return res.status(400).json({ error: 'roleName is required' });

    if (menu.items.some(i => i.role_name.toLowerCase() === roleName.toLowerCase())) {
      return res.status(409).json({ error: `Role "${roleName}" already exists in this menu` });
    }

    const itemId = await roleMenus.addMenuItem(menuId, { roleName, emoji, color, position });

    // Update published Discord messages
    const client = getClient(req);
    if (client) {
      roleMenus.updatePublishedMenus(client, req.params.guildId, menuId).catch(err => {
        console.warn('Failed to update published menus:', err.message);
      });
    }

    res.json({ itemId, menu: roleMenus.getMenuWithItems(menuId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Update a role item */
router.put('/:guildId/role-menus/:menuId/items/:itemId', (req, res) => {
  try {
    const menuId = parseInt(req.params.menuId, 10);
    const menu = roleMenus.getMenuWithItems(menuId);
    if (!menu || menu.guild_id !== req.params.guildId) {
      return res.status(404).json({ error: 'Menu not found' });
    }

    const itemId = parseInt(req.params.itemId, 10);
    if (!menu.items.some(i => i.id === itemId)) {
      return res.status(404).json({ error: 'Item not found in this menu' });
    }

    const fields = {};
    if (req.body.roleName != null) fields.role_name = req.body.roleName;
    if (req.body.emoji != null) fields.emoji = req.body.emoji;
    if (req.body.color != null) fields.color = req.body.color;
    if (req.body.position != null) fields.position = req.body.position;

    roleMenus.updateMenuItem(itemId, fields);

    // Update published Discord messages
    const client = getClient(req);
    if (client) {
      roleMenus.updatePublishedMenus(client, req.params.guildId, menuId).catch(err => {
        console.warn('Failed to update published menus:', err.message);
      });
    }

    res.json({ menu: roleMenus.getMenuWithItems(menuId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Remove a role item from a menu */
router.delete('/:guildId/role-menus/:menuId/items/:itemId', (req, res) => {
  try {
    const menuId = parseInt(req.params.menuId, 10);
    const menu = roleMenus.getMenuWithItems(menuId);
    if (!menu || menu.guild_id !== req.params.guildId) {
      return res.status(404).json({ error: 'Menu not found' });
    }

    const itemId = parseInt(req.params.itemId, 10);
    if (!menu.items.some(i => i.id === itemId)) {
      return res.status(404).json({ error: 'Item not found in this menu' });
    }

    roleMenus.removeMenuItem(itemId);

    // Update published Discord messages
    const client = getClient(req);
    if (client) {
      roleMenus.updatePublishedMenus(client, req.params.guildId, menuId).catch(err => {
        console.warn('Failed to update published menus:', err.message);
      });
    }

    res.json({ success: true, menu: roleMenus.getMenuWithItems(menuId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Publish a menu to a Discord channel */
router.post('/:guildId/role-menus/:menuId/publish', async (req, res) => {
  try {
    const menuId = parseInt(req.params.menuId, 10);
    const menu = roleMenus.getMenuWithItems(menuId);
    if (!menu || menu.guild_id !== req.params.guildId) {
      return res.status(404).json({ error: 'Menu not found' });
    }

    const { channelId } = req.body;
    if (!channelId) return res.status(400).json({ error: 'channelId is required' });

    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const channel = await guild.channels.fetch(channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const message = await roleMenus.sendRoleMenuById(channel, menuId);
    res.json({ success: true, messageId: message.id, channelId: channel.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** List published message locations for a menu */
router.get('/:guildId/role-menus/:menuId/messages', (req, res) => {
  try {
    const menuId = parseInt(req.params.menuId, 10);
    const messages = roleMenus.getPublishedMessages(menuId, req.params.guildId);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Unpublish (delete) a published menu message */
router.delete('/:guildId/role-menus/:menuId/messages/:msgId', async (req, res) => {
  try {
    const client = getClient(req);
    await roleMenus.unpublishMessage(client, parseInt(req.params.msgId, 10));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// BOT MESSAGES
// ══════════════════════════════════════════════════════════════════════════

const botMessages = require('../../systems/botMessages');

/** List all bot messages for a guild */
router.get('/:guildId/bot-messages', (req, res) => {
  try {
    const messages = botMessages.getMessagesForGuild(req.params.guildId, {
      type: req.query.type || undefined,
      channelId: req.query.channelId || undefined,
    });
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Get message templates */
router.get('/:guildId/bot-messages/templates', (req, res) => {
  res.json({ templates: botMessages.getTemplates(req.params.guildId) });
});

/** Scan all channels for untracked bot messages */
router.post('/:guildId/bot-messages/scan', async (req, res) => {
  try {
    const client = getClient(req);
    if (!client) return res.status(500).json({ error: 'Bot client not available' });

    // Clear ALL previously auto-scanned entries (not user-created) to allow fresh re-scan
    db.run('DELETE FROM bot_messages WHERE guild_id = ? AND created_by IS NULL', [req.params.guildId]);

    const count = await botMessages.scanAllChannels(client, req.params.guildId);
    const messages = botMessages.getMessagesForGuild(req.params.guildId);
    res.json({ success: true, registered: count, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Get single bot message */
router.get('/:guildId/bot-messages/:id', (req, res) => {
  try {
    const msg = botMessages.getMessage(parseInt(req.params.id, 10));
    if (!msg || msg.guild_id !== req.params.guildId) {
      return res.status(404).json({ error: 'Message not found' });
    }
    res.json({ message: msg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Create a new bot message (draft) */
router.post('/:guildId/bot-messages', (req, res) => {
  try {
    const { name, messageType, content, channelId } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const id = botMessages.createMessage(req.params.guildId, {
      name,
      messageType: messageType || 'custom',
      content: content || {},
      channelId: channelId || null,
      createdBy: 'dashboard',
    });
    res.json({ message: botMessages.getMessage(id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Update a bot message */
router.put('/:guildId/bot-messages/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const msg = botMessages.getMessage(id);
    if (!msg || msg.guild_id !== req.params.guildId) {
      return res.status(404).json({ error: 'Message not found' });
    }
    if (msg.is_system) {
      return res.status(403).json({ error: 'System messages cannot be edited' });
    }

    const fields = {};
    if (req.body.name != null) fields.name = req.body.name;
    if (req.body.messageType != null) fields.messageType = req.body.messageType;
    if (req.body.content != null) fields.content = req.body.content;

    botMessages.updateMessage(id, fields);

    // Mark as default template if requested
    if (req.body.markAsDefault) {
      db.run("UPDATE bot_messages SET created_by = 'default', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
    }

    // Auto-update published Discord message
    if (msg.message_id) {
      const client = getClient(req);
      if (client) {
        botMessages.updatePublishedMessage(client, id).catch(err => {
          console.warn('Failed to update published bot message:', err.message);
        });
      }
    }

    res.json({ message: botMessages.getMessage(id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Delete a bot message */
router.delete('/:guildId/bot-messages/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const msg = botMessages.getMessage(id);
    if (!msg || msg.guild_id !== req.params.guildId) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (req.query.keepMessage === 'true') {
      // Delete DB record only, keep Discord message
      db.run('DELETE FROM bot_messages WHERE id = ?', [id]);
    } else {
      // Delete both DB record and Discord message
      const client = getClient(req);
      await botMessages.deleteMessage(client, id);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Publish a bot message to a channel */
router.post('/:guildId/bot-messages/:id/publish', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const msg = botMessages.getMessage(id);
    if (!msg || msg.guild_id !== req.params.guildId) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const { channelId } = req.body;
    if (!channelId) return res.status(400).json({ error: 'channelId is required' });

    const client = getClient(req);
    if (!client) return res.status(500).json({ error: 'Bot client not available' });

    // Stream-announcement: fill placeholders with real platform data (like /go-live)
    if (msg.message_type === 'stream-announcement') {
      const guild = getGuild(req);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });

      const { checkAllPlatforms, PLATFORMS } = require('../../systems/streamingChecker');
      const { activeAnnouncements } = require('../../systems/streamManager');

      const ownerId = process.env.STREAM_OWNER_ID || guild.ownerId;
      const links = db.all('SELECT * FROM streaming_links WHERE guild_id = ? AND user_id = ?', [guild.id, ownerId]);

      let ownerMember;
      try { ownerMember = await guild.members.fetch(ownerId); } catch {
        return res.status(404).json({ error: 'Stream owner not found in guild' });
      }

      const userName = ownerMember.displayName || ownerMember.user.username;
      const ownerAvatar = ownerMember.user.displayAvatarURL({ dynamic: true, size: 256 });

      // Fetch live platform data
      let platformResults = [];
      let platformsStatus = '';
      let streamTitle = '';
      if (links && links.length > 0) {
        try {
          platformResults = await checkAllPlatforms(links);
          const statusLines = platformResults.map(r => {
            if (r.isLive) {
              const viewerStr = r.viewers > 0 ? ` • 👥 ${r.viewers}` : '';
              return `${r.emoji} **${r.label}** — 🔴 LIVE${viewerStr}`;
            } else if (PLATFORMS[r.platform]?.canDetectLive) {
              return `${r.emoji} **${r.label}** — ⚫ Offline`;
            }
            return `${r.emoji} **${r.label}**`;
          });
          platformsStatus = statusLines.join('\n');
          const mainLive = platformResults.find(r => r.isLive && r.title);
          if (mainLive?.title) streamTitle = mainLive.title;
        } catch {}
      }

      // Parse template content and replace placeholders
      const content = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
      const replace = (text) => {
        if (!text) return text;
        return text
          .replace(/\{user\}/gi, userName)
          .replace(/\{stream_title\}/gi, streamTitle)
          .replace(/\{platforms_status\}/gi, platformsStatus)
          .replace(/\{platform\}/gi, platformResults.find(r => r.isLive)?.label || '')
          .replace(/\{viewers\}/gi, platformResults.find(r => r.isLive)?.viewers?.toString() || '')
          .replace(/\{game\}/gi, '')
          .replace(/\{title\}/gi, streamTitle)
          .replace(/\{url\}/gi, platformResults.find(r => r.isLive)?.liveUrl || '');
      };

      // Build embed
      const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
      const embed = new EmbedBuilder()
        .setColor(content.color?.startsWith('#') ? parseInt(content.color.replace('#', ''), 16) : 0xFF0000)
        .setThumbnail(ownerAvatar)
        .setTimestamp();

      if (content.author) embed.setAuthor({ name: replace(content.author), iconURL: ownerAvatar });
      if (content.title) embed.setTitle(replace(content.title));
      if (content.description) embed.setDescription(replace(content.description));
      if (content.footer) embed.setFooter({ text: replace(content.footer) });
      if (Array.isArray(content.fields)) {
        for (const f of content.fields) {
          if (f.name && f.value) {
            embed.addFields({ name: replace(f.name), value: replace(f.value) || '-', inline: !!f.inline });
          }
        }
      }

      // Build buttons per platform
      const components = [];
      const buttons = platformResults.map(r =>
        new ButtonBuilder()
          .setLabel(r.isLive ? `🔴 ${r.label}` : r.label)
          .setStyle(ButtonStyle.Link)
          .setURL(r.isLive ? r.liveUrl : r.url)
          .setEmoji(r.emoji)
      );
      for (let i = 0; i < buttons.length; i += 5) {
        components.push(new ActionRowBuilder().addComponents(...buttons.slice(i, i + 5)));
      }

      // Send or edit
      const channel = await guild.channels.fetch(channelId);
      const payload = { content: `🔴 **${userName}** ${require('../../utils/locale').t('streaming.isLiveNow', {}, guild.id) || 'şu anda YAYINDA!'}`, embeds: [embed], components };

      // Check for existing announcement to edit
      const existing = activeAnnouncements.get(guild.id);
      let sentMsg;
      if (existing) {
        try {
          const existingCh = guild.channels.cache.get(existing.channelId);
          const existingMsg = await existingCh?.messages.fetch(existing.messageId);
          if (existingMsg) {
            await existingMsg.edit(payload);
            sentMsg = existingMsg;
          }
        } catch {}
      }
      if (!sentMsg) {
        sentMsg = await channel.send(payload);
      }

      // Track as active announcement (prevents auto-detection from posting duplicate)
      activeAnnouncements.set(guild.id, { messageId: sentMsg.id, channelId: channel.id });

      // Update the bot_messages record with the message ID
      db.run('UPDATE bot_messages SET message_id = ?, channel_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [sentMsg.id, channel.id, id]);

      return res.json({ success: true, messageId: sentMsg.id });
    }

    const discordMsg = await botMessages.publishMessage(client, id, channelId);
    res.json({ success: true, messageId: discordMsg.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Unpublish a bot message (delete from Discord, keep draft) */
router.post('/:guildId/bot-messages/:id/unpublish', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const msg = botMessages.getMessage(id);
    if (!msg || msg.guild_id !== req.params.guildId) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const client = getClient(req);
    if (client) await botMessages.unpublishMessage(client, id);
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
    const { search, limit } = req.query;
    const guild = getGuild(req);
    const leveling = require('../../systems/leveling');

    let query = 'SELECT * FROM levels WHERE guild_id = ?';
    const params = [guildId];

    if (search) {
      query += ' AND user_id = ?';
      params.push(search);
    }

    const users = db.all(query, params);

    // Enrich with usernames and calculate true total XP
    const enriched = [];
    for (const u of users) {
      let username = u.user_id;
      if (guild) {
        const member = guild.members.cache.get(u.user_id);
        if (member) username = member.user.username;
      }
      const totalXp = leveling.totalXpForLevel(u.level) + (u.xp || 0);
      enriched.push({
        userId: u.user_id,
        username,
        level: u.level,
        xp: Math.round(totalXp * 10) / 10,
        currentLevelXp: Math.round(u.xp * 10) / 10,
        xpNeeded: leveling.xpForLevel(u.level),
        messageCount: u.messages,
        voiceMinutes: u.voice_minutes || 0,
        tier: leveling.getTierForLevel(u.level)?.name || null,
      });
    }

    // Sort by total XP descending so rank always matches displayed XP
    enriched.sort((a, b) => b.xp - a.xp);

    // Apply limit after sorting if requested
    const result = limit ? enriched.slice(0, parseInt(limit)) : enriched;

    res.json({ users: result });
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
    const leveling = require('../../systems/leveling');

    const totalUsers = db.get(
      'SELECT COUNT(*) as count FROM levels WHERE guild_id = ?', [guildId]
    )?.count || 0;

    // Calculate true total XP earned (level XP spent + current remainder)
    const allUsers = db.all(
      'SELECT level, xp FROM levels WHERE guild_id = ?', [guildId]
    );
    let totalXp = 0;
    for (const u of allUsers) {
      totalXp += leveling.totalXpForLevel(u.level) + (u.xp || 0);
    }

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
 * userId must be a valid Discord snowflake (numeric ID).
 * If a username is provided instead, attempts to resolve it to an ID.
 */
router.post('/:guildId/leveling/xp', async (req, res) => {
  try {
    const { guildId } = req.params;
    let { userId, amount } = req.body;

    if (!userId || !amount || amount <= 0 || amount > 30) {
      return res.status(400).json({ error: 'userId and amount (1-30) are required' });
    }

    // Validate userId is a Discord snowflake (numeric, 17-20 digits)
    const isSnowflake = /^\d{17,20}$/.test(userId);

    if (!isSnowflake) {
      // User likely entered a username — try to resolve it
      const guild = getGuild(req);
      if (!guild) return res.status(400).json({ error: 'Invalid userId. Please use a numeric Discord user ID, not a username.' });

      // Search guild members by username
      const members = await guild.members.fetch({ query: userId, limit: 1 });
      const match = members.first();

      if (!match) {
        return res.status(400).json({
          error: `User "${userId}" not found. Please use a numeric Discord user ID (right-click user → Copy User ID).`
        });
      }

      userId = match.id; // Replace username with resolved ID
    }

    const leveling = require('../../systems/leveling');
    const result = leveling.awardXp(userId, guildId, amount);

    res.json({ success: true, result, resolvedUserId: userId });
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
      'WEB_PORT', 'VOICE_XP_INTERVAL', 'VOICE_XP_AMOUNT', 'VOICE_XP_DAILY_CAP',
      'MSG_XP_MIN', 'MSG_XP_MAX', 'MSG_XP_DAILY_CAP', 'MSG_XP_COOLDOWN',
      'WEB_DEBUG_MODE'];

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
        isDefault: true,
      }));

      const existingCount = expectedChannels.filter(c => c.exists).length;
      const totalCount = expectedChannels.length;

      // Check if category exists and find custom channels in it
      const category = guild.channels.cache.find(
        c => c.type === 4 && c.name.toLowerCase() === catCfg.name.toLowerCase()
      );
      const catExists = !!category;

      // Find custom channels (in this category but not in the default list)
      if (category) {
        const defaultNames = new Set(catCfg.channels.map(ch => ch.name.toLowerCase()));
        const customChannels = guild.channels.cache.filter(
          c => c.parentId === category.id && !defaultNames.has(c.name.toLowerCase())
        );
        for (const ch of customChannels.values()) {
          expectedChannels.push({
            name: ch.name,
            type: ch.type === 2 ? 'voice' : 'text',
            exists: true,
            isDefault: false,
            id: ch.id,
          });
        }
      }

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
 * DELETE /api/guilds/:guildId/setup/channel-group
 * Body: { group: string, deleteCategory: boolean }
 * Deletes all channels in a feature group (and optionally the category).
 */
router.delete('/:guildId/setup/channel-group', async (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const { group, deleteCategory } = req.body;
    if (!group) return res.status(400).json({ error: 'group is required' });

    const { ChannelType: CT } = require('discord.js');
    const { buildLocalizedDefaultConfig } = require('../../systems/serverSetup');
    const config = buildLocalizedDefaultConfig();

    const GROUP_CAT_INDEX = {
      verification: 0, roles: 1, chat: 2, welcome: 3, voice: 4, logs: 5, staff: 6, streaming: 7, afk: 8,
    };

    const catIndex = GROUP_CAT_INDEX[group];
    if (catIndex === undefined) return res.status(400).json({ error: `Unknown group: ${group}` });

    const catCfg = config.categories[catIndex];
    if (!catCfg) return res.status(400).json({ error: 'Group config not found' });

    // Find the category
    const category = guild.channels.cache.find(
      c => c.type === CT.GuildCategory && c.name.toLowerCase() === catCfg.name.toLowerCase()
    );

    let deleted = 0;

    // Delete channels that match the group's default channel names
    const expectedNames = catCfg.channels.map(ch => ch.name.toLowerCase());
    for (const ch of guild.channels.cache.values()) {
      if (ch.type === CT.GuildCategory) continue;
      if (category && ch.parentId === category.id && expectedNames.includes(ch.name.toLowerCase())) {
        await ch.delete('Removed via Dashboard Quick Setup');
        deleted++;
      }
    }

    // Delete category if requested and empty
    if (deleteCategory && category) {
      const remaining = guild.channels.cache.filter(c => c.parentId === category.id);
      if (remaining.size === 0) {
        await category.delete('Removed via Dashboard Quick Setup');
      }
    }

    res.json({ success: true, deleted });
  } catch (err) {
    console.error('API channel-group delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/guilds/:guildId/setup/channel
 * Body: { channelId: string }
 * Delete a single channel by ID.
 */
router.delete('/:guildId/setup/channel', async (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const { channelId } = req.body;
    if (!channelId) return res.status(400).json({ error: 'channelId is required' });

    const channel = guild.channels.cache.get(channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const name = channel.name;
    await channel.delete('Removed via Dashboard');
    res.json({ success: true, name });
  } catch (err) {
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

/**
 * PUT /api/guilds/:guildId/setup/afk
 * Body: { timeoutSeconds: 60|300|900|1800|3600, channelId?: string }
 * Updates the guild's native AFK timeout and optionally the AFK channel.
 * Discord only allows these timeout values: 60, 300, 900, 1800, 3600
 */
router.put('/:guildId/setup/afk', async (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const { timeoutSeconds, channelId } = req.body;

    // Valid Discord AFK timeout values (in seconds)
    const VALID_TIMEOUTS = [60, 300, 900, 1800, 3600];

    if (timeoutSeconds !== undefined) {
      if (!VALID_TIMEOUTS.includes(timeoutSeconds)) {
        return res.status(400).json({
          error: `Invalid timeout. Valid values: ${VALID_TIMEOUTS.join(', ')} seconds (1, 5, 15, 30, 60 min)`,
        });
      }
      await guild.setAFKTimeout(timeoutSeconds, 'Updated via dashboard');
    }

    if (channelId) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel) return res.status(400).json({ error: 'Channel not found' });
      await guild.setAFKChannel(channel, 'Updated via dashboard');
    }

    // Return updated state
    const afkChannel = guild.afkChannelId
      ? guild.channels.cache.get(guild.afkChannelId)
      : null;

    res.json({
      success: true,
      hasAfkChannel: !!afkChannel,
      channelId: afkChannel?.id || null,
      channelName: afkChannel?.name || null,
      afkTimeout: guild.afkTimeout || 0,
      afkTimeoutMinutes: Math.floor((guild.afkTimeout || 0) / 60),
    });
  } catch (err) {
    console.error('API AFK update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// STREAM LINKS
// ══════════════════════════════════════════════════════════════════════════

/** List all stream links for a guild */
router.get('/:guildId/stream-links', (req, res) => {
  try {
    const links = db.all('SELECT * FROM streaming_links WHERE guild_id = ? ORDER BY platform', [req.params.guildId]);
    res.json({ links });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Add or update a stream link */
router.put('/:guildId/stream-links/:platform', (req, res) => {
  try {
    const { userId, handle, url } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });

    const ownerId = userId || process.env.STREAM_OWNER_ID || req.params.guildId;

    db.run(`
      INSERT INTO streaming_links (guild_id, user_id, platform, platform_handle, platform_url)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id, platform) DO UPDATE SET
        platform_handle = excluded.platform_handle,
        platform_url = excluded.platform_url,
        added_at = CURRENT_TIMESTAMP
    `, [req.params.guildId, ownerId, req.params.platform, handle || '', url]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Delete a stream link */
router.delete('/:guildId/stream-links/:platform', (req, res) => {
  try {
    db.run('DELETE FROM streaming_links WHERE guild_id = ? AND platform = ?', [req.params.guildId, req.params.platform]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// CHANNEL AI
// ══════════════════════════════════════════════════════════════════════════

const channelAi = require('../../systems/channelAi');

/** List all channel AI configs + intents + AI status overview */
router.get('/:guildId/channel-ai', (req, res) => {
  try {
    const guild = getGuild(req);
    const configs = channelAi.getAllConfigs(req.params.guildId);

    // Merge with live channel data
    const configMap = {};
    configs.forEach(c => { configMap[c.channel_id] = c; });

    const channels = [];
    if (guild) {
      guild.channels.cache
        .filter(c => c.type === 0)
        .sort((a, b) => a.position - b.position)
        .forEach(ch => {
          const cfg = configMap[ch.id] || {};
          channels.push({
            channelId: ch.id,
            channelName: ch.name,
            channelTopic: ch.topic || '',
            parentName: ch.parent?.name || '',
            enabled: !!cfg.enabled,
            intent: cfg.intent || 'help-support',
            customPrompt: cfg.custom_prompt || '',
            autoDetectIntent: cfg.auto_detect_intent != null ? !!cfg.auto_detect_intent : true,
            responseCooldown: cfg.response_cooldown || 30,
            allowTempChannels: !!cfg.allow_temp_channels,
            maxConcurrentGames: cfg.max_concurrent_games || 2,
          });
        });
    }

    // AI status overview
    const agentSettings = db.get('SELECT * FROM agent_settings WHERE guild_id = ?', [req.params.guildId]);
    const knowledgeCount = db.get('SELECT COUNT(*) as cnt FROM knowledge_base WHERE guild_id = ?', [req.params.guildId]);
    const enabledCount = configs.filter(c => c.enabled).length;

    res.json({
      channels,
      intents: channelAi.getIntents(),
      aiStatus: {
        chatEnabled: process.env.AI_CHAT_ENABLED === 'true',
        moderationEnabled: process.env.AI_MODERATION_ENABLED === 'true',
        agentEnabled: !!agentSettings?.enabled,
        agentChannel: agentSettings?.channel_id || null,
        knowledgeEntries: knowledgeCount?.cnt || 0,
        channelAiCount: enabledCount,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Upsert a channel's AI config */
router.put('/:guildId/channel-ai/:channelId', (req, res) => {
  try {
    const { enabled, intent, customPrompt, autoDetectIntent, responseCooldown, allowTempChannels, maxConcurrentGames } = req.body;

    // Validate intent
    if (intent && !channelAi.getIntentById(intent)) {
      return res.status(400).json({ error: `Unknown intent: ${intent}` });
    }
    if (customPrompt && customPrompt.length > 2000) {
      return res.status(400).json({ error: 'Custom prompt too long (max 2000 chars)' });
    }

    channelAi.upsertConfig(req.params.guildId, req.params.channelId, {
      enabled, intent, customPrompt, autoDetectIntent,
      responseCooldown: Math.max(10, Math.min(300, responseCooldown || 30)),
      allowTempChannels, maxConcurrentGames,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** AI-powered intent suggestion based on channel name/topic */
router.post('/:guildId/channel-ai/:channelId/suggest-intent', async (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const channel = guild.channels.cache.get(req.params.channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const { chat } = require('../../utils/openrouter');
    const intentsDesc = channelAi.getIntents().map(i => `${i.id}: ${i.name} — ${i.description}`).join('\n');

    const result = await chat(
      [{ role: 'user', content: `Channel name: #${channel.name}\nChannel topic: ${channel.topic || 'None'}\nCategory: ${channel.parent?.name || 'None'}` }],
      {
        systemPrompt: `You are an AI assistant that suggests the best intent for a Discord channel.\n\nAvailable intents:\n${intentsDesc}\n\nRespond with ONLY the intent ID (e.g., "help-support"). If unsure, respond with "help-support".`,
        maxTokens: 20,
        temperature: 0.1,
      }
    );

    const suggested = result.trim().toLowerCase().replace(/[^a-z-]/g, '');
    const validIntent = channelAi.getIntentById(suggested) ? suggested : 'help-support';

    res.json({ suggestedIntent: validIntent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// STARBOARD SETTINGS
// ══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/guilds/:guildId/starboard
 * Returns starboard settings for this guild
 */
router.get('/:guildId/starboard', (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const settings = db.get(
      'SELECT * FROM starboard_settings WHERE guild_id = ?',
      [req.params.guildId]
    );

    if (!settings) {
      return res.json({
        enabled: false,
        channelId: null,
        channelName: null,
        threshold: 3,
        emoji: '⭐',
        selfStar: false,
      });
    }

    const channel = settings.channel_id
      ? guild.channels.cache.get(settings.channel_id)
      : null;

    res.json({
      enabled: !!settings.enabled,
      channelId: settings.channel_id || null,
      channelName: channel ? channel.name : null,
      threshold: settings.threshold || 3,
      emoji: settings.emoji || '⭐',
      selfStar: !!settings.self_star,
    });
  } catch (err) {
    console.error('Starboard GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/guilds/:guildId/starboard
 * Update starboard settings
 * Body: { enabled, channelId, threshold, emoji, selfStar }
 */
router.put('/:guildId/starboard', (req, res) => {
  try {
    const guild = getGuild(req);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const { enabled, channelId, threshold, emoji, selfStar } = req.body;
    const guildId = req.params.guildId;

    // Validate threshold
    const safeThreshold = Math.min(25, Math.max(1, parseInt(threshold) || 3));

    // Validate emoji (allow any string up to 10 chars)
    const safeEmoji = (emoji || '⭐').slice(0, 10);

    // Validate channel exists if provided
    if (channelId) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel) return res.status(400).json({ error: 'Channel not found' });
    }

    // Upsert starboard_settings
    db.run(
      `INSERT INTO starboard_settings (guild_id, enabled, channel_id, threshold, emoji, self_star)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET
         enabled = ?, channel_id = ?, threshold = ?, emoji = ?, self_star = ?`,
      [
        guildId, enabled ? 1 : 0, channelId || null, safeThreshold, safeEmoji, selfStar ? 1 : 0,
        enabled ? 1 : 0, channelId || null, safeThreshold, safeEmoji, selfStar ? 1 : 0,
      ]
    );

    const channel = channelId ? guild.channels.cache.get(channelId) : null;

    res.json({
      success: true,
      enabled: !!enabled,
      channelId: channelId || null,
      channelName: channel ? channel.name : null,
      threshold: safeThreshold,
      emoji: safeEmoji,
      selfStar: !!selfStar,
    });
  } catch (err) {
    console.error('Starboard PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
