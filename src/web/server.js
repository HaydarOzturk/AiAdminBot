const express = require('express');
const path = require('path');
const { requireAuth, login, logout } = require('./auth');

const app = express();

// Middleware
app.use(express.json());

// Static files: use extracted real directory for pkg exe, or bundled path for dev
const publicDir = process.env.__WEB_PUBLIC_DIR || path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Auth routes (no auth required)
app.post('/api/auth/login', login);
app.get('/api/auth/logout', logout);
app.post('/api/auth/logout', logout);

// All other API routes require authentication
app.use('/api/', requireAuth);

// API Routes — match frontend URL pattern: /api/guilds/:guildId/<section>/...
app.use('/api/stats', require('./api/stats'));
app.use('/api/logs', require('./api/logs'));
app.use('/api/guilds', require('./api/guilds'));
app.use('/api/settings', require('./api/settings'));

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

// Error handling
app.use((err, req, res, next) => {
  console.error('Web server error:', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
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

  app.listen(parseInt(port), () => {
    console.log(`🌐 Web dashboard running at http://localhost:${port}`);
  });
}

module.exports = { startWebServer, app };
