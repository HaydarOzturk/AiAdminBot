const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { loadConfig, projectPath } = require('../../utils/paths');

/**
 * GET /api/config
 * Returns the current config.json contents
 */
router.get('/', (req, res) => {
  try {
    const config = loadConfig('config.json');
    return res.json(config);
  } catch (error) {
    console.error('Error loading config:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * PUT /api/config
 * Updates the config.json file
 * Body: the new config object
 */
// Allowed top-level config keys and their expected types
const ALLOWED_CONFIG_KEYS = {
  permissions: 'object',
  verification: 'object',
  leveling: 'object',
  moderation: 'object',
  streaming: 'object',
  roleMenus: 'object',
  serverSetup: 'object',
  afk: 'object',
  locale: 'string',
};

const MAX_CONFIG_SIZE = 50000; // 50KB max

router.put('/', (req, res) => {
  try {
    const newConfig = req.body;

    // Validate that it's a plain object
    if (typeof newConfig !== 'object' || newConfig === null || Array.isArray(newConfig)) {
      return res.status(400).json({ error: 'Config must be a valid object' });
    }

    // Size check to prevent abuse
    const serialized = JSON.stringify(newConfig, null, 2);
    if (serialized.length > MAX_CONFIG_SIZE) {
      return res.status(400).json({ error: `Config exceeds maximum size (${MAX_CONFIG_SIZE} bytes)` });
    }

    // Only allow known top-level keys
    for (const key of Object.keys(newConfig)) {
      if (!(key in ALLOWED_CONFIG_KEYS)) {
        return res.status(400).json({ error: `Unknown config key: "${key}"` });
      }
      const expectedType = ALLOWED_CONFIG_KEYS[key];
      const actualType = typeof newConfig[key];
      if (actualType !== expectedType) {
        return res.status(400).json({ error: `Config key "${key}" must be ${expectedType}, got ${actualType}` });
      }
    }

    // Strip any __proto__ or constructor keys (prototype pollution prevention)
    const safeConfig = JSON.parse(serialized);

    // Get the config file path
    const configPath = projectPath('config', 'config.json');

    // Write to disk
    fs.writeFileSync(configPath, JSON.stringify(safeConfig, null, 2), 'utf8');

    return res.json({
      success: true,
      message: 'Config updated',
      config: safeConfig,
    });
  } catch (error) {
    console.error('Error updating config:', error);
    return res.status(500).json({ error: 'Failed to update config' });
  }
});

/**
 * GET /api/config/env
 * Returns safe environment variables
 * (excludes tokens, passwords, and API keys)
 */
router.get('/env', (req, res) => {
  try {
    const safeEnv = {
      LOCALE: process.env.LOCALE || 'en',
      AI_PROVIDER: process.env.AI_PROVIDER || 'openai',
      WEB_PORT: process.env.WEB_PORT || '3000',
      NODE_ENV: process.env.NODE_ENV || 'development',
    };

    return res.json(safeEnv);
  } catch (error) {
    console.error('Error fetching env:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
