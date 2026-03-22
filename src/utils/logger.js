/**
 * File-based logger for AiAdminBot
 * Writes logs to both console and a rotating log file.
 * Essential for debugging .exe builds where there's no persistent terminal.
 *
 * Log files are stored in the /logs directory next to the executable (or project root).
 * Files rotate daily: adminbot-2026-03-22.log
 */

const fs = require('fs');
const path = require('path');

// Determine base path (works for both source and pkg exe)
function getBasePath() {
  if (process.pkg) {
    return path.dirname(process.execPath);
  }
  return path.join(__dirname, '..', '..');
}

const LOG_DIR = path.join(getBasePath(), 'logs');
const MAX_LOG_FILES = 14; // Keep 14 days of logs

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Get today's log file path
 */
function getLogFilePath() {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(LOG_DIR, `adminbot-${date}.log`);
}

/**
 * Format a log entry with timestamp and level
 */
function formatEntry(level, args) {
  const timestamp = new Date().toISOString();
  const message = args
    .map(a => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)))
    .join(' ');
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
}

/**
 * Append a line to the current log file
 */
function writeToFile(entry) {
  try {
    fs.appendFileSync(getLogFilePath(), entry + '\n');
  } catch {
    // If we can't write to log file, just continue (don't crash the bot)
  }
}

/**
 * Clean up old log files beyond MAX_LOG_FILES
 */
function cleanOldLogs() {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => f.startsWith('adminbot-') && f.endsWith('.log'))
      .sort()
      .reverse();

    for (let i = MAX_LOG_FILES; i < files.length; i++) {
      fs.unlinkSync(path.join(LOG_DIR, files[i]));
    }
  } catch {
    // Ignore cleanup errors
  }
}

// Clean old logs on startup
cleanOldLogs();

// Store original console methods
const _origLog = console.log;
const _origError = console.error;
const _origWarn = console.warn;
const _origInfo = console.info;
const _origDebug = console.debug;

/**
 * Override console methods to also write to file.
 * Call this once at startup to enable file logging.
 */
function enableFileLogging() {
  console.log = (...args) => {
    _origLog(...args);
    writeToFile(formatEntry('info', args));
  };

  console.error = (...args) => {
    _origError(...args);
    writeToFile(formatEntry('error', args));
  };

  console.warn = (...args) => {
    _origWarn(...args);
    writeToFile(formatEntry('warn', args));
  };

  console.info = (...args) => {
    _origInfo(...args);
    writeToFile(formatEntry('info', args));
  };

  console.debug = (...args) => {
    _origDebug(...args);
    writeToFile(formatEntry('debug', args));
  };

  // Log startup info
  console.log(`📄 Logging to: ${getLogFilePath()}`);
}

/**
 * Write a crash/fatal error to log and exit
 */
function logFatal(error) {
  const entry = formatEntry('fatal', [
    'FATAL ERROR:',
    error.stack || error.message || error,
  ]);
  _origError(entry);
  writeToFile(entry);
}

module.exports = {
  enableFileLogging,
  logFatal,
  getLogFilePath,
  LOG_DIR,
};
