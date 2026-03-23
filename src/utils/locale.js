const fs = require('fs');
const path = require('path');
const { localePath, localesDir } = require('./paths');

let strings = {};

/**
 * Load locale file based on the LOCALE env variable
 */
function loadLocale() {
  const locale = process.env.LOCALE || 'tr';
  const locFile = localePath(`${locale}.json`);

  if (!fs.existsSync(locFile)) {
    console.warn(`Locale file not found: ${locFile}. Falling back to Turkish.`);
    const fallback = localePath('tr.json');
    strings = JSON.parse(fs.readFileSync(fallback, 'utf-8'));
    return;
  }

  strings = JSON.parse(fs.readFileSync(locFile, 'utf-8'));
  console.log(`✅ Locale loaded: ${locale}`);
}

/**
 * Get a translated string by dot-notation key
 * @param {string} key - e.g. "verification.successTitle"
 * @param {object} replacements - e.g. { user: "Ahmet", count: 247 }
 * @returns {string}
 */
function t(key, replacements = {}) {
  const keys = key.split('.');
  let value = strings;

  for (const k of keys) {
    value = value?.[k];
  }

  if (typeof value !== 'string') {
    console.warn(`Missing locale key: ${key}`);
    return key;
  }

  // Replace {placeholders} with values
  return value.replace(/\{(\w+)\}/g, (match, name) => {
    return replacements[name] !== undefined ? replacements[name] : match;
  });
}

/**
 * Get a localized channel name by internal identifier
 * @param {string} id - e.g. "general-chat", "rules", "cat-verification"
 * @returns {string} Localized channel name, or the id itself as fallback
 */
function channelName(id) {
  return strings.channelNames?.[id] || id;
}

/**
 * Get the current locale code
 * @returns {string} e.g. "tr", "en", "de"
 */
function getLocale() {
  return process.env.LOCALE || 'tr';
}

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

  // Scan all locale files for their ai-chat channel name
  const locDir = localesDir();
  try {
    const files = fs.readdirSync(locDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(locDir, file), 'utf-8'));
        if (data.channelNames?.['ai-chat']) {
          names.add(data.channelNames['ai-chat']);
        }
      } catch {
        // Skip invalid locale files
      }
    }
  } catch {
    // Locales dir not found, use defaults only
  }

  _aiChatNamesCache = names;
  return names;
}

module.exports = { loadLocale, t, channelName, getLocale, getAllAiChatNames };
