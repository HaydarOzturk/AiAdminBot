/**
 * Build script that produces timestamped executables.
 *
 * Usage:  node scripts/build.js [target]
 *   target = win | mac | linux | all   (default: win)
 *
 * Output: dist/AiAdminBot-v{version}-{YYYYMMDD-HHmm}-{platform}.exe
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const version = pkg.version;

// Timestamp: YYYYMMDD-HHmm
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

const TARGETS = {
  win:   { pkg: 'node20-win-x64',   ext: '.exe' },
  mac:   { pkg: 'node20-macos-x64', ext: ''     },
  linux: { pkg: 'node20-linux-x64', ext: ''     },
};

const arg = (process.argv[2] || 'win').toLowerCase();
const platforms = arg === 'all' ? Object.keys(TARGETS) : [arg];

if (!platforms.every(p => TARGETS[p])) {
  console.error(`Unknown target: ${arg}. Use: win | mac | linux | all`);
  process.exit(1);
}

const distDir = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

for (const platform of platforms) {
  const { pkg: target, ext } = TARGETS[platform];
  const outName = `AiAdminBot-v${version}-${stamp}-${platform}${ext}`;
  const outPath = path.join(distDir, outName);

  console.log(`\n🔨 Building ${outName} ...`);

  execSync(
    `npx pkg . --targets ${target} --output "${outPath}"`,
    { stdio: 'inherit', cwd: path.join(__dirname, '..') }
  );

  const size = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
  console.log(`✅ ${outName}  (${size} MB)`);
}

console.log('\n🎉 Build complete! Files are in dist/');
