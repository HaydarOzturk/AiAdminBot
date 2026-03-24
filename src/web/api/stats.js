const express = require('express');
const router = express.Router();

/**
 * GET /api/stats
 * Returns general bot statistics
 */
router.get('/', (req, res) => {
  try {
    const client = req.app.locals.client;

    if (!client) {
      return res.status(500).json({ error: 'Discord client not available' });
    }

    // Gather guild info
    const guilds = client.guilds.cache.map((guild) => ({
      id: guild.id,
      name: guild.name,
      memberCount: guild.memberCount,
      icon: guild.iconURL({ dynamic: true, size: 512 }),
    }));

    // Calculate total members (may have overlap)
    const uniqueUserIds = new Set();
    client.guilds.cache.forEach((guild) => {
      guild.members.cache.forEach((member) => {
        uniqueUserIds.add(member.user.id);
      });
    });

    const stats = {
      guilds,
      botUptime: client.uptime,
      botVersion: require('../../../package.json').version || '1.0.0',
      totalMembers: uniqueUserIds.size,
      totalGuilds: client.guilds.cache.size,
    };

    return res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/stats/:guildId
 * Returns detailed statistics for a specific guild
 */
router.get('/:guildId', (req, res) => {
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

    // Count channels by type
    const channelCounts = {
      text: 0,
      voice: 0,
      forum: 0,
      category: 0,
      other: 0,
    };

    guild.channels.cache.forEach((channel) => {
      if (channel.isTextBased() && !channel.isVoiceBased()) {
        channelCounts.text++;
      } else if (channel.isVoiceBased()) {
        channelCounts.voice++;
      } else if (channel.type === 15) {
        channelCounts.forum++;
      } else if (channel.type === 4) {
        channelCounts.category++;
      } else {
        channelCounts.other++;
      }
    });

    // Count boosters
    const boosters = guild.members.cache.filter((member) => member.premiumSince).size;

    const stats = {
      guildId,
      guildName: guild.name,
      owner: {
        id: guild.ownerId,
        tag: guild.owner?.user?.tag || 'Unknown',
      },
      memberCount: guild.memberCount,
      roleCount: guild.roles.cache.size,
      channelCounts,
      boostCount: boosters,
      boostTier: guild.premiumTier,
      createdAt: guild.createdAt.toISOString(),
      icon: guild.iconURL({ dynamic: true, size: 512 }),
    };

    return res.json(stats);
  } catch (error) {
    console.error('Error fetching guild stats:', error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
