const express = require('express');
const path = require('path');
const { requireAuth, login, logout } = require('./auth');

const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auth routes (no auth required)
app.post('/api/auth/login', login);
app.get('/api/auth/logout', logout);

// All other API routes require authentication
app.use('/api/', requireAuth);

// API Routes
app.use('/api/stats', require('./api/stats'));
app.use('/api/moderation', require('./api/moderation'));
app.use('/api/config', require('./api/config'));
app.use('/api/leveling', require('./api/leveling'));
app.use('/api/logs', require('./api/logs'));
app.use('/api/roles', require('./api/roles'));
app.use('/api/templates', require('./api/templates'));

// SPA fallback — serve index.html for non-API, non-file routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not Found' });
  }
  // If the request has a file extension, let Express static handle it (will 404 naturally)
  if (path.extname(req.path)) {
    return res.status(404).send('Not Found');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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

  // Don't start if WEB_PORT is not set or is '0'
  if (!port || port === '0') {
    return;
  }

  // Store client in app.locals for API routes
  app.locals.client = client;

  app.listen(parseInt(port), () => {
    console.log(`🌐 Web dashboard running at http://localhost:${port}`);
  });
}

module.exports = { startWebServer, app };
