const crypto = require('crypto');

// ── Configuration ──────────────────────────────────────────────────────────

const WEB_PASSWORD = process.env.WEB_PASSWORD || null;
const OAUTH_CLIENT_SECRET = process.env.WEB_OAUTH_CLIENT_SECRET || null;
const OAUTH_REDIRECT_URI = process.env.WEB_OAUTH_REDIRECT_URI || null;
const DEBUG_OWNER_ID = process.env.DEBUG_OWNER_ID || null;

// Unique cookie name per port to prevent cross-instance logout
const COOKIE_NAME = `admin_token_${process.env.WEB_PORT || '3000'}`;

// Token expiration: 7 days
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// Rate limiting: track failed login attempts per IP
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Cleanup stale rate limit entries every 30 min
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of loginAttempts) {
    if (now - data.firstAttempt > LOGIN_WINDOW_MS) loginAttempts.delete(ip);
  }
}, 1800000);

// Cleanup expired sessions every hour
setInterval(() => {
  try {
    const db = require('../utils/database');
    db.run("DELETE FROM web_sessions WHERE expires_at < datetime('now')");
  } catch { /* DB not ready yet */ }
}, 3600000);

// ── Helpers ────────────────────────────────────────────────────────────────

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie;
  if (!header) return cookies;

  header.split(';').forEach(pair => {
    const [name, ...rest] = pair.trim().split('=');
    if (name) cookies[name] = decodeURIComponent(rest.join('='));
  });

  return cookies;
}

function setCookie(res, token, isSecure) {
  const securePart = isSecure ? ' Secure;' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict;${securePart} Max-Age=${Math.floor(TOKEN_EXPIRY_MS / 1000)}; Path=/`
  );
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/`);
}

// ── Session Store (SQLite-backed) ──────────────────────────────────────────

function saveSession(token, { discordUserId, discordUsername, guildIds, ip }) {
  const db = require('../utils/database');
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS).toISOString();
  db.run(
    `INSERT INTO web_sessions (token, discord_user_id, discord_username, guild_ids, expires_at, ip_address)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET expires_at = ?, guild_ids = ?`,
    [token, discordUserId || null, discordUsername || null, JSON.stringify(guildIds || []), expiresAt, ip || null,
     expiresAt, JSON.stringify(guildIds || [])]
  );
}

function getSession(token) {
  if (!token) return null;
  const db = require('../utils/database');
  const row = db.get('SELECT * FROM web_sessions WHERE token = ?', [token]);
  if (!row) return null;

  // Check expiry
  if (new Date(row.expires_at) < new Date()) {
    db.run('DELETE FROM web_sessions WHERE token = ?', [token]);
    return null;
  }

  return {
    token: row.token,
    discordUserId: row.discord_user_id,
    discordUsername: row.discord_username,
    guildIds: JSON.parse(row.guild_ids || '[]'),
    ip: row.ip_address,
  };
}

function refreshSession(token) {
  const db = require('../utils/database');
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS).toISOString();
  db.run('UPDATE web_sessions SET expires_at = ? WHERE token = ?', [expiresAt, token]);
}

function deleteSession(token) {
  if (!token) return;
  const db = require('../utils/database');
  db.run('DELETE FROM web_sessions WHERE token = ?', [token]);
}

// ── Password Login ─────────────────────────────────────────────────────────

function login(req, res) {
  if (!WEB_PASSWORD) {
    return res.status(503).json({ error: 'Dashboard password not configured. Set WEB_PASSWORD in .env' });
  }

  // Rate limiting by IP
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const attempts = loginAttempts.get(ip);

  if (attempts) {
    if (now - attempts.firstAttempt > LOGIN_WINDOW_MS) {
      loginAttempts.delete(ip);
    } else if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
      const retryAfter = Math.ceil((LOGIN_WINDOW_MS - (now - attempts.firstAttempt)) / 1000);
      return res.status(429).json({ error: `Too many login attempts. Try again in ${retryAfter}s` });
    }
  }

  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }

  // Timing-safe comparison
  const pwBuf = Buffer.from(password);
  const expectedBuf = Buffer.from(WEB_PASSWORD);
  const valid = pwBuf.length === expectedBuf.length && crypto.timingSafeEqual(pwBuf, expectedBuf);

  if (!valid) {
    const existing = loginAttempts.get(ip);
    if (existing) {
      existing.count++;
    } else {
      loginAttempts.set(ip, { count: 1, firstAttempt: now });
    }
    return res.status(401).json({ error: 'Invalid password' });
  }

  // Successful password login — no Discord identity
  loginAttempts.delete(ip);

  const token = generateToken();
  saveSession(token, { discordUserId: null, discordUsername: null, guildIds: [], ip });

  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  setCookie(res, token, isSecure);

  return res.json({ success: true, message: 'Logged in', authMethod: 'password' });
}

// ── Discord OAuth2 ─────────────────────────────────────────────────────────

function isOAuthConfigured() {
  return !!(OAUTH_CLIENT_SECRET && OAUTH_REDIRECT_URI);
}

/**
 * GET /api/auth/discord — redirect user to Discord OAuth2 consent page
 */
function oauthRedirect(req, res) {
  if (!isOAuthConfigured()) {
    return res.status(503).json({ error: 'Discord OAuth not configured' });
  }

  const clientId = req.app.locals.client?.user?.id || process.env.CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'CLIENT_ID not available' });
  }

  // Generate state parameter to prevent CSRF on OAuth callback
  const state = crypto.randomBytes(16).toString('hex');
  // Store state temporarily in a short-lived cookie
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const securePart = isSecure ? ' Secure;' : '';
  res.setHeader('Set-Cookie',
    `oauth_state=${state}; HttpOnly; SameSite=Lax;${securePart} Max-Age=600; Path=/`
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds',
    state,
  });

  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
}

/**
 * GET /api/auth/callback — handle Discord OAuth2 callback
 */
async function oauthCallback(req, res) {
  if (!isOAuthConfigured()) {
    return res.status(503).send('Discord OAuth not configured');
  }

  const { code, state } = req.query;
  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  // Verify state parameter
  const cookies = parseCookies(req);
  if (!state || state !== cookies.oauth_state) {
    return res.status(403).send('Invalid state parameter — possible CSRF attack');
  }

  // Clear the state cookie
  res.appendHeader('Set-Cookie', 'oauth_state=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/');

  const clientId = req.app.locals.client?.user?.id || process.env.CLIENT_ID;

  try {
    // Exchange code for access token
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: OAUTH_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: OAUTH_REDIRECT_URI,
      }),
    });

    if (!tokenResponse.ok) {
      console.error('OAuth token exchange failed:', tokenResponse.status);
      return res.status(401).send('Failed to authenticate with Discord');
    }

    const tokenData = await tokenResponse.json();

    // Fetch user info
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userResponse.ok) {
      return res.status(401).send('Failed to fetch user info from Discord');
    }

    const user = await userResponse.json();

    // Fetch user's guilds
    const guildsResponse = await fetch('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    let ownedGuildIds = [];
    if (guildsResponse.ok) {
      const guilds = await guildsResponse.json();
      // Filter to guilds where user is the owner AND bot is also in
      const botClient = req.app.locals.client;
      const botGuildIds = botClient ? [...botClient.guilds.cache.keys()] : [];

      ownedGuildIds = guilds
        .filter(g => g.owner && botGuildIds.includes(g.id))
        .map(g => g.id);
    }

    // Check: user must own at least one guild the bot is in, OR be the debug owner
    const isDebugOwner = DEBUG_OWNER_ID && user.id === DEBUG_OWNER_ID;
    if (ownedGuildIds.length === 0 && !isDebugOwner) {
      return res.status(403).send('You are not the owner of any server this bot is in.');
    }

    // If debug owner, grant access to all bot guilds
    if (isDebugOwner) {
      const botClient = req.app.locals.client;
      ownedGuildIds = botClient ? [...botClient.guilds.cache.keys()] : [];
    }

    // Create session
    const token = generateToken();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    saveSession(token, {
      discordUserId: user.id,
      discordUsername: user.username,
      guildIds: ownedGuildIds,
      ip,
    });

    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    setCookie(res, token, isSecure);

    console.log(`🔐 OAuth login: ${user.username} (${user.id}) — ${ownedGuildIds.length} guild(s)`);

    // Redirect to dashboard
    res.redirect('/');
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    res.status(500).send('Authentication failed. Please try again.');
  }
}

// ── Logout ─────────────────────────────────────────────────────────────────

function logout(req, res) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  deleteSession(token);

  clearCookie(res);
  return res.json({ success: true, message: 'Logged out' });
}

// ── Auth Middleware ─────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];

  const session = getSession(token);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Attach session to request for downstream use
  req.session = session;

  // Refresh expiry
  refreshSession(token);
  next();
}

// ── Guild Access Middleware ─────────────────────────────────────────────────

/**
 * Checks if the authenticated user has access to the requested guild.
 * - OAuth users: must own the guild (guild ID in session.guildIds)
 * - Password users (no Discord identity): access all guilds (backward compatible)
 * - DEBUG_OWNER_ID: access all guilds
 */
function requireGuildAccess(req, res, next) {
  const guildId = req.params.guildId;
  if (!guildId) return next(); // Non-guild routes pass through

  // Validate guildId format (Discord snowflake)
  if (!/^\d{17,20}$/.test(guildId)) {
    return res.status(400).json({ error: 'Invalid guild ID format' });
  }

  const session = req.session;

  // Password login (no Discord identity) — allow all guilds (backward compatible)
  if (!session?.discordUserId) {
    return next();
  }

  // Debug owner — allow all guilds
  if (DEBUG_OWNER_ID && session.discordUserId === DEBUG_OWNER_ID) {
    return next();
  }

  // OAuth user — check if they own this guild
  if (!session.guildIds.includes(guildId)) {
    return res.status(403).json({ error: 'You do not have access to this server' });
  }

  next();
}

// ── Auth Status Endpoint ───────────────────────────────────────────────────

function authStatus(req, res) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  const session = getSession(token);

  res.json({
    authenticated: !!session,
    oauthConfigured: isOAuthConfigured(),
    user: session ? {
      discordUserId: session.discordUserId,
      discordUsername: session.discordUsername,
      guildCount: session.guildIds.length,
      authMethod: session.discordUserId ? 'discord' : 'password',
    } : null,
  });
}

module.exports = {
  login,
  logout,
  requireAuth,
  requireGuildAccess,
  oauthRedirect,
  oauthCallback,
  authStatus,
  isOAuthConfigured,
};
