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

  // Run setup wizard (it will create .env)
  require('./setup-wizard');
} else {
  // ── When running as exe, ensure dashboard is enabled ───────────────
  if (process.pkg) {
    // Load existing .env manually to check WEB_PORT
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const hasWebPort = envContent.match(/^WEB_PORT\s*=/m);

    if (!hasWebPort) {
      // Append WEB_PORT to .env so the dashboard starts automatically
      fs.appendFileSync(envPath, '\n\n# Auto-enabled by exe launcher\nWEB_PORT=3000\nWEB_PASSWORD=admin\n');
      console.log('  Dashboard enabled on port 3000 (password: admin)');
      console.log('  Change WEB_PASSWORD in .env for security!');
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
