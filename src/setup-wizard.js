#!/usr/bin/env node

/**
 * AiAdminBot Interactive Setup Wizard v1.2
 * Guides users through configuring their bot with a friendly step-by-step process.
 * Works both for source installs and .exe builds.
 *
 * Usage: node src/setup-wizard.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const https = require('https');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function clear() {
  process.stdout.write('\x1Bc');
}

// ── ANSI Color Helpers (no dependencies) ──────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
};

function banner() {
  console.log('');
  console.log(`  ${c.bgBlue}${c.white}${c.bold}                                              ${c.reset}`);
  console.log(`  ${c.bgBlue}${c.white}${c.bold}     🛡️  AiAdminBot — Setup Wizard  v1.2       ${c.reset}`);
  console.log(`  ${c.bgBlue}${c.white}${c.bold}     AI-Powered Discord Administration         ${c.reset}`);
  console.log(`  ${c.bgBlue}${c.white}${c.bold}                                              ${c.reset}`);
  console.log('');
}

function success(msg) {
  console.log(`  ${c.green}✅ ${msg}${c.reset}`);
}

function info(msg) {
  console.log(`  ${c.cyan}ℹ️  ${msg}${c.reset}`);
}

function warn(msg) {
  console.log(`  ${c.yellow}⚠️  ${msg}${c.reset}`);
}

function error(msg) {
  console.log(`  ${c.red}❌ ${msg}${c.reset}`);
}

function stepHeader(num, total, title) {
  const bar = '█'.repeat(num) + '░'.repeat(total - num);
  console.log('');
  console.log(`  ${c.dim}[${bar}] Step ${num}/${total}${c.reset}`);
  console.log(`  ${c.bold}── ${title} ${'─'.repeat(Math.max(0, 47 - title.length))}${c.reset}`);
  console.log('');
}

// ── Token validation ──────────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'AiAdminBot-Setup' },
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

async function validateToken(token) {
  try {
    const res = await httpGet(`https://discord.com/api/v10/users/@me`);
    // We can't actually call this without auth header using https.get easily,
    // so let's do a proper request
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'discord.com',
        path: '/api/v10/users/@me',
        method: 'GET',
        headers: {
          'Authorization': `Bot ${token}`,
          'User-Agent': 'AiAdminBot-Setup',
        },
      };

      const req = https.request(options, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const user = JSON.parse(data);
              resolve({ valid: true, username: user.username, id: user.id });
            } catch {
              resolve({ valid: false });
            }
          } else {
            resolve({ valid: false });
          }
        });
      });

      req.on('error', () => resolve({ valid: false }));
      req.setTimeout(10000, () => {
        req.destroy();
        resolve({ valid: false });
      });
      req.end();
    });
  } catch {
    return { valid: false };
  }
}

// ── Locale preview ────────────────────────────────────────────────────────

function getLocalePreview(locale) {
  const previews = {
    tr: ['doğrulama', 'hoş-geldin', 'kurallar', 'genel-sohbet', 'ai-sohbet', 'ceza-log'],
    en: ['verification', 'welcome', 'rules', 'general-chat', 'ai-chat', 'punishment-log'],
    de: ['verifizierung', 'willkommen', 'regeln', 'allgemein-chat', 'ki-chat', 'strafen-log'],
    es: ['verificación', 'bienvenida', 'reglas', 'chat-general', 'ia-chat', 'registro-castigos'],
    fr: ['vérification', 'bienvenue', 'règles', 'discussion-générale', 'ia-chat', 'journal-sanctions'],
    pt: ['verificação', 'boas-vindas', 'regras', 'bate-papo-geral', 'ia-chat', 'registro-punições'],
    ru: ['верификация', 'добро-пожаловать', 'правила', 'общий-чат', 'ии-чат', 'журнал-наказаний'],
    ar: ['التحقق', 'مرحبا', 'القواعد', 'الدردشة-العامة', 'دردشة-ذكاء', 'سجل-العقوبات'],
  };
  return previews[locale] || previews.en;
}

// Determine paths (works for both source and pkg exe)
function getBasePath() {
  if (process.pkg) {
    return path.dirname(process.execPath);
  }
  return path.join(__dirname, '..');
}

// ── Main wizard ───────────────────────────────────────────────────────────

async function run() {
  clear();
  banner();

  const basePath = getBasePath();
  const envPath = path.join(basePath, '.env');

  const TOTAL_STEPS = 4;

  console.log(`  ${c.white}Welcome! This wizard will help you set up AiAdminBot.${c.reset}`);
  console.log(`  ${c.dim}You'll need a few things ready:${c.reset}`);
  console.log('');
  console.log(`    ${c.cyan}1.${c.reset} A Discord Bot token ${c.dim}(from Discord Developer Portal)${c.reset}`);
  console.log(`    ${c.cyan}2.${c.reset} (Optional) An API key for AI features`);
  console.log('');

  // Check if .env already exists
  if (fs.existsSync(envPath)) {
    const overwrite = await ask(`  ${c.yellow}A .env file already exists. Overwrite? (y/N):${c.reset} `);
    if (overwrite.toLowerCase() !== 'y') {
      info('Keeping existing .env file. Setup cancelled.');
      rl.close();
      return;
    }
  }

  // ── STEP 1: Bot Token ──────────────────────────────────────────────
  stepHeader(1, TOTAL_STEPS, 'Discord Bot Credentials');

  info('Create a bot at: https://discord.com/developers/applications');
  info('Go to Bot tab → Click "Reset Token" → Copy the token');
  console.log('');

  let discordToken = '';
  let botUsername = '';
  let botClientId = '';

  while (true) {
    discordToken = await ask(`  ${c.white}Discord Bot Token:${c.reset} `);
    const trimmed = discordToken.trim();

    if (!trimmed || trimmed.length < 20) {
      warn('Token looks too short. Please try again or press Ctrl+C to exit.');
      continue;
    }

    // Validate token against Discord API
    console.log(`  ${c.dim}  Validating token...${c.reset}`);
    const result = await validateToken(trimmed);

    if (result.valid) {
      botUsername = result.username;
      botClientId = result.id;
      success(`Connected as ${c.bold}${result.username}${c.reset}${c.green} (ID: ${result.id})`);
      break;
    } else {
      warn('Could not validate token with Discord API.');
      const proceed = await ask(`  ${c.yellow}Use this token anyway? (y/N):${c.reset} `);
      if (proceed.toLowerCase() === 'y') {
        // Try to extract client ID from token
        try {
          const parts = trimmed.split('.');
          if (parts.length >= 1) {
            const decoded = Buffer.from(parts[0], 'base64').toString('utf-8');
            if (/^\d{17,20}$/.test(decoded)) {
              botClientId = decoded;
            }
          }
        } catch { /* ignore */ }
        break;
      }
    }
  }

  // ── STEP 2: Language ───────────────────────────────────────────────
  stepHeader(2, TOTAL_STEPS, 'Language');

  console.log('  Supported languages:');
  console.log(`    ${c.cyan}tr${c.reset} = 🇹🇷 Türkçe    ${c.cyan}en${c.reset} = 🇬🇧 English`);
  console.log(`    ${c.cyan}de${c.reset} = 🇩🇪 Deutsch    ${c.cyan}es${c.reset} = 🇪🇸 Español`);
  console.log(`    ${c.cyan}fr${c.reset} = 🇫🇷 Français   ${c.cyan}pt${c.reset} = 🇧🇷 Português`);
  console.log(`    ${c.cyan}ru${c.reset} = 🇷🇺 Русский    ${c.cyan}ar${c.reset} = 🇸🇦 العربية`);
  console.log('');

  let locale = await ask(`  ${c.white}Language code (default: tr):${c.reset} `);
  locale = locale.trim().toLowerCase() || 'tr';
  const validLocales = ['tr', 'en', 'de', 'es', 'fr', 'pt', 'ru', 'ar'];
  if (!validLocales.includes(locale)) {
    warn(`Unknown locale "${locale}". Defaulting to "tr".`);
    locale = 'tr';
  }

  // Show channel name preview
  const preview = getLocalePreview(locale);
  console.log('');
  console.log(`  ${c.dim}Channel preview for "${locale}":${c.reset}`);
  console.log(`    ${c.cyan}#${preview[0]}  #${preview[1]}  #${preview[2]}${c.reset}`);
  console.log(`    ${c.cyan}#${preview[3]}  #${preview[4]}  #${preview[5]}${c.reset}`);
  success(`Language set to "${locale}"`);

  // ── STEP 3: AI Features ────────────────────────────────────────────
  stepHeader(3, TOTAL_STEPS, 'AI Features (Optional)');

  console.log('  AI features can be powered by:');
  console.log(`    ${c.cyan}1.${c.reset} OpenRouter ${c.dim}(free tier available)${c.reset} — https://openrouter.ai/keys`);
  console.log(`    ${c.cyan}2.${c.reset} Google Gemini ${c.dim}(free tier available)${c.reset} — https://aistudio.google.com/apikey`);
  console.log(`    ${c.cyan}3.${c.reset} Both ${c.dim}(with automatic failover)${c.reset}`);
  console.log('');

  let openrouterKey = '';
  let geminiKey = '';
  let aiChatEnabled = false;
  let aiModEnabled = false;

  const aiChoice = await ask(`  ${c.white}Which AI provider? (1/2/3/skip):${c.reset} `);

  if (aiChoice === '1' || aiChoice === '3') {
    openrouterKey = await ask(`  ${c.white}OpenRouter API Key:${c.reset} `);
    if (!openrouterKey || openrouterKey.trim().length < 10) {
      warn('Key looks invalid. You can edit .env later.');
      openrouterKey = '';
    }
  }

  if (aiChoice === '2' || aiChoice === '3') {
    geminiKey = await ask(`  ${c.white}Google Gemini API Key:${c.reset} `);
    if (!geminiKey || geminiKey.trim().length < 10) {
      warn('Key looks invalid. You can edit .env later.');
      geminiKey = '';
    }
  }

  if (openrouterKey.trim() || geminiKey.trim()) {
    const enableChat = await ask(`  ${c.white}Enable AI Chat Assistant? (Y/n):${c.reset} `);
    aiChatEnabled = enableChat.toLowerCase() !== 'n';

    const enableMod = await ask(`  ${c.white}Enable AI Smart Moderation? (Y/n):${c.reset} `);
    aiModEnabled = enableMod.toLowerCase() !== 'n';

    if (openrouterKey.trim() && geminiKey.trim()) {
      info('Both providers configured — failover is automatic!');
    }
  } else if (aiChoice !== 'skip' && aiChoice !== '') {
    info('Skipping AI features. You can enable them later in .env');
  }

  // ── STEP 4: Review & Save ──────────────────────────────────────────
  stepHeader(4, TOTAL_STEPS, 'Review & Save');

  console.log('  Your configuration:');
  console.log('');
  console.log(`    ${c.cyan}Bot:${c.reset}       ${botUsername || '(token set)'}`);
  console.log(`    ${c.cyan}Language:${c.reset}   ${locale}`);
  console.log(`    ${c.cyan}AI Chat:${c.reset}    ${aiChatEnabled ? `${c.green}Enabled${c.reset}` : `${c.dim}Disabled${c.reset}`}`);
  console.log(`    ${c.cyan}AI Mod:${c.reset}     ${aiModEnabled ? `${c.green}Enabled${c.reset}` : `${c.dim}Disabled${c.reset}`}`);
  if (openrouterKey.trim()) console.log(`    ${c.cyan}OpenRouter:${c.reset} ${c.green}Configured${c.reset}`);
  if (geminiKey.trim()) console.log(`    ${c.cyan}Gemini:${c.reset}     ${c.green}Configured${c.reset}`);
  if (openrouterKey.trim() && geminiKey.trim()) console.log(`    ${c.cyan}Failover:${c.reset}   ${c.green}Enabled${c.reset}`);
  console.log('');

  const confirm = await ask(`  ${c.white}Save this configuration? (Y/n):${c.reset} `);
  if (confirm.toLowerCase() === 'n') {
    info('Setup cancelled. Run the wizard again to start over.');
    rl.close();
    return;
  }

  // Build .env content
  let envContent = `# AiAdminBot Configuration
# Generated by Setup Wizard v1.2

# Discord Bot Credentials
DISCORD_TOKEN=${discordToken.trim()}
${botClientId ? `CLIENT_ID=${botClientId}` : '# CLIENT_ID=your_bot_client_id'}

# Database
DATABASE_PATH=./data/bot.db

# Language: tr, en, de, es, fr, pt, ru, ar
LOCALE=${locale}

# Logging
LOG_LEVEL=info
`;

  // AI provider config
  if (geminiKey.trim() && openrouterKey.trim()) {
    // Both — Gemini primary, OpenRouter fallback
    envContent += `
# AI Provider — Dual provider with failover
AI_PROVIDER=gemini
GEMINI_API_KEY=${geminiKey.trim()}
OPENROUTER_API_KEY=${openrouterKey.trim()}
AI_MODEL=gemini-2.0-flash
`;
  } else if (geminiKey.trim()) {
    envContent += `
# AI Provider — Google Gemini
AI_PROVIDER=gemini
GEMINI_API_KEY=${geminiKey.trim()}
AI_MODEL=gemini-2.0-flash
`;
  } else {
    envContent += `
# AI Provider — OpenRouter (Free Models)
OPENROUTER_API_KEY=${openrouterKey.trim() || 'your_openrouter_key_here'}
AI_MODEL=openrouter/free
`;
  }

  envContent += `
# AI Features
AI_CHAT_ENABLED=${aiChatEnabled}
AI_CHAT_CHANNEL=ai-chat
AI_CHAT_RATE_LIMIT=5
AI_MODERATION_ENABLED=${aiModEnabled}
AI_MOD_CONFIDENCE_THRESHOLD=0.8
AI_TIMEOUT_MINUTES=3
`;

  // Write .env
  fs.writeFileSync(envPath, envContent);
  success('.env file created!');

  // Copy example configs if they don't exist
  const configDir = path.join(basePath, 'config');
  const configFiles = [
    { example: 'config.example.json', target: 'config.json' },
    { example: 'server-setup.example.json', target: 'server-setup.json' },
    { example: 'role-menus.example.json', target: 'role-menus.json' },
  ];

  for (const { example, target } of configFiles) {
    const exampleFile = path.join(configDir, example);
    const targetFile = path.join(configDir, target);

    if (!fs.existsSync(targetFile) && fs.existsSync(exampleFile)) {
      fs.copyFileSync(exampleFile, targetFile);
      success(`Created config/${target} from example`);
    }
  }

  // Create data directory if it doesn't exist
  const dataDir = path.join(basePath, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    success('Created data/ directory');
  }

  // ── Completion ─────────────────────────────────────────────────────

  console.log('');
  console.log(`  ${c.bgGreen}${c.white}${c.bold}                                              ${c.reset}`);
  console.log(`  ${c.bgGreen}${c.white}${c.bold}           Setup Complete! 🎉                  ${c.reset}`);
  console.log(`  ${c.bgGreen}${c.white}${c.bold}                                              ${c.reset}`);
  console.log('');

  // Invite link
  if (botClientId) {
    console.log(`  ${c.bold}🔗 Invite your bot to a server:${c.reset}`);
    console.log(`  ${c.cyan}https://discord.com/oauth2/authorize?client_id=${botClientId}&scope=bot+applications.commands&permissions=8${c.reset}`);
    console.log('');
  }

  console.log(`  ${c.bold}Next steps:${c.reset}`);
  console.log('');

  if (process.pkg) {
    console.log(`    ${c.cyan}1.${c.reset} Close this window`);
    console.log(`    ${c.cyan}2.${c.reset} Run AiAdminBot.exe again to start the bot`);
    console.log(`    ${c.cyan}3.${c.reset} Use ${c.bold}/ai-setup${c.reset} in Discord to set up your server`);
    console.log(`    ${c.cyan}4.${c.reset} Use ${c.bold}/server-reset${c.reset} first if you want to clear existing channels`);
  } else {
    console.log(`    ${c.cyan}1.${c.reset} Deploy commands:  ${c.bold}npm run deploy${c.reset}`);
    console.log(`    ${c.cyan}2.${c.reset} Start the bot:    ${c.bold}npm start${c.reset}`);
    console.log(`    ${c.cyan}3.${c.reset} Use ${c.bold}/ai-setup${c.reset} in Discord to set up your server`);
    console.log(`    ${c.cyan}4.${c.reset} Use ${c.bold}/server-reset${c.reset} first if you want to clear existing channels`);
  }

  console.log('');
  info('Edit .env anytime to change settings.');
  info(`Docs: ${c.cyan}https://github.com/HaydarOzturk/AiAdminBot${c.reset}`);
  console.log('');

  rl.close();
}

run().catch(err => {
  console.error(`\n  ${c.red}Setup failed: ${err.message}${c.reset}\n`);
  rl.close();
  process.exit(1);
});
