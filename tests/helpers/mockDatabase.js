/**
 * Test database helper — in-memory sql.js with no disk I/O
 *
 * Usage:
 *   before(async () => { await setupTestDatabase(); });
 *   beforeEach(() => { cleanupTestDatabase(); });
 */

const path = require('path');

// Point to a non-existent path so initDatabase creates a fresh DB
process.env.DATABASE_PATH = path.join(__dirname, '..', '..', 'data', 'test-nonexistent.db');

const db = require('../../src/utils/database');

// Patch saveDatabase to no-op (prevent disk writes during tests)
const originalSave = db.saveDatabase;
db.saveDatabase = () => {};

let initialized = false;

async function setupTestDatabase() {
  if (!initialized) {
    await db.initDatabase();
    // Re-patch after initDatabase (it may have been called internally)
    db.saveDatabase = () => {};
    initialized = true;
  } else {
    cleanupTestDatabase();
  }
}

function cleanupTestDatabase() {
  const tables = [
    'levels', 'daily_xp', 'warnings', 'mod_actions',
    'verified_users', 'blocked_words', 'guild_settings',
    'automod_settings', 'automod_infractions',
    'starboard_settings', 'starboard_entries',
    'polls', 'poll_votes',
    'giveaways', 'giveaway_entries',
    'custom_commands', 'streaming_links',
    'ai_memories', 'agent_settings', 'agent_conversations',
    'knowledge_base', 'message_log', 'channel_summaries',
    'role_menus', 'role_menu_items', 'role_menu_messages',
    'bot_messages', 'channel_ai_config', 'channel_mappings',
  ];
  for (const table of tables) {
    try { db.run(`DELETE FROM ${table}`, []); } catch {}
  }
}

function restoreSaveDatabase() {
  db.saveDatabase = originalSave;
}

module.exports = {
  setupTestDatabase,
  cleanupTestDatabase,
  restoreSaveDatabase,
};
