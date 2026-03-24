const crypto = require('crypto');

const WEB_PASSWORD = process.env.WEB_PASSWORD || 'admin';

// In-memory token store: token -> expiresAt
const tokenStore = new Map();

// Token expiration: 7 days
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

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
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }

  if (password !== WEB_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const token = generateToken();
  const expiresAt = Date.now() + TOKEN_EXPIRY_MS;
  tokenStore.set(token, expiresAt);

  res.setHeader('Set-Cookie',
    `admin_token=${token}; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TOKEN_EXPIRY_MS / 1000)}; Path=/`
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
