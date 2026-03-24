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
    return res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/config
 * Updates the config.json file
 * Body: the new config object
 */
router.put('/', (req, res) => {
  try {
    const newConfig = req.body;

    // Validate that it's an object
    if (typeof newConfig !== 'object' || newConfig === null) {
      return res.status(400).json({ error: 'Config must be a valid object' });
    }

    // Validate JSON by stringifying and parsing
    try {
      JSON.parse(JSON.stringify(newConfig));
    } catch (jsonError) {
      return res.status(400).json({ error: 'Invalid JSON: ' + jsonError.message });
    }

    // Get the config file path
    const configPath = projectPath('config', 'config.json');

    // Write to disk
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf8');

    return res.json({
      success: true,
      message: 'Config updated',
      config: newConfig,
    });
  } catch (error) {
    console.error('Error updating config:', error);
    return res.status(500).json({ error: error.message });
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
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
