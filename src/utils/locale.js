const fs = require('fs');
const path = require('path');
const { localePath, localesDir } = require('./paths');

// Global fallback strings (loaded from LOCALE env)
let strings = {};

// All loaded locales: { tr: {...}, en: {...}, de: {...}, ... }
const allLocales = {};

// Per-guild locale cache: guildId -> locale code
const guildLocaleCache = new Map();

/**
 * Load ALL locale files at startup.
 * The global `strings` variable is set to the LOCALE env default.
 */
function loadLocale() {
  const defaultLocale = process.env.LOCALE || 'tr';

  // Load all available locale files
  const locDir = localesDir();
  try {
    const files = fs.readdirSync(locDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const code = file.replace('.json', '');
        allLocales[code] = JSON.parse(fs.readFileSync(path.join(locDir, file), 'utf-8'));
      } catch (err) {
        console.warn(`⚠️ Failed to load locale ${file}: ${err.message}`);
      }
    }
  } catch {
    console.warn('⚠️ Locales directory not found');
  }

  // Set global default
  strings = allLocales[defaultLocale] || allLocales['tr'] || {};
  console.log(`✅ Locales loaded: ${Object.keys(allLocales).join(', ')} (default: ${defaultLocale})`);
}

/**
 * Resolve the strings object for a given guild.
 * Priority: guild DB setting > LOCALE env > 'tr'
 * @param {string|null} guildId
 * @returns {object} The locale strings object
 */
function resolveStrings(guildId) {
  if (!guildId) return strings;

  const guildLocale = getGuildLocale(guildId);
  if (guildLocale && allLocales[guildLocale]) {
    return allLocales[guildLocale];
  }

  return strings;
}

/**
 * Get a translated string by dot-notation key
 * @param {string} key - e.g. "verification.successTitle"
 * @param {object} [replacements={}] - e.g. { user: "Ahmet", count: 247 }
 * @param {string|null} [guildId=null] - Guild ID for per-guild locale lookup
 * @returns {string}
 */
function t(key, replacements = {}, guildId = null) {
  const locStrings = resolveStrings(guildId);
  const keys = key.split('.');
  let value = locStrings;

  for (const k of keys) {
    value = value?.[k];
  }

  if (typeof value !== 'string') {
    // Fallback to global strings if guild-specific strings are missing
    if (guildId) {
      let fallback = strings;
      for (const k of keys) {
        fallback = fallback?.[k];
      }
      if (typeof fallback === 'string') {
        value = fallback;
      }
    }

    if (typeof value !== 'string') {
      console.warn(`Missing locale key: ${key}`);
      return key;
    }
  }

  // Replace {placeholders} with values
  return value.replace(/\{(\w+)\}/g, (match, name) => {
    return replacements[name] !== undefined ? replacements[name] : match;
  });
}

/**
 * Get a localized channel name by internal identifier
 * @param {string} id - e.g. "general-chat", "rules", "cat-verification"
 * @param {string|null} [guildId=null] - Guild ID for per-guild locale lookup
 * @returns {string} Localized channel name, or the id itself as fallback
 */
function channelName(id, guildId = null) {
  const locStrings = resolveStrings(guildId);
  return locStrings.channelNames?.[id] || strings.channelNames?.[id] || id;
}

/**
 * Get the current locale code for a guild (or global default)
 * @param {string|null} [guildId=null]
 * @returns {string} e.g. "tr", "en", "de"
 */
function getLocale(guildId = null) {
  if (guildId) {
    const gl = getGuildLocale(guildId);
    if (gl) return gl;
  }
  return process.env.LOCALE || 'tr';
}

// ── Per-guild locale storage ──────────────────────────────────────────────

/**
 * Get the stored locale for a guild from DB (with in-memory cache)
 * @param {string} guildId
 * @returns {string|null} Locale code or null if not set
 */
function getGuildLocale(guildId) {
  if (guildLocaleCache.has(guildId)) {
    return guildLocaleCache.get(guildId);
  }

  // Try database lookup
  try {
    const db = require('./database');
    const row = db.get(
      'SELECT locale FROM guild_settings WHERE guild_id = ?',
      [guildId]
    );
    if (row && row.locale) {
      guildLocaleCache.set(guildId, row.locale);
      return row.locale;
    }
  } catch {
    // DB not ready yet or table doesn't exist — fall back to global
  }

  return null;
}

/**
 * Set the locale for a guild (persists to DB + updates cache)
 * @param {string} guildId
 * @param {string} locale - e.g. "tr", "en", "de"
 */
function setGuildLocale(guildId, locale) {
  guildLocaleCache.set(guildId, locale);

  try {
    const db = require('./database');
    db.run(
      `INSERT INTO guild_settings (guild_id, locale, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(guild_id) DO UPDATE SET locale = ?, updated_at = datetime('now')`,
      [guildId, locale, locale]
    );
    console.log(`🌐 Guild ${guildId} locale set to: ${locale}`);
  } catch (err) {
    console.warn(`⚠️ Failed to save guild locale: ${err.message}`);
  }
}

/**
 * Get a locale strings object for a specific locale code (used during setup)
 * @param {string} locale - e.g. "tr", "en"
 * @returns {object} The locale strings
 */
function getLocaleStrings(locale) {
  return allLocales[locale] || allLocales['tr'] || strings;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Get ALL possible AI chat channel names across every locale file.
 * This ensures the bot recognizes the AI chat channel regardless of
 * which language was used during server setup.
 * Results are cached after first call.
 * @returns {Set<string>} Set of all possible AI chat channel names
 */
let _aiChatNamesCache = null;
function getAllAiChatNames() {
  if (_aiChatNamesCache) return _aiChatNamesCache;

  const names = new Set();

  // Always include the env-configured name and common defaults
  names.add(process.env.AI_CHAT_CHANNEL || 'ai-sohbet');
  names.add('ai-sohbet');
  names.add('ai-chat');

  // Scan all loaded locales
  for (const [, data] of Object.entries(allLocales)) {
    if (data.channelNames?.['ai-chat']) {
      names.add(data.channelNames['ai-chat']);
    }
  }

  _aiChatNamesCache = names;
  return names;
}

module.exports = {
  loadLocale,
  t,
  channelName,
  getLocale,
  getAllAiChatNames,
  setGuildLocale,
  getGuildLocale,
  getLocaleStrings,
};
