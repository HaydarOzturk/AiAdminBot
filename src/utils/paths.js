const path = require('path');

/**
 * Get the REAL filesystem root (next to the .exe, or the project root).
 *
 * When running as a pkg .exe, __dirname points inside the packaged virtual
 * filesystem. This returns the directory containing the .exe so that
 * runtime-created files (.env, config/, data/) are found correctly.
 */
function getBasePath() {
  if (process.pkg) {
    return path.dirname(process.execPath);
  }
  return path.join(__dirname, '..', '..');
}

/**
 * Get the BUNDLED filesystem root (inside the .exe's virtual FS).
 * Falls back to the same as getBasePath() when running from source.
 *
 * Use this for read-only bundled assets (locales, .example configs).
 */
function getBundledPath() {
  return path.join(__dirname, '..', '..');
}

/**
 * Resolve a path relative to the real project root.
 * For files that may be created at runtime (config.json, data/, logs/).
 */
function projectPath(...segments) {
  return path.join(getBasePath(), ...segments);
}

/**
 * Resolve a path relative to the bundled root.
 * For read-only assets baked into the .exe (locales/, .example configs).
 */
function bundledPath(...segments) {
  return path.join(getBundledPath(), ...segments);
}

/**
 * Get path to a config file with a 3-tier fallback:
 *   1. Real filesystem config (next to .exe)  →  config/server-setup.json
 *   2. Real filesystem .example                →  config/server-setup.example.json
 *   3. Bundled .example (inside .exe)          →  (packaged at compile time)
 *
 * @param {string} filename - e.g. 'config.json', 'server-setup.json'
 * @returns {string} Path to the best available config file
 */
function configPath(filename) {
  const fs = require('fs');

  // 1. Check for real config file next to .exe (or in project root)
  const real = projectPath('config', filename);
  if (fs.existsSync(real)) return real;

  // 2. Check for .example on real filesystem
  const name = path.basename(filename, '.json');
  const realExample = projectPath('config', `${name}.example.json`);
  if (fs.existsSync(realExample)) return realExample;

  // 3. Fall back to bundled .example inside the .exe virtual FS
  const bundledExample = bundledPath('config', `${name}.example.json`);
  return bundledExample;
}

/**
 * Load and parse a config JSON file with automatic fallback.
 * @param {string} filename - e.g. 'config.json', 'server-setup.json'
 * @returns {object} Parsed JSON
 */
function loadConfig(filename) {
  const fs = require('fs');
  return JSON.parse(fs.readFileSync(configPath(filename), 'utf-8'));
}

/**
 * Get path to a locale file with fallback to bundled version.
 * @param {string} filename - e.g. 'en.json', 'tr.json'
 * @returns {string} Path to the locale file
 */
function localePath(filename) {
  const fs = require('fs');

  // 1. Check real filesystem (next to .exe)
  const real = projectPath('locales', filename);
  if (fs.existsSync(real)) return real;

  // 2. Fall back to bundled locales inside the .exe
  return bundledPath('locales', filename);
}

/**
 * Get the locales directory path, preferring real FS, falling back to bundled.
 * @returns {string} Path to the locales directory
 */
function localesDir() {
  const fs = require('fs');

  const real = projectPath('locales');
  if (fs.existsSync(real)) return real;

  return bundledPath('locales');
}

module.exports = { getBasePath, projectPath, bundledPath, configPath, loadConfig, localePath, localesDir };
