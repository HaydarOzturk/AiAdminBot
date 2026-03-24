const express = require('express');
const router = express.Router();

/**
 * GET /api/roles/:guildId
 * List all roles in a guild with member counts
 */
router.get('/:guildId', async (req, res) => {
  try {
    const { guildId } = req.params;
    const client = req.app.locals.client;

    if (!client) {
      return res.status(500).json({ error: 'Discord client not available' });
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: 'Guild not found' });
    }

    const roles = guild.roles.cache
      .filter((role) => role.id !== guild.id) // Exclude @everyone
      .map((role) => ({
        id: role.id,
        name: role.name,
        color: role.hexColor,
        position: role.position,
        mentionable: role.mentionable,
        managed: role.managed,
        permissions: role.permissions.bitfield.toString(),
        memberCount: role.members.size,
      }))
      .sort((a, b) => b.position - a.position);

    return res.json({ roles });
  } catch (error) {
    console.error('Error fetching roles:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/roles/:guildId/give
 * Give a role to a user
 * Body: { userId, roleId }
 */
router.post('/:guildId/give', async (req, res) => {
  try {
    const { guildId } = req.params;
    const { userId, roleId } = req.body;

    if (!userId || !roleId) {
      return res.status(400).json({ error: 'userId and roleId are required' });
    }

    const client = req.app.locals.client;
    if (!client) {
      return res.status(500).json({ error: 'Discord client not available' });
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: 'Guild not found' });
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const role = guild.roles.cache.get(roleId);
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    // Check if member already has the role
    if (member.roles.cache.has(roleId)) {
      return res.status(400).json({ error: 'Member already has this role' });
    }

    // Add the role
    await member.roles.add(role, 'Role added via admin dashboard');

    return res.json({
      success: true,
      message: `Role ${role.name} added to ${member.user.username}`,
    });
  } catch (error) {
    console.error('Error giving role:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/roles/:guildId/remove
 * Remove a role from a user
 * Body: { userId, roleId }
 */
router.post('/:guildId/remove', async (req, res) => {
  try {
    const { guildId } = req.params;
    const { userId, roleId } = req.body;

    if (!userId || !roleId) {
      return res.status(400).json({ error: 'userId and roleId are required' });
    }

    const client = req.app.locals.client;
    if (!client) {
      return res.status(500).json({ error: 'Discord client not available' });
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: 'Guild not found' });
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const role = guild.roles.cache.get(roleId);
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    // Check if member has the role
    if (!member.roles.cache.has(roleId)) {
      return res.status(400).json({ error: 'Member does not have this role' });
    }

    // Remove the role
    await member.roles.remove(role, 'Role removed via admin dashboard');

    return res.json({
      success: true,
      message: `Role ${role.name} removed from ${member.user.username}`,
    });
  } catch (error) {
    console.error('Error removing role:', error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
