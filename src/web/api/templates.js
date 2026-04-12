const express = require('express');
const router = express.Router();

/**
 * GET /api/templates/:guildId/export
 * Export server structure as JSON template
 */
router.get('/:guildId/export', async (req, res) => {
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

    // Try to use templateManager if available
    let template;
    try {
      const templateManager = require('../../systems/templateManager');
      if (templateManager && templateManager.exportTemplate) {
        template = templateManager.exportTemplate(guild);
      } else {
        template = buildBasicTemplate(guild);
      }
    } catch (e) {
      // Fallback to basic template if templateManager not available
      template = buildBasicTemplate(guild);
    }

    return res.json(template);
  } catch (error) {
    console.error('Error exporting template:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * POST /api/templates/:guildId/import
 * Import server structure from template JSON
 */
router.post('/:guildId/import', async (req, res) => {
  try {
    const { guildId } = req.params;
    const template = req.body;

    if (!template || typeof template !== 'object') {
      return res.status(400).json({ error: 'Invalid template format' });
    }

    const client = req.app.locals.client;
    if (!client) {
      return res.status(500).json({ error: 'Discord client not available' });
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: 'Guild not found' });
    }

    // Try to use templateManager if available
    let result;
    try {
      const templateManager = require('../../systems/templateManager');
      if (templateManager && templateManager.importTemplate) {
        result = await templateManager.importTemplate(guild, template);
      } else {
        result = await applyBasicTemplate(guild, template);
      }
    } catch (e) {
      console.warn('Error using templateManager:', e.message);
      // Fallback to basic template import
      result = await applyBasicTemplate(guild, template);
    }

    return res.json({
      success: true,
      message: 'Template imported',
      result,
    });
  } catch (error) {
    console.error('Error importing template:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * Build a basic template from a guild
 */
function buildBasicTemplate(guild) {
  return {
    name: guild.name,
    description: guild.description || '',
    icon: guild.iconURL({ dynamic: true, size: 512 }),
    channels: guild.channels.cache
      .filter((ch) => !ch.parent || !ch.parent.isManageable())
      .map((ch) => ({
        id: ch.id,
        name: ch.name,
        type: ch.type,
        topic: ch.topic || '',
        nsfw: ch.nsfw,
        position: ch.position,
      })),
    roles: guild.roles.cache
      .filter((role) => role.id !== guild.id) // Exclude @everyone
      .map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color,
        permissions: role.permissions.bitfield.toString(),
        position: role.position,
        mentionable: role.mentionable,
      })),
  };
}

/**
 * Apply a basic template to a guild
 */
async function applyBasicTemplate(guild, template) {
  const results = {
    channelsCreated: 0,
    rolesCreated: 0,
    errors: [],
  };

  // Create roles if specified
  if (template.roles && Array.isArray(template.roles)) {
    for (const roleData of template.roles) {
      try {
        // Don't try to recreate existing roles
        const existing = guild.roles.cache.find((r) => r.name === roleData.name);
        if (!existing) {
          await guild.roles.create({
            name: roleData.name,
            color: roleData.color,
            permissions: roleData.permissions,
            mentionable: roleData.mentionable,
          });
          results.rolesCreated++;
        }
      } catch (err) {
        results.errors.push(`Failed to create role ${roleData.name}: ${err.message}`);
      }
    }
  }

  // Create channels if specified
  if (template.channels && Array.isArray(template.channels)) {
    for (const channelData of template.channels) {
      try {
        // Don't try to recreate existing channels
        const existing = guild.channels.cache.find((ch) => ch.name === channelData.name);
        if (!existing) {
          await guild.channels.create({
            name: channelData.name,
            type: channelData.type,
            topic: channelData.topic,
            nsfw: channelData.nsfw,
            position: channelData.position,
          });
          results.channelsCreated++;
        }
      } catch (err) {
        results.errors.push(`Failed to create channel ${channelData.name}: ${err.message}`);
      }
    }
  }

  return results;
}

module.exports = router;
