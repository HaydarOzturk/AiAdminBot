const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(process.env.DATABASE_PATH || './data/bot.db');

let db = null;

/**
 * Initialize the database (must be called once at startup)
 */
async function initDatabase() {
  const SQL = await initSqlJs();

  // Load existing database file if it exists
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
    console.log('✅ Database loaded from disk.');
  } else {
    // Create new database
    db = new SQL.Database();
    console.log('✅ New database created.');
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS levels (
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      xp INTEGER DEFAULT 0,
      level INTEGER DEFAULT 0,
      messages INTEGER DEFAULT 0,
      last_xp_at DATETIME,
      PRIMARY KEY (user_id, guild_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS mod_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type TEXT NOT NULL,
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      reason TEXT,
      duration TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS verified_users (
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      verified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, guild_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS blocked_words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      word TEXT NOT NULL,
      added_by TEXT NOT NULL,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(guild_id, word)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      locale TEXT NOT NULL DEFAULT 'tr',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Save to disk after creating tables
  saveDatabase();

  console.log('✅ Database tables ready.');
  return db;
}

/**
 * Save the in-memory database to disk
 */
function saveDatabase() {
  if (!db) return;

  // Ensure the data directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

/**
 * Run a query that modifies data (INSERT, UPDATE, DELETE)
 * Automatically saves to disk after modification.
 * @param {string} sql - SQL query with ? placeholders
 * @param {Array} params - Parameter values
 */
function run(sql, params = []) {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  db.run(sql, params);
  saveDatabase();
}

/**
 * Get a single row from the database
 * @param {string} sql - SQL query with ? placeholders
 * @param {Array} params - Parameter values
 * @returns {object|null} Row as an object, or null if not found
 */
function get(sql, params = []) {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  const stmt = db.prepare(sql);
  stmt.bind(params);

  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }

  stmt.free();
  return null;
}

/**
 * Get all matching rows from the database
 * @param {string} sql - SQL query with ? placeholders
 * @param {Array} params - Parameter values
 * @returns {Array<object>} Array of row objects
 */
function all(sql, params = []) {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  const results = [];
  const stmt = db.prepare(sql);
  stmt.bind(params);

  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }

  stmt.free();
  return results;
}

module.exports = { initDatabase, saveDatabase, run, get, all };
