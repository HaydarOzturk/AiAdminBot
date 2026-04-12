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
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /api/stats/system
 * Returns server resource usage (CPU, RAM, disk, database size, etc.)
 * Only returns data if WEB_DEBUG_MODE=true
 */
router.get('/system', async (req, res) => {
  try {
    const debugMode = (process.env.WEB_DEBUG_MODE || 'false') === 'true';
    if (!debugMode) {
      return res.json({ enabled: false });
    }

    const os = require('os');
    const fs = require('fs');
    const path = require('path');
    const { execSync } = require('child_process');
    const { projectPath } = require('../../utils/paths');

    // Memory usage
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const processMem = process.memoryUsage();

    // CPU info
    const cpus = os.cpus();
    const cpuModel = cpus[0]?.model || 'Unknown';
    const cpuCores = cpus.length;

    const loadAvg = os.loadavg();

    // Disk usage — try df for Linux, fallback gracefully
    let diskTotal = 0, diskUsed = 0, diskFree = 0;
    try {
      const dfOutput = execSync('df -B1 / 2>/dev/null || echo "0 0 0"', { encoding: 'utf-8', timeout: 3000 });
      const lines = dfOutput.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        diskTotal = parseInt(parts[1]) || 0;
        diskUsed = parseInt(parts[2]) || 0;
        diskFree = parseInt(parts[3]) || 0;
      }
    } catch { /* Windows or other OS — skip */ }

    // Database file size
    const dbPath = projectPath(process.env.DATABASE_PATH || './data/bot.db');
    let dbSize = 0;
    try { dbSize = fs.statSync(dbPath).size; } catch { /* no db file */ }

    // Log files total size
    const logsDir = projectPath('./logs');
    let logsSize = 0;
    try {
      if (fs.existsSync(logsDir)) {
        for (const f of fs.readdirSync(logsDir)) {
          try { logsSize += fs.statSync(path.join(logsDir, f)).size; } catch {}
        }
      }
    } catch {}

    // Data folder size
    const dataDir = projectPath('./data');
    let dataSize = 0;
    try {
      if (fs.existsSync(dataDir)) {
        for (const f of fs.readdirSync(dataDir)) {
          try { dataSize += fs.statSync(path.join(dataDir, f)).size; } catch {}
        }
      }
    } catch {}

    const uptimeSeconds = os.uptime();

    res.json({
      enabled: true,
      system: {
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptimeSeconds,
        uptimeFormatted: formatSystemUptime(uptimeSeconds),
      },
      cpu: {
        model: cpuModel,
        cores: cpuCores,
        loadAvg: { '1min': loadAvg[0].toFixed(2), '5min': loadAvg[1].toFixed(2), '15min': loadAvg[2].toFixed(2) },
      },
      memory: {
        total: totalMem, used: usedMem, free: freeMem,
        usagePercent: ((usedMem / totalMem) * 100).toFixed(1),
        process: { rss: processMem.rss, heapTotal: processMem.heapTotal, heapUsed: processMem.heapUsed, external: processMem.external },
      },
      disk: {
        total: diskTotal, used: diskUsed, free: diskFree,
        usagePercent: diskTotal > 0 ? ((diskUsed / diskTotal) * 100).toFixed(1) : '0',
      },
      storage: { database: dbSize, logs: logsSize, data: dataSize, total: dbSize + logsSize + dataSize },
      node: { version: process.version, pid: process.pid, uptimeSeconds: Math.floor(process.uptime()) },
    });
  } catch (err) {
    console.error('System stats error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

function formatSystemUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

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
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
