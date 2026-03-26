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
 * When running as exe, defaults WEB_PORT=3000 and auto-opens the browser.
 */

const fs = require('fs');
const path = require('path');

// Determine the directory where the .exe lives (or project root for dev)
const basePath = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');

// ── Debug log to file (persists even when CLI wizard clears screen) ──────
const debugLogPath = path.join(basePath, '_setup_debug.log');
function debugLog(...args) {
  const line = '[' + new Date().toISOString() + '] ' + args.join(' ') + '\n';
  try { fs.appendFileSync(debugLogPath, line); } catch { /* ignore */ }
}
// Clear previous debug log on start
try { fs.writeFileSync(debugLogPath, '=== AiAdminBot Setup Debug Log ===\n'); } catch { /* ignore */ }
const envPath = path.join(basePath, '.env');

// Set working directory to base path so dotenv and relative paths work
process.chdir(basePath);

// ── Ensure required directories exist ──────────────────────────────────
['data', 'logs', 'config'].forEach(dir => {
  const dirPath = path.join(basePath, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

// ── Copy WASM file for sql.js (pkg can't load it from virtual FS) ──────
if (process.pkg) {
  try {
    const wasmBundled = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
    const wasmReal = path.join(basePath, 'sql-wasm.wasm');
    if (!fs.existsSync(wasmReal) && fs.existsSync(wasmBundled)) {
      fs.copyFileSync(wasmBundled, wasmReal);
      console.log('  Extracted sql-wasm.wasm');
    }
  } catch { /* ignore — will fall back to JS-only mode */ }
}

// ── Copy web public files from virtual FS to real FS (pkg workaround) ──
if (process.pkg) {
  try {
    const publicBundled = path.join(__dirname, '..', 'src', 'web', 'public');
    const publicReal = path.join(basePath, '_web_public');

    // Only copy if the bundled directory exists in virtual FS
    if (fs.existsSync(publicBundled)) {
      copyDirSync(publicBundled, publicReal);
      // Set env var so server.js can find the real path
      process.env.__WEB_PUBLIC_DIR = publicReal;
    }
  } catch (err) {
    console.warn('  Warning: Could not extract web assets:', err.message);
  }
}

// ── Copy setup guide images from virtual FS to real FS ──────────────
if (process.pkg) {
  try {
    const guidesBundled = path.join(__dirname, '..', 'assets', 'setup-guide');
    const guidesReal = path.join(basePath, '_setup_guide');

    if (fs.existsSync(guidesBundled)) {
      copyDirSync(guidesBundled, guidesReal);
      debugLog('Extracted setup guide images to:', guidesReal);
    }
  } catch (err) {
    debugLog('Warning: Could not extract setup guide images:', err.message);
  }
}

/**
 * Recursively copy a directory from virtual FS to real FS
 */
function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      // Only copy if file doesn't exist or is different size
      try {
        if (!fs.existsSync(destPath) ||
            fs.statSync(srcPath).size !== fs.statSync(destPath).size) {
          fs.copyFileSync(srcPath, destPath);
        }
      } catch {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

// ── Check if setup is needed ───────────────────────────────────────────
if (!fs.existsSync(envPath)) {
  console.log('');
  console.log('  No .env file found — starting setup wizard...');
  console.log('');

  // Try native GUI wizard on Windows, fall back to CLI wizard
  debugLog('Platform:', process.platform);
  debugLog('process.pkg:', !!process.pkg);
  debugLog('Node version:', process.version);
  debugLog('basePath:', basePath);

  if (process.platform === 'win32') {
    debugLog('Windows detected, loading setup-wizard-gui...');
    let guiModule;
    try {
      guiModule = require('./setup-wizard-gui');
      debugLog('setup-wizard-gui loaded OK');
    } catch (loadErr) {
      debugLog('FAILED to load setup-wizard-gui:', loadErr.message);
      debugLog('Stack:', loadErr.stack);
      console.log('  Falling back to CLI wizard...');
      require('./setup-wizard');
      guiModule = null;
    }

    if (guiModule) {
      const { runGUI, isPowerShellAvailable } = guiModule;

      debugLog('Checking PowerShell availability...');
      const psAvailable = isPowerShellAvailable();
      debugLog('PowerShell available:', psAvailable);

      if (psAvailable) {
        debugLog('Launching GUI wizard...');
        runGUI().then(success => {
          debugLog('GUI wizard finished, success:', success);
          if (success && fs.existsSync(envPath)) {
            console.log('  Starting bot...');
            console.log('');
            require('./index');

            // Auto-open dashboard if configured
            if (process.pkg && process.env.WEB_PORT) {
              const port = process.env.WEB_PORT || '3000';
              setTimeout(() => {
                try {
                  const { exec } = require('child_process');
                  const url = `http://localhost:${port}`;
                  console.log(`\n  Opening dashboard: ${url}\n`);
                  exec(`start ${url}`);
                } catch { /* ignore */ }
              }, 3000);
            }
          } else {
            console.log('  Setup not completed. Run the exe again to retry.');
            if (!process.pkg) process.exit(0);
            setTimeout(() => process.exit(0), 5000);
          }
        }).catch(err => {
          debugLog('GUI wizard THREW error:', err.message);
          debugLog('Stack:', err.stack);
          console.log('  Falling back to CLI wizard...');
          require('./setup-wizard');
        });
      } else {
        debugLog('PowerShell not available, using CLI wizard');
        require('./setup-wizard');
      }
    } // end if (guiModule)
  } else {
    // Linux/Mac — use CLI wizard
    console.log('  [DEBUG] Non-Windows platform, using CLI wizard');
    require('./setup-wizard');
  }
} else {
  // ── When running as exe, check dashboard config ───────────────────
  if (process.pkg) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const hasWebPort = envContent.match(/^WEB_PORT\s*=/m);
    const hasWebPassword = envContent.match(/^WEB_PASSWORD\s*=/m);

    if (hasWebPort && !hasWebPassword) {
      // Dashboard port is set but no password — warn the user
      console.log('  ⚠️  Dashboard has no WEB_PASSWORD set in .env!');
      console.log('  Add WEB_PASSWORD=your_password to .env for security.');
    }
  }

  // .env exists — start the bot
  require('./index');

  // ── Auto-open browser after a short delay ────────────────────────
  if (process.pkg) {
    const port = process.env.WEB_PORT || '3000';
    setTimeout(() => {
      try {
        const { exec } = require('child_process');
        const url = `http://localhost:${port}`;
        console.log(`\n  Opening dashboard: ${url}\n`);
        exec(`start ${url}`);
      } catch { /* ignore if browser open fails */ }
    }, 3000);
  }
}
