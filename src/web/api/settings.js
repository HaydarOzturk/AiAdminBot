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
  voiceXp: {
    label: 'Voice XP',
    icon: '🔊',
    fields: [
      { key: 'VOICE_XP_INTERVAL', label: 'XP Award Interval (ms)', type: 'number', default: '3600000' },
      { key: 'VOICE_XP_AMOUNT', label: 'XP Per Interval', type: 'number', default: '3' },
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
      voiceXp: {
        amount: parseInt(p('VOICE_XP_AMOUNT') || '3'),
        intervalMinutes: Math.round(parseInt(p('VOICE_XP_INTERVAL') || '3600000') / 60000),
      },
      web: {
        port: p('WEB_PORT') || 'Not set',
        hasPassword: !!p('WEB_PASSWORD'),
      },
      locale: p('LOCALE') || 'en',
    };

    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
