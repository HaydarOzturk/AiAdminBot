#!/usr/bin/env node

/**
 * AiAdminBot .exe Entry Point
 *
 * This is the entry point for the standalone executable build.
 * It checks if the bot is configured (.env exists) and:
 *   - If NOT configured: runs the setup wizard
 *   - If configured: starts the bot normally
 *
 * Also handles first-run command deployment automatically.
 */

const fs = require('fs');
const path = require('path');

// Determine the directory where the .exe lives (or project root for dev)
const basePath = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const envPath = path.join(basePath, '.env');

// Set working directory to base path so dotenv and relative paths work
process.chdir(basePath);

// Check if setup is needed
if (!fs.existsSync(envPath)) {
  console.log('');
  console.log('  No .env file found — starting setup wizard...');
  console.log('');

  // Run setup wizard (it will create .env)
  require('./setup-wizard');
} else {
  // .env exists — start the bot
  require('./index');
}
