const express = require('express');
const path = require('path');
const { requireAuth, requireGuildAccess, login, logout, oauthRedirect, oauthCallback, authStatus } = require('./auth');

const app = express();

// Trust reverse proxy (nginx/Cloudflare) — enables correct req.ip and req.secure
if (process.env.WEB_TRUST_PROXY) app.set('trust proxy', parseInt(process.env.WEB_TRUST_PROXY) || 1);

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // CSP: report-only first — won't block anything, just logs violations in browser console
  res.setHeader('Content-Security-Policy-Report-Only', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https://cdn.discordapp.com data:; connect-src 'self'; frame-ancestors 'none'");
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.removeHeader('X-Powered-By');
  next();
});

// Middleware
app.use(express.json({ limit: '100kb' }));

// Static files: use extracted real directory for pkg exe, or bundled path for dev
const publicDir = process.env.__WEB_PUBLIC_DIR || path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Rate limiting: 100 requests per minute per IP for API endpoints
const apiRateLimits = new Map();
const API_RATE_LIMIT = 100;
const API_RATE_WINDOW = 60000;
const RESTART_RATE_WINDOW = 300000; // 5 minutes
const restartTimestamps = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of apiRateLimits) {
    if (now - data.windowStart > API_RATE_WINDOW) apiRateLimits.delete(ip);
  }
  for (const [ip, ts] of restartTimestamps) {
    if (now - ts > RESTART_RATE_WINDOW) restartTimestamps.delete(ip);
  }
}, 60000);

app.use('/api/', (req, res, next) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = apiRateLimits.get(ip);

  if (!entry || now - entry.windowStart > API_RATE_WINDOW) {
    apiRateLimits.set(ip, { count: 1, windowStart: now });
    return next();
  }
  if (entry.count >= API_RATE_LIMIT) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }
  entry.count++;
  next();
});

// Auth routes (no auth required)
app.post('/api/auth/login', login);
app.get('/api/auth/logout', logout);
app.post('/api/auth/logout', logout);
app.get('/api/auth/status', authStatus);
app.get('/api/auth/discord', oauthRedirect);
app.get('/api/auth/callback', oauthCallback);

// CSRF protection: block cross-origin state-changing requests
app.use('/api/', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const origin = req.headers.origin;
  if (!origin) return next(); // Same-origin requests may omit Origin header

  // Build list of allowed origins from redirect URI or localhost
  const allowed = ['http://localhost', 'https://localhost'];
  if (process.env.WEB_OAUTH_REDIRECT_URI) {
    try {
      const url = new URL(process.env.WEB_OAUTH_REDIRECT_URI);
      allowed.push(url.origin);
    } catch {}
  }

  if (!allowed.some(o => origin === o || origin.startsWith(o + ':'))) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  next();
});

// All other API routes require authentication
app.use('/api/', requireAuth);

// API Routes — match frontend URL pattern: /api/guilds/:guildId/<section>/...
app.use('/api/stats', require('./api/stats'));
app.use('/api/logs', require('./api/logs'));

// Guild-scoped routes require guild access check BEFORE the router handles them
app.use('/api/guilds/:guildId', requireGuildAccess);
app.use('/api/guilds', require('./api/guilds'));

app.use('/api/settings/:guildId', requireGuildAccess);
app.use('/api/settings', require('./api/settings'));
app.use('/api/leveling/:guildId', requireGuildAccess);
app.use('/api/logs/:guildId', requireGuildAccess);

// Invite URL endpoint — generates OAuth2 invite link
app.get('/api/invite', (req, res) => {
  const client = req.app.locals.client;
  const clientId = client?.user?.id || process.env.CLIENT_ID;

  if (!clientId) {
    return res.status(400).json({ error: 'CLIENT_ID not available' });
  }

  // Permission 8 = Administrator (the bot needs full perms for server setup)
  const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot+applications.commands&integration_type=0`;

  res.json({
    inviteUrl,
    clientId,
    botName: client?.user?.username || 'AiAdminBot',
    botAvatar: client?.user?.displayAvatarURL?.({ size: 128 }) || null,
  });
});

// Restart endpoint — relies on PM2 to auto-restart the process (rate limited: 1 per 5 min)
app.post('/api/restart', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const lastRestart = restartTimestamps.get(ip);
  if (lastRestart && Date.now() - lastRestart < RESTART_RATE_WINDOW) {
    const retryAfter = Math.ceil((RESTART_RATE_WINDOW - (Date.now() - lastRestart)) / 1000);
    return res.status(429).json({ error: `Restart rate limited. Try again in ${retryAfter}s` });
  }
  restartTimestamps.set(ip, Date.now());

  console.log(`🔄 Restart requested via dashboard by ${req.session?.discordUsername || ip}`);
  res.json({ success: true, message: 'Bot is restarting...' });

  // Give the response time to flush, then exit — PM2 restarts automatically
  setTimeout(() => {
    process.exit(0);
  }, 500);
});

// SPA fallback — serve index.html for non-API, non-file routes
app.get('/{*splat}', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not Found' });
  }
  if (path.extname(req.path)) {
    return res.status(404).send('Not Found');
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Error handling — don't leak implementation details to client
app.use((err, req, res, next) => {
  console.error('Web server error:', err.message);
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
  });
});

/**
 * Start the web server (optional — only if WEB_PORT is set)
 * @param {import('discord.js').Client} client
 */
function startWebServer(client) {
  const port = process.env.WEB_PORT;

  if (!port || port === '0') {
    return;
  }

  app.locals.client = client;

  // HTTPS support: if WEB_HTTPS_KEY and WEB_HTTPS_CERT are set, use HTTPS
  const keyPath = process.env.WEB_HTTPS_KEY;
  const certPath = process.env.WEB_HTTPS_CERT;

  if (keyPath && certPath) {
    try {
      const fs = require('fs');
      const https = require('https');
      const sslOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      };
      https.createServer(sslOptions, app).listen(parseInt(port), () => {
        console.log(`🔒 Web dashboard running at https://localhost:${port}`);
      });
      return;
    } catch (err) {
      console.warn(`⚠️ HTTPS failed (${err.message}), falling back to HTTP`);
    }
  }

  app.listen(parseInt(port), () => {
    console.log(`🌐 Web dashboard running at http://localhost:${port}`);
  });
}

module.exports = { startWebServer, app };
