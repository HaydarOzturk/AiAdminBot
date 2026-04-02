const crypto = require('crypto');

// No default password — dashboard is disabled if WEB_PASSWORD is not set
const WEB_PASSWORD = process.env.WEB_PASSWORD || null;

// In-memory token store: token -> expiresAt
const tokenStore = new Map();

// Token expiration: 7 days
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// Rate limiting: track failed login attempts per IP
const loginAttempts = new Map(); // ip -> { count, firstAttempt }
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Cleanup stale rate limit entries every 30 min
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of loginAttempts) {
    if (now - data.firstAttempt > LOGIN_WINDOW_MS) loginAttempts.delete(ip);
  }
}, 1800000);

/**
 * Generate a secure random token
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Parse cookies from request header (no cookie-parser dependency needed)
 */
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

/**
 * Validate a token
 */
function validateToken(token) {
  if (!token || !tokenStore.has(token)) return false;

  const expiresAt = tokenStore.get(token);
  if (Date.now() > expiresAt) {
    tokenStore.delete(token);
    return false;
  }

  return true;
}

/**
 * Login route: POST /api/auth/login
 */
function login(req, res) {
  // Dashboard is disabled if no password is configured
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

  if (password !== WEB_PASSWORD) {
    // Track failed attempt
    const existing = loginAttempts.get(ip);
    if (existing) {
      existing.count++;
    } else {
      loginAttempts.set(ip, { count: 1, firstAttempt: now });
    }
    return res.status(401).json({ error: 'Invalid password' });
  }

  // Successful login — clear rate limit
  loginAttempts.delete(ip);

  const token = generateToken();
  const expiresAt = Date.now() + TOKEN_EXPIRY_MS;
  tokenStore.set(token, expiresAt);

  // Add Secure flag only when actually using HTTPS
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const securePart = isSecure ? ' Secure;' : '';
  res.setHeader('Set-Cookie',
    `admin_token=${token}; HttpOnly; SameSite=Lax;${securePart} Max-Age=${Math.floor(TOKEN_EXPIRY_MS / 1000)}; Path=/`
  );

  return res.json({ success: true, message: 'Logged in' });
}

/**
 * Logout route: GET /api/auth/logout
 */
function logout(req, res) {
  const cookies = parseCookies(req);
  const token = cookies.admin_token;
  if (token) tokenStore.delete(token);

  res.setHeader('Set-Cookie', 'admin_token=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/');
  return res.json({ success: true, message: 'Logged out' });
}

/**
 * Authentication middleware
 */
function requireAuth(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies.admin_token;

  if (!validateToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Refresh token expiry
  tokenStore.set(token, Date.now() + TOKEN_EXPIRY_MS);
  next();
}

module.exports = { login, logout, requireAuth };
