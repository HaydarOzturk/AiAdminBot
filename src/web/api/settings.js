/**
 * Bot-wide settings API
 * Routes: /api/settings/...
 *
 * Provides read/write access to .env configuration and feature status.
 * Sensitive values (tokens, passwords) are masked on read, but can be written.
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { projectPath } = require('../../utils/paths');

// Keys that should be masked when reading (show ••••••)
const SENSITIVE_KEYS = ['DISCORD_TOKEN', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'WEB_PASSWORD', 'TWITCH_CLIENT_SECRET', 'KICK_CLIENT_SECRET'];

// All known .env keys grouped by feature
const ENV_SCHEMA = {
  general: {
    label: 'General',
    icon: '🤖',
    fields: [
      { key: 'LOCALE', label: 'Default Language', type: 'select', options: ['en','tr','de','es','fr','pt','ru','ar'], default: 'en' },
      { key: 'LOG_LEVEL', label: 'Log Level', type: 'select', options: ['debug','info','warn','error'], default: 'info' },
      { key: 'DATABASE_PATH', label: 'Database Path', type: 'text', default: './data/bot.db' },
    ],
  },
  ai: {
    label: 'AI Features',
    icon: '🧠',
    fields: [
      { key: 'GEMINI_API_KEY', label: 'Gemini API Key', type: 'password', placeholder: 'Your Gemini API key' },
      { key: 'OPENROUTER_API_KEY', label: 'OpenRouter API Key', type: 'password', placeholder: 'Your OpenRouter API key' },
      { key: 'AI_MODEL', label: 'AI Model Override', type: 'text', placeholder: 'e.g. gemini-3.1-flash-lite-preview' },
      { key: 'AI_CHAT_ENABLED', label: 'AI Chat Enabled', type: 'toggle', default: 'false' },
      { key: 'AI_CHAT_CHANNEL', label: 'AI Chat Channel Name', type: 'text', default: 'ai-chat' },
      { key: 'AI_CHAT_RATE_LIMIT', label: 'AI Chat Rate Limit (seconds)', type: 'number', default: '5' },
      { key: 'AI_MODERATION_ENABLED', label: 'AI Smart Moderation', type: 'toggle', default: 'false' },
      { key: 'AI_MOD_CONFIDENCE_THRESHOLD', label: 'Moderation Confidence Threshold', type: 'number', step: '0.1', min: '0', max: '1', default: '0.8' },
      { key: 'AI_TIMEOUT_MINUTES', label: 'AI Auto-Timeout Duration (min)', type: 'number', default: '3' },
    ],
  },
  streaming: {
    label: 'Streaming',
    icon: '📺',
    fields: [
      { key: 'STREAMING_ENABLED', label: 'Enable Streaming Detection', type: 'toggle', default: 'true' },
      { key: 'STREAM_OWNER_ID', label: 'Stream Owner (Discord User ID)', type: 'text', placeholder: 'The streamer who uses /go-live' },
      { key: 'YOUTUBE_API_KEY', label: 'YouTube API Key', type: 'password', placeholder: 'From Google Cloud Console' },
      { key: 'TWITCH_CLIENT_ID', label: 'Twitch Client ID', type: 'text', placeholder: 'From dev.twitch.tv' },
      { key: 'TWITCH_CLIENT_SECRET', label: 'Twitch Client Secret', type: 'password', placeholder: 'From dev.twitch.tv' },
      { key: 'KICK_CLIENT_ID', label: 'Kick Client ID', type: 'text', placeholder: 'From kick.com Developer settings' },
      { key: 'KICK_CLIENT_SECRET', label: 'Kick Client Secret', type: 'password', placeholder: 'From kick.com Developer settings' },
    ],
  },
  linkFilter: {
    label: 'Link Filter',
    icon: '🔗',
    fields: [
      { key: 'LINK_FILTER_ENABLED', label: 'Enable Link Filter', type: 'toggle', default: 'false' },
      { key: 'LINK_FILTER_WARN_USER', label: 'Send Warning to User', type: 'toggle', default: 'true' },
    ],
  },
  afk: {
    label: 'AFK Channel',
    icon: '💤',
    fields: [
      { key: 'AFK_CUSTOM_ENABLED', label: 'Custom AFK Tracking (on top of Discord)', type: 'toggle', default: 'false' },
      { key: 'AFK_TIMEOUT_MINUTES', label: 'Custom AFK Timeout (minutes)', type: 'number', default: '30', min: '1', max: '120' },
    ],
  },
  levelling: {
    label: 'Levelling',
    icon: '📈',
    fields: [
      { key: 'MSG_XP_MIN', label: 'Message XP — Minimum', type: 'number', step: '0.1', default: '0.1', description: 'Min XP awarded per message' },
      { key: 'MSG_XP_MAX', label: 'Message XP — Maximum', type: 'number', step: '0.1', default: '0.3', description: 'Max XP awarded per message' },
      { key: 'MSG_XP_DAILY_CAP', label: 'Message XP — Daily Cap', type: 'number', default: '20', description: 'Max message XP per user per day' },
      { key: 'MSG_XP_COOLDOWN', label: 'Message XP — Cooldown (seconds)', type: 'number', default: '60', description: 'Seconds between XP gains from messages' },
      { key: 'VOICE_XP_AMOUNT', label: 'Voice XP — Per Interval', type: 'number', default: '3', description: 'XP awarded per voice interval' },
      { key: 'VOICE_XP_INTERVAL', label: 'Voice XP — Interval (minutes)', type: 'number', default: '60', description: 'Minutes between voice XP awards' },
      { key: 'VOICE_XP_DAILY_CAP', label: 'Voice XP — Daily Cap', type: 'number', default: '50', description: 'Max voice XP per user per day' },
      { key: 'LEVEL_UP_CHANNEL', label: 'Level-Up Announcement Channel', type: 'text', default: 'level-up', description: 'Channel name for level-up messages' },
    ],
  },
  web: {
    label: 'Web Dashboard',
    icon: '🌐',
    fields: [
      { key: 'WEB_PORT', label: 'Dashboard Port', type: 'number', default: '3000' },
      { key: 'WEB_PASSWORD', label: 'Dashboard Password', type: 'password', placeholder: '••••••' },
    ],
  },
  debug: {
    label: 'Debug',
    icon: '🔧',
    fields: [
      { key: 'DEBUG_OWNER_ID', label: 'Debug Owner ID (bypass staff exempt)', type: 'text', placeholder: 'Discord User ID' },
      { key: 'WEB_DEBUG_MODE', label: 'Dashboard Debug Mode', type: 'toggle', default: 'false', description: 'Show server resource stats (CPU, RAM, disk) on the home page' },
    ],
  },
};

/**
 * Parse .env file into key-value object
 */
function parseEnvFile() {
  const envPath = projectPath('.env');
  if (!fs.existsSync(envPath)) return {};

  const content = fs.readFileSync(envPath, 'utf-8');
  const result = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.substring(0, eqIdx).trim();
    let value = trimmed.substring(eqIdx + 1).trim();

    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/**
 * Write key-value object back to .env file, preserving comments and structure
 */
function writeEnvFile(updates) {
  const envPath = projectPath('.env');
  let content = '';

  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf-8');
  }

  const lines = content.split('\n');
  const updatedKeys = new Set();

  // Update existing lines
  const newLines = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) return line;

    const key = trimmed.substring(0, eqIdx).trim();

    if (key in updates) {
      updatedKeys.add(key);
      const val = updates[key];
      if (val === '' || val === null || val === undefined) {
        // Comment out the line
        return `#${key}=${trimmed.substring(eqIdx + 1)}`;
      }
      return `${key}=${val}`;
    }

    return line;
  });

  // Append new keys that didn't exist before
  for (const [key, val] of Object.entries(updates)) {
    if (!updatedKeys.has(key) && val !== '' && val !== null && val !== undefined) {
      newLines.push(`${key}=${val}`);
    }
  }

  fs.writeFileSync(envPath, newLines.join('\n'), 'utf-8');

  // Also update process.env in memory (takes effect without restart for some features)
  for (const [key, val] of Object.entries(updates)) {
    if (val === '' || val === null || val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
}

/**
 * GET /api/settings
 * Returns the schema + current values (sensitive values masked)
 */
router.get('/', (req, res) => {
  try {
    const envValues = parseEnvFile();

    // Build response with current values, masking sensitive ones
    const sections = {};

    for (const [sectionKey, section] of Object.entries(ENV_SCHEMA)) {
      sections[sectionKey] = {
        label: section.label,
        icon: section.icon,
        fields: section.fields.map(field => {
          const currentValue = envValues[field.key] || process.env[field.key] || '';
          const isSensitive = SENSITIVE_KEYS.includes(field.key);
          const hasValue = !!currentValue;

          return {
            ...field,
            value: isSensitive ? '' : currentValue,
            hasValue: hasValue,           // true if a value is set (even if masked)
            masked: isSensitive && hasValue,
          };
        }),
      };
    }

    res.json({ sections });
  } catch (err) {
    console.error('Settings GET error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * PUT /api/settings
 * Body: { updates: { KEY: 'value', ... } }
 * Only updates the keys provided. Skips masked/unchanged sensitive values.
 */
router.put('/', (req, res) => {
  try {
    const { updates } = req.body;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'updates object is required' });
    }

    // Validate: only allow known keys
    const allKnownKeys = new Set();
    for (const section of Object.values(ENV_SCHEMA)) {
      for (const field of section.fields) {
        allKnownKeys.add(field.key);
      }
    }

    const filteredUpdates = {};
    for (const [key, val] of Object.entries(updates)) {
      if (!allKnownKeys.has(key)) continue;
      // Don't overwrite sensitive values with empty string (means "unchanged")
      if (SENSITIVE_KEYS.includes(key) && val === '') continue;
      filteredUpdates[key] = val;
    }

    if (Object.keys(filteredUpdates).length === 0) {
      return res.json({ success: true, message: 'No changes to apply' });
    }

    writeEnvFile(filteredUpdates);

    res.json({
      success: true,
      message: 'Settings saved. Some changes may require a bot restart.',
      updatedKeys: Object.keys(filteredUpdates),
    });
  } catch (err) {
    console.error('Settings PUT error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /api/settings/status
 * Returns the live feature status (what's enabled, what's connected)
 */
router.get('/status', (req, res) => {
  try {
    const envValues = parseEnvFile();
    const p = (k) => envValues[k] || process.env[k] || '';

    const status = {
      aiChat: {
        enabled: p('AI_CHAT_ENABLED') === 'true',
        configured: !!(p('GEMINI_API_KEY') || p('OPENROUTER_API_KEY')),
        provider: p('GEMINI_API_KEY') ? 'Gemini' : p('OPENROUTER_API_KEY') ? 'OpenRouter' : 'None',
        model: p('AI_MODEL') || 'Default',
      },
      aiModeration: {
        enabled: p('AI_MODERATION_ENABLED') === 'true',
        threshold: parseFloat(p('AI_MOD_CONFIDENCE_THRESHOLD') || '0.8'),
      },
      streaming: {
        enabled: p('STREAMING_ENABLED') !== 'false',
        youtubeConfigured: !!p('YOUTUBE_API_KEY'),
      },
      linkFilter: {
        enabled: p('LINK_FILTER_ENABLED') === 'true',
        warnUser: p('LINK_FILTER_WARN_USER') !== 'false',
      },
      afk: {
        customEnabled: p('AFK_CUSTOM_ENABLED') === 'true',
        timeout: parseInt(p('AFK_TIMEOUT_MINUTES') || '30'),
      },
      levelling: {
        msgXpMin: parseFloat(p('MSG_XP_MIN') || '0.1'),
        msgXpMax: parseFloat(p('MSG_XP_MAX') || '0.3'),
        msgDailyCap: parseInt(p('MSG_XP_DAILY_CAP') || '20'),
        msgCooldown: parseInt(p('MSG_XP_COOLDOWN') || '60'),
        voiceAmount: parseInt(p('VOICE_XP_AMOUNT') || '3'),
        voiceInterval: parseInt(p('VOICE_XP_INTERVAL') || '60'),
        voiceDailyCap: parseInt(p('VOICE_XP_DAILY_CAP') || '50'),
      },
      web: {
        port: p('WEB_PORT') || 'Not set',
        hasPassword: !!p('WEB_PASSWORD'),
      },
      locale: p('LOCALE') || 'en',
    };

    res.json(status);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /api/settings/channels
 * Returns feature-required channels with their status (found/missing in guild)
 */
router.get('/channels', (req, res) => {
  try {
    const client = req.app.locals.client;
    const envValues = parseEnvFile();
    const p = (k) => envValues[k] || process.env[k] || '';

    // Define all feature-required channels
    const channelDefs = [
      { id: 'punishment-log', feature: 'Moderation Log', description: 'Where mod actions are logged', configKey: null, type: 'locale' },
      { id: 'welcome', feature: 'Welcome Messages', description: 'New member greeting channel', configKey: 'WELCOME_CHANNEL', type: 'config' },
      { id: 'join-leave-log', feature: 'Join/Leave Log', description: 'Member join and leave tracking', configKey: null, type: 'locale' },
      { id: 'stream-announcements', feature: 'Stream Alerts', description: 'Live stream notifications', configKey: null, type: 'locale' },
      { id: 'level-up', feature: 'Level Up Messages', description: 'XP level-up announcements', configKey: 'LEVEL_UP_CHANNEL', type: 'config' },
      { id: 'ai-chat', feature: 'AI Chat', description: 'AI conversation channel', configKey: 'AI_CHAT_CHANNEL', type: 'env', default: 'ai-chat' },
      { id: 'starboard', feature: 'Starboard', description: 'Starred messages showcase', configKey: null, type: 'db' },
      { id: 'admin-agent', feature: 'AI Agent', description: 'Natural language admin commands', configKey: null, type: 'db' },
      { id: 'verify', feature: 'Verification', description: 'Member verification channel', configKey: null, type: 'locale' },
    ];

    const { channelName: localeName } = require('../../utils/locale');
    const db = require('../../utils/database');

    // Check each channel's existence in all guilds
    const channels = channelDefs.map(def => {
      let currentName = def.id;

      // Determine current configured name
      if (def.type === 'env' && def.configKey) {
        currentName = p(def.configKey) || def.default || def.id;
      }

      // Check if channel exists in any guild — try DB mapping, localized name, raw name
      let found = false;
      let foundIn = null;
      let foundChannelId = null;
      let assignedViaDb = false;
      if (client) {
        for (const [guildId, guild] of client.guilds.cache) {
          // 1. Check DB mapping first (manual assignment)
          const mapping = db.get(
            'SELECT channel_id, channel_name FROM channel_mappings WHERE guild_id = ? AND feature_id = ?',
            [guildId, def.id]
          );
          if (mapping) {
            const ch = guild.channels.cache.get(mapping.channel_id);
            if (ch) {
              found = true;
              foundIn = `#${ch.name}`;
              foundChannelId = ch.id;
              assignedViaDb = true;
              break;
            }
          }

          // 2. Try localized name and raw name
          const locName = localeName(def.id, guildId);
          const ch = guild.channels.cache.find(c =>
            c.isTextBased() && (c.name === currentName || c.name === locName || c.name === def.id)
          );
          if (ch) {
            found = true;
            foundIn = `#${ch.name}`;
            foundChannelId = ch.id;
            break;
          }
        }
      }

      return {
        id: def.id,
        feature: def.feature,
        description: def.description,
        currentName,
        configKey: def.configKey,
        type: def.type,
        found,
        foundIn,
        foundChannelId,
        assigned: assignedViaDb,
      };
    });

    // Also return all guild text channels for the assign dropdown
    let allChannels = [];
    if (client) {
      for (const [, guild] of client.guilds.cache) {
        allChannels = guild.channels.cache
          .filter(c => c.isTextBased() && c.type !== 4)
          .map(c => ({ id: c.id, name: c.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
        break; // first guild
      }
    }

    res.json({ channels, allChannels });
  } catch (err) {
    console.error('Channels settings error:', err.message);
    res.status(500).json({ error: 'Failed to load channel settings' });
  }
});

/**
 * PUT /api/settings/channels
 * Update channel names. Body: { channelId: newName, ... }
 */
router.put('/channels', (req, res) => {
  try {
    const { updates } = req.body;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'updates object is required' });
    }

    // Map channel IDs to their env keys
    const envMappings = {
      'ai-chat': 'AI_CHAT_CHANNEL',
      'level-up': 'LEVEL_UP_CHANNEL',
      'welcome': 'WELCOME_CHANNEL',
    };

    const envUpdates = {};
    for (const [channelId, newName] of Object.entries(updates)) {
      const envKey = envMappings[channelId];
      if (envKey && newName && typeof newName === 'string') {
        // Sanitize channel name (Discord format)
        const sanitized = newName.toLowerCase().replace(/[^a-z0-9-_]/g, '-').slice(0, 100);
        envUpdates[envKey] = sanitized;
      }
    }

    if (Object.keys(envUpdates).length > 0) {
      writeEnvFile(envUpdates);
    }

    res.json({ success: true, message: 'Channel settings updated', updatedKeys: Object.keys(envUpdates) });
  } catch (err) {
    console.error('Channel settings update error:', err.message);
    res.status(500).json({ error: 'Failed to update channel settings' });
  }
});

/**
 * PUT /api/settings/channels/assign
 * Assign an existing Discord channel to a bot feature
 * Body: { featureId: string, channelId: string, guildId: string }
 */
router.put('/channels/assign', (req, res) => {
  try {
    const { featureId, channelId, guildId } = req.body;
    if (!featureId || !channelId || !guildId) {
      return res.status(400).json({ error: 'featureId, channelId, and guildId are required' });
    }

    const client = req.app.locals.client;
    const guild = client?.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const channel = guild.channels.cache.get(channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const db = require('../../utils/database');
    db.run(
      `INSERT INTO channel_mappings (guild_id, feature_id, channel_id, channel_name)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(guild_id, feature_id) DO UPDATE SET channel_id = ?, channel_name = ?`,
      [guildId, featureId, channelId, channel.name, channelId, channel.name]
    );

    res.json({ success: true, channelName: channel.name });
  } catch (err) {
    console.error('Channel assign error:', err.message);
    res.status(500).json({ error: 'Failed to assign channel' });
  }
});

/**
 * DELETE /api/settings/channels/assign
 * Unassign a channel from a bot feature
 * Body: { featureId: string, guildId: string }
 */
router.delete('/channels/assign', (req, res) => {
  try {
    const { featureId, guildId } = req.body;
    if (!featureId || !guildId) {
      return res.status(400).json({ error: 'featureId and guildId are required' });
    }

    const db = require('../../utils/database');
    db.run('DELETE FROM channel_mappings WHERE guild_id = ? AND feature_id = ?', [guildId, featureId]);

    res.json({ success: true });
  } catch (err) {
    console.error('Channel unassign error:', err.message);
    res.status(500).json({ error: 'Failed to unassign channel' });
  }
});

// ── Culture Library (Memory Learning) ─────────────────────────────────────

const db = require('../../utils/database');

// GET /api/settings/:guildId/memory-config
router.get('/:guildId/memory-config', (req, res) => {
  try {
    const { guildId } = req.params;
    const row = db.get('SELECT * FROM memory_config WHERE guild_id = ?', [guildId]);

    const config = row || {
      guild_id: guildId,
      reaction_weight: 1.0,
      reply_weight: 2.0,
      bot_mention_weight: 10.0,
      candidacy_threshold: 5.0,
      confidence_threshold: 0.75,
      min_user_level: 1,
      decay_rate: 0.993,
      prune_threshold: 0.2,
      max_auto_memories: 50,
      extraction_enabled: 0,
      extraction_interval: 6,
      channel_weights: '{}',
    };

    res.json(config);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/settings/:guildId/memory-config
router.post('/:guildId/memory-config', (req, res) => {
  try {
    const { guildId } = req.params;
    const c = req.body;

    db.run(
      `INSERT INTO memory_config (guild_id, reaction_weight, reply_weight, bot_mention_weight, candidacy_threshold, confidence_threshold, min_user_level, decay_rate, prune_threshold, max_auto_memories, extraction_enabled, extraction_interval, channel_weights, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(guild_id) DO UPDATE SET
         reaction_weight = excluded.reaction_weight,
         reply_weight = excluded.reply_weight,
         bot_mention_weight = excluded.bot_mention_weight,
         candidacy_threshold = excluded.candidacy_threshold,
         confidence_threshold = excluded.confidence_threshold,
         min_user_level = excluded.min_user_level,
         decay_rate = excluded.decay_rate,
         prune_threshold = excluded.prune_threshold,
         max_auto_memories = excluded.max_auto_memories,
         extraction_enabled = excluded.extraction_enabled,
         extraction_interval = excluded.extraction_interval,
         channel_weights = excluded.channel_weights,
         updated_at = CURRENT_TIMESTAMP`,
      [
        guildId,
        c.reaction_weight ?? 1.0,
        c.reply_weight ?? 2.0,
        c.bot_mention_weight ?? 10.0,
        c.candidacy_threshold ?? 5.0,
        c.confidence_threshold ?? 0.75,
        c.min_user_level ?? 1,
        c.decay_rate ?? 0.993,
        c.prune_threshold ?? 0.2,
        c.max_auto_memories ?? 50,
        c.extraction_enabled ? 1 : 0,
        c.extraction_interval ?? 6,
        typeof c.channel_weights === 'string' ? c.channel_weights : JSON.stringify(c.channel_weights || {}),
      ]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/settings/:guildId/auto-memories
router.get('/:guildId/auto-memories', (req, res) => {
  try {
    const { guildId } = req.params;
    const memories = db.all(
      "SELECT id, value, confidence, decay_score, source_channel, source_messages, created_at, last_reinforced FROM ai_memories WHERE guild_id = ? AND source = 'auto' ORDER BY created_at DESC",
      [guildId]
    );
    res.json(memories);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// DELETE /api/settings/:guildId/auto-memories/:id
router.delete('/:guildId/auto-memories/:id', (req, res) => {
  try {
    const { guildId, id } = req.params;
    db.run("DELETE FROM ai_memories WHERE id = ? AND guild_id = ? AND source = 'auto'", [id, guildId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/settings/:guildId/auto-memories/:id/promote — promote auto to manual
router.post('/:guildId/auto-memories/:id/promote', (req, res) => {
  try {
    const { guildId, id } = req.params;
    db.run(
      "UPDATE ai_memories SET source = 'manual', decay_score = 1.0, confidence = 1.0 WHERE id = ? AND guild_id = ? AND source = 'auto'",
      [id, guildId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/settings/:guildId/memory-scores — recent scored messages
router.get('/:guildId/memory-scores', (req, res) => {
  try {
    const { guildId } = req.params;
    const scores = db.all(
      `SELECT ms.*, ml.content, ml.user_name, ml.channel_id, ml.created_at as message_date
       FROM message_scores ms
       JOIN message_log ml ON ml.id = ms.message_log_id
       WHERE ms.guild_id = ?
       ORDER BY ms.computed_score DESC
       LIMIT 50`,
      [guildId]
    );
    res.json(scores);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
