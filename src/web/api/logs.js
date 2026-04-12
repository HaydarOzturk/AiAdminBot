const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { projectPath } = require('../../utils/paths');

/**
 * GET /api/logs
 * Returns recent lines from the bot log file
 * Query params: lines (default 100)
 */
router.get('/', (req, res) => {
  try {
    const { lines = 100 } = req.query;
    const numLines = parseInt(lines);

    if (isNaN(numLines) || numLines < 1 || numLines > 1000) {
      return res.status(400).json({ error: 'lines must be between 1 and 1000' });
    }

    const logsDir = projectPath('logs');

    // Check if logs directory exists
    if (!fs.existsSync(logsDir)) {
      return res.json({ logs: [], message: 'No logs directory found' });
    }

    // Get the most recent log file
    const files = fs.readdirSync(logsDir);
    if (files.length === 0) {
      return res.json({ logs: [], message: 'No log files found' });
    }

    // Find the most recent file (usually sorted by name if using timestamps)
    const logFiles = files.filter((f) => f.endsWith('.log')).sort().reverse();
    if (logFiles.length === 0) {
      return res.json({ logs: [], message: 'No log files found' });
    }

    const logFile = path.join(logsDir, logFiles[0]);
    const content = fs.readFileSync(logFile, 'utf8');
    const allLines = content.split('\n').filter((line) => line.trim() !== '');

    // Get the last N lines
    const recentLines = allLines.slice(-numLines);

    return res.json({
      logs: recentLines,
      logFile: logFiles[0],
      totalLines: allLines.length,
    });
  } catch (error) {
    console.error('Error reading logs:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /api/logs/:guildId
 * Returns log channel messages from a specific guild
 */
router.get('/:guildId', async (req, res) => {
  try {
    const { guildId } = req.params;
    const { limit = 50 } = req.query;

    const client = req.app.locals.client;
    if (!client) {
      return res.status(500).json({ error: 'Discord client not available' });
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: 'Guild not found' });
    }

    // Find log channel (typically named "logs" or "bot-logs")
    const logChannel = guild.channels.cache.find(
      (ch) =>
        (ch.name.includes('log') || ch.name.includes('audit')) &&
        (ch.isTextBased() || !ch.isVoiceBased())
    );

    if (!logChannel) {
      return res.json({
        logs: [],
        message: 'No log channel found in this guild',
      });
    }

    // Fetch recent messages
    const messages = await logChannel.messages.fetch({ limit: parseInt(limit) });
    const logs = messages
      .reverse()
      .map((msg) => ({
        id: msg.id,
        author: msg.author.username,
        content: msg.content,
        timestamp: msg.createdTimestamp,
        createdAt: msg.createdAt.toISOString(),
      }));

    return res.json({
      logs,
      channel: {
        id: logChannel.id,
        name: logChannel.name,
      },
    });
  } catch (error) {
    console.error('Error fetching guild logs:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
