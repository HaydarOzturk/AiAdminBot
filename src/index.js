/**
 * AiAdminBot — Discord Server Administration Bot
 * Module 1: Core + Verification
 *
 * Entry point: loads environment, initializes client,
 * registers commands and events, then logs in.
 */

// Load environment variables first
require('dotenv').config();

// Enable file logging (writes to logs/ directory for debugging)
const { enableFileLogging, logFatal } = require('./utils/logger');
enableFileLogging();

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { loadCommands } = require('./handlers/commandHandler');
const { loadEvents } = require('./handlers/eventHandler');
const { loadLocale } = require('./utils/locale');

console.log(`🛡️  AiAdminBot v${require('../package.json').version} starting...`);

// Validate required env vars
const requiredEnv = ['DISCORD_TOKEN'];
for (const envVar of requiredEnv) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    console.error(`   Copy .env.example to .env and fill in your values.`);
    process.exit(1);
  }
}

// Initialize locale
loadLocale();

// Create client with required intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.GuildMember,
  ],
});

// Load commands and events
console.log('\n🔧 Loading commands...');
loadCommands(client);

console.log('🔧 Loading events...');
loadEvents(client);

// Initialize database, then login
const { initDatabase } = require('./utils/database');

(async () => {
  try {
    console.log('🔧 Initializing database...');
    await initDatabase();

    console.log('🔧 Logging in...');
    await client.login(process.env.DISCORD_TOKEN);

    // Start web dashboard (optional — only if WEB_PORT is set)
    const { startWebServer } = require('./web/server');
    startWebServer(client);
  } catch (error) {
    console.error('❌ Failed to start:', error.message);
    console.error('   Check your DISCORD_TOKEN in .env');
    process.exit(1);
  }
})();

// Handle unhandled errors gracefully — logged to file for debugging
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
  logFatal(error);
  console.error('Uncaught exception:', error);
  // Give the logger time to flush before exiting
  setTimeout(() => process.exit(1), 1000);
});
