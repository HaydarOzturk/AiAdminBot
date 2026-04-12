const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(process.env.DATABASE_PATH || './data/bot.db');

let db = null;

/**
 * Initialize the database (must be called once at startup)
 */
async function initDatabase() {
  // When running as pkg exe, point sql.js to the extracted WASM file
  const sqlOpts = {};
  if (process.pkg) {
    const wasmPath = path.join(path.dirname(process.execPath), 'sql-wasm.wasm');
    if (fs.existsSync(wasmPath)) {
      sqlOpts.locateFile = () => wasmPath;
    }
  }
  const SQL = await initSqlJs(sqlOpts);

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
      voice_minutes INTEGER DEFAULT 0,
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

  db.run(`
    CREATE TABLE IF NOT EXISTS daily_xp (
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      date TEXT NOT NULL,
      message_xp REAL DEFAULT 0,
      voice_xp INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, guild_id, date)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS streaming_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      platform_handle TEXT NOT NULL,
      platform_url TEXT NOT NULL,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(guild_id, user_id, platform)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ai_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      taught_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(guild_id, key)
    )
  `);

  // ── New feature tables ────────────────────────────────────────────────────

  // Auto-moderation settings
  db.run(`
    CREATE TABLE IF NOT EXISTS automod_settings (
      guild_id TEXT PRIMARY KEY,
      anti_spam INTEGER DEFAULT 0,
      anti_raid INTEGER DEFAULT 0,
      anti_mention_spam INTEGER DEFAULT 0,
      anti_caps INTEGER DEFAULT 0,
      anti_invites INTEGER DEFAULT 0,
      progressive_punishments INTEGER DEFAULT 1,
      spam_threshold INTEGER DEFAULT 5,
      spam_window INTEGER DEFAULT 5,
      max_mentions INTEGER DEFAULT 5,
      max_caps_percent INTEGER DEFAULT 70,
      raid_threshold INTEGER DEFAULT 10,
      raid_window INTEGER DEFAULT 30
    )
  `);

  // Auto-moderation infraction log
  db.run(`
    CREATE TABLE IF NOT EXISTS automod_infractions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      infraction_type TEXT NOT NULL,
      reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Starboard settings
  db.run(`
    CREATE TABLE IF NOT EXISTS starboard_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      channel_id TEXT,
      threshold INTEGER DEFAULT 3,
      emoji TEXT DEFAULT '⭐',
      self_star INTEGER DEFAULT 0
    )
  `);

  // Starboard entries
  db.run(`
    CREATE TABLE IF NOT EXISTS starboard_entries (
      guild_id TEXT NOT NULL,
      original_message_id TEXT NOT NULL,
      starboard_message_id TEXT,
      channel_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      star_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, original_message_id)
    )
  `);

  // Polls
  db.run(`
    CREATE TABLE IF NOT EXISTS polls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      question TEXT NOT NULL,
      options TEXT NOT NULL,
      ends_at DATETIME,
      closed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Poll votes
  db.run(`
    CREATE TABLE IF NOT EXISTS poll_votes (
      poll_message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      option_index INTEGER NOT NULL,
      PRIMARY KEY (poll_message_id, user_id)
    )
  `);

  // Giveaways
  db.run(`
    CREATE TABLE IF NOT EXISTS giveaways (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      prize TEXT NOT NULL,
      winner_count INTEGER DEFAULT 1,
      ends_at DATETIME,
      ended INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Giveaway entries
  db.run(`
    CREATE TABLE IF NOT EXISTS giveaway_entries (
      giveaway_message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      entered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (giveaway_message_id, user_id)
    )
  `);

  // Custom commands
  db.run(`
    CREATE TABLE IF NOT EXISTS custom_commands (
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      response TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      embed_mode INTEGER DEFAULT 0,
      ai_mode INTEGER DEFAULT 0,
      uses INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, name)
    )
  `);

  // ── AI Agent & Knowledge System tables ────────────────────────────────

  // Agent configuration per guild
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      channel_id TEXT,
      require_confirmation INTEGER DEFAULT 1,
      min_permission_level INTEGER DEFAULT 3
    )
  `);

  // Multi-turn conversation state
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_conversations (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      messages TEXT NOT NULL DEFAULT '[]',
      pending_action TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Extended knowledge base
  db.run(`
    CREATE TABLE IF NOT EXISTS knowledge_base (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      category TEXT NOT NULL,
      question TEXT,
      content TEXT NOT NULL,
      tags TEXT,
      taught_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Message archive for summaries and search (7-day retention)
  db.run(`
    CREATE TABLE IF NOT EXISTS message_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Periodic channel digests
  db.run(`
    CREATE TABLE IF NOT EXISTS channel_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      message_count INTEGER NOT NULL,
      period_start DATETIME NOT NULL,
      period_end DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Role Menu System tables ────────────────────────────────────────────

  // Role menu definitions per guild
  db.run(`
    CREATE TABLE IF NOT EXISTS role_menus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      color TEXT DEFAULT '#5865f2',
      single_select INTEGER DEFAULT 0,
      required_role_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(guild_id, slug)
    )
  `);

  // Roles within a menu
  db.run(`
    CREATE TABLE IF NOT EXISTS role_menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_id INTEGER NOT NULL,
      role_name TEXT NOT NULL,
      role_id TEXT,
      emoji TEXT,
      color TEXT DEFAULT '#99aab5',
      position INTEGER DEFAULT 0,
      UNIQUE(menu_id, role_name)
    )
  `);

  // Tracks where menus are published (for update/cleanup)
  db.run(`
    CREATE TABLE IF NOT EXISTS role_menu_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      published_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(guild_id, message_id)
    )
  `);

  // ── Bot Messages System table ──────────────────────────────────────────

  db.run(`
    CREATE TABLE IF NOT EXISTS bot_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT,
      message_id TEXT,
      message_type TEXT NOT NULL DEFAULT 'custom',
      name TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '{}',
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_system INTEGER DEFAULT 0
    )
  `);

  // ── Per-Channel AI Configuration ────────────────────────────────────────

  db.run(`
    CREATE TABLE IF NOT EXISTS channel_ai_config (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      enabled INTEGER DEFAULT 0,
      intent TEXT DEFAULT 'help-support',
      custom_prompt TEXT,
      auto_detect_intent INTEGER DEFAULT 1,
      response_cooldown INTEGER DEFAULT 30,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, channel_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS channel_mappings (
      guild_id TEXT NOT NULL,
      feature_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      channel_name TEXT,
      PRIMARY KEY (guild_id, feature_id)
    )
  `);

  // ── Message Scoring for Auto Memory Learning ──────────────────────────

  db.run(`
    CREATE TABLE IF NOT EXISTS message_scores (
      message_log_id INTEGER PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      reaction_count INTEGER DEFAULT 0,
      reply_count INTEGER DEFAULT 0,
      bot_mentioned INTEGER DEFAULT 0,
      computed_score REAL DEFAULT 0,
      scored_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Memory Learning Configuration per Guild ───────────────────────────

  db.run(`
    CREATE TABLE IF NOT EXISTS memory_config (
      guild_id TEXT PRIMARY KEY,
      reaction_weight REAL DEFAULT 1.0,
      reply_weight REAL DEFAULT 2.0,
      bot_mention_weight REAL DEFAULT 10.0,
      candidacy_threshold REAL DEFAULT 5.0,
      confidence_threshold REAL DEFAULT 0.75,
      min_user_level INTEGER DEFAULT 1,
      decay_rate REAL DEFAULT 0.993,
      prune_threshold REAL DEFAULT 0.2,
      max_auto_memories INTEGER DEFAULT 50,
      extraction_enabled INTEGER DEFAULT 0,
      extraction_interval INTEGER DEFAULT 6,
      channel_weights TEXT DEFAULT '{}',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS active_announcements (
      guild_id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Web Dashboard Sessions (OAuth2 + persistent auth) ─────────────────

  db.run(`
    CREATE TABLE IF NOT EXISTS web_sessions (
      token TEXT PRIMARY KEY,
      discord_user_id TEXT,
      discord_username TEXT,
      guild_ids TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
      ip_address TEXT
    )
  `);

  // Migration: add last_activity column to web_sessions if missing
  try {
    db.run('ALTER TABLE web_sessions ADD COLUMN last_activity DATETIME DEFAULT CURRENT_TIMESTAMP');
  } catch { /* column already exists */ }

  // Migration: clean up levels table
  // Fixes two bugs:
  // 1. Old fallback code created duplicate entries for same user+guild
  // 2. Admins entering usernames instead of IDs in Award XP created ghost entries
  try {
    let cleaned = 0;

    // Phase 1: Remove entries where user_id is NOT a valid Discord snowflake
    // (these are usernames accidentally stored as user_id)
    const invalidEntries = db.exec(`
      SELECT rowid, user_id, guild_id, xp FROM levels
      WHERE user_id NOT GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]*'
    `);
    if (invalidEntries[0] && invalidEntries[0].values.length > 0) {
      for (const [rowid, userId, guildId, xp] of invalidEntries[0].values) {
        db.run('DELETE FROM levels WHERE rowid = ?', [rowid]);
        cleaned++;
        console.log(`  🗑️ Removed invalid entry: user_id="${userId}" (not a Discord ID, XP=${xp})`);
      }
    }

    // Phase 2: Merge true duplicates (same valid user_id + guild_id appearing multiple times)
    const dupes = db.exec(`
      SELECT user_id, guild_id, COUNT(*) as cnt
      FROM levels
      GROUP BY user_id, guild_id
      HAVING cnt > 1
    `);
    if (dupes[0] && dupes[0].values.length > 0) {
      for (const [userId, guildId] of dupes[0].values) {
        const stmt = db.prepare('SELECT rowid, * FROM levels WHERE user_id = ? AND guild_id = ?');
        stmt.bind([userId, guildId]);
        const entries = [];
        while (stmt.step()) entries.push(stmt.getAsObject());
        stmt.free();

        if (entries.length < 2) continue;

        // Keep the entry with the most activity (messages + voice_minutes)
        entries.sort((a, b) => ((b.messages || 0) + (b.voice_minutes || 0)) - ((a.messages || 0) + (a.voice_minutes || 0)));
        const keep = entries[0];
        const ghosts = entries.slice(1);

        let extraXp = 0;
        for (const ghost of ghosts) {
          extraXp += ghost.xp || 0;
          db.run('DELETE FROM levels WHERE rowid = ?', [ghost.rowid]);
          cleaned++;
        }

        if (extraXp > 0) {
          db.run('UPDATE levels SET xp = xp + ? WHERE rowid = ?', [extraXp, keep.rowid]);
        }
      }
    }

    if (cleaned > 0) {
      console.log(`🔄 Migration: cleaned ${cleaned} invalid/duplicate entries from levels table`);
    }
  } catch (err) {
    // Safe to ignore on first run when table might not exist yet
  }

  // Migration: add voice_minutes column to levels if missing
  try {
    const cols = db.exec('PRAGMA table_info(levels)');
    const hasVoiceMinutes = cols[0]?.values?.some(row => row[1] === 'voice_minutes');
    if (!hasVoiceMinutes) {
      db.run('ALTER TABLE levels ADD COLUMN voice_minutes INTEGER DEFAULT 0');
      console.log('🔄 Migration: added voice_minutes column to levels table');
    }
  } catch {
    // Table might not exist yet or column already exists — safe to ignore
  }

  // Migration: add game config columns to channel_ai_config if missing
  try {
    const cols = db.exec('PRAGMA table_info(channel_ai_config)');
    const hasTemp = cols[0]?.values?.some(row => row[1] === 'allow_temp_channels');
    if (!hasTemp) {
      db.run('ALTER TABLE channel_ai_config ADD COLUMN allow_temp_channels INTEGER DEFAULT 0');
      db.run('ALTER TABLE channel_ai_config ADD COLUMN max_concurrent_games INTEGER DEFAULT 2');
      console.log('🔄 Migration: added game config columns to channel_ai_config');
    }
  } catch {}

  // Migration: add discord_message_id to message_log for reaction/reply tracking
  try {
    const cols = db.exec('PRAGMA table_info(message_log)');
    const hasMsgId = cols[0]?.values?.some(row => row[1] === 'discord_message_id');
    if (!hasMsgId) {
      db.run('ALTER TABLE message_log ADD COLUMN discord_message_id TEXT');
      console.log('🔄 Migration: added discord_message_id to message_log');
    }
  } catch {}

  // Migration: add auto-learning columns to ai_memories
  try {
    const cols = db.exec('PRAGMA table_info(ai_memories)');
    const hasSource = cols[0]?.values?.some(row => row[1] === 'source');
    if (!hasSource) {
      db.run("ALTER TABLE ai_memories ADD COLUMN source TEXT DEFAULT 'manual'");
      db.run('ALTER TABLE ai_memories ADD COLUMN confidence REAL DEFAULT 1.0');
      db.run('ALTER TABLE ai_memories ADD COLUMN decay_score REAL DEFAULT 1.0');
      db.run('ALTER TABLE ai_memories ADD COLUMN last_reinforced DATETIME DEFAULT CURRENT_TIMESTAMP');
      db.run('ALTER TABLE ai_memories ADD COLUMN source_channel TEXT');
      db.run('ALTER TABLE ai_memories ADD COLUMN source_messages TEXT');
      console.log('🔄 Migration: added auto-learning columns to ai_memories');
    }
  } catch {}

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
