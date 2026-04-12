const express = require('express');
const path = require('path');
const { requireAuth, requireGuildAccess, login, logout, oauthRedirect, oauthCallback, authStatus } = require('./auth');

const app = express();

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.removeHeader('X-Powered-By');
  next();
});

// Middleware
app.use(express.json({ limit: '100kb' }));

// Static files: use extracted real directory for pkg exe, or bundled path for dev
const publicDir = process.env.__WEB_PUBLIC_DIR || path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Auth routes (no auth required)
app.post('/api/auth/login', login);
app.get('/api/auth/logout', logout);
app.post('/api/auth/logout', logout);
app.get('/api/auth/status', authStatus);
app.get('/api/auth/discord', oauthRedirect);
app.get('/api/auth/callback', oauthCallback);

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

// Restart endpoint — relies on PM2 to auto-restart the process
app.post('/api/restart', (req, res) => {
  console.log('🔄 Restart requested via dashboard');
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
