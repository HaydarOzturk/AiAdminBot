/**
 * Streaming Checker — Detects live status on external platforms.
 *
 * Supported platforms:
 *   - kick           → Kick.com (public API v2)
 *   - twitch         → Twitch.tv (Helix API — requires Client ID + Secret)
 *   - youtube        → YouTube horizontal (Data API v3)
 *   - youtube-shorts → YouTube Shorts / vertical (same API, separate link)
 *
 * Each checker returns: { isLive, title, viewers, url }
 * All checkers are non-throwing — they return isLive:false on error.
 */

const https = require('https');

// ─── Generic HTTPS helpers ───────────────────────────────────────────────────

/**
 * Simple HTTPS GET that returns parsed JSON. Times out after `ms` ms.
 * Uses browser-like headers to avoid Cloudflare blocks.
 * @param {string} url
 * @param {object} [extraHeaders={}]
 * @param {number} [ms=8000]
 * @returns {Promise<object|null>}
 */
function fetchJson(url, extraHeaders = {}, ms = 8000) {
  const parsed = new URL(url);
  const options = {
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    timeout: ms,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      ...extraHeaders,
    },
  };

  return new Promise(resolve => {
    const req = https.get(options, res => {
      if (res.statusCode !== 200) {
        console.warn(`⚠️ fetchJson ${parsed.hostname}${parsed.pathname} → HTTP ${res.statusCode}`);
        res.resume();
        return resolve(null);
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', (err) => { console.warn(`⚠️ fetchJson ${parsed.hostname} error: ${err.message}`); resolve(null); });
    req.on('timeout', () => { req.destroy(); console.warn(`⚠️ fetchJson ${parsed.hostname} timeout`); resolve(null); });
  });
}

/**
 * HTTPS POST with form data, returns parsed JSON.
 */
function postForm(url, body, ms = 6000) {
  const parsed = new URL(url);
  const postData = new URLSearchParams(body).toString();

  return new Promise(resolve => {
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      timeout: ms,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, res => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(postData);
    req.end();
  });
}

// ─── Kick ────────────────────────────────────────────────────────────────────

/**
 * Extract the Kick channel slug from a URL or handle.
 */
function extractKickSlug(input) {
  const match = input.match(/kick\.com\/([^/?#]+)/i);
  if (match) return match[1].toLowerCase();
  return input.replace(/^@/, '').trim().toLowerCase();
}

// Cache the Kick app access token in memory
let _kickToken = null;
let _kickTokenExpiry = 0;

/**
 * Get a Kick app access token using Client Credentials flow.
 * @returns {Promise<string|null>}
 */
async function getKickToken() {
  const clientId = process.env.KICK_CLIENT_ID;
  const clientSecret = process.env.KICK_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (_kickToken && Date.now() < _kickTokenExpiry) return _kickToken;

  const data = await postForm('https://id.kick.com/oauth/token', {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  });

  if (!data?.access_token) {
    console.warn('⚠️ Kick OAuth token request failed');
    return null;
  }

  console.log('✅ Kick OAuth token obtained');
  _kickToken = data.access_token;
  _kickTokenExpiry = Date.now() + (parseInt(data.expires_in) || 3600) * 1000 - 60000;
  return _kickToken;
}

/**
 * Check if a Kick channel is live.
 *
 * Strategy (tries in order, returns first success):
 *  1. Official API (api.kick.com) — if KICK_CLIENT_ID & SECRET are set
 *  2. Legacy v1 API — kick.com/api/v1/channels/{slug}
 *  3. Legacy v2 API — kick.com/api/v2/channels/{slug}
 */
async function checkKick(handleOrUrl) {
  const slug = extractKickSlug(handleOrUrl);
  const channelUrl = `https://kick.com/${slug}`;

  // ── Strategy 1: Official Kick API (OAuth) ─────────────────────────────
  const kickToken = await getKickToken();
  if (kickToken) {
    const data = await fetchJson(
      `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(slug)}`,
      { 'Authorization': `Bearer ${kickToken}` }
    );

    if (data?.data?.[0]) {
      const ch = data.data[0];
      const stream = ch.stream || {};
      const isLive = !!(stream.is_live || ch.is_live);
      console.log(`✅ Kick official API for "${slug}" → is_live: ${isLive}`);
      return {
        isLive,
        title: stream.session_title || stream.title || '',
        viewers: stream.viewer_count || 0,
        url: channelUrl,
      };
    }
    console.warn(`⚠️ Kick official API returned no data for "${slug}"`);
  }

  // ── Strategy 2: Legacy v1 API ─────────────────────────────────────────
  const v1Data = await fetchJson(`https://kick.com/api/v1/channels/${encodeURIComponent(slug)}`);
  if (v1Data) {
    console.log(`✅ Kick v1 API responded for "${slug}"`);
    const isLive = !!(v1Data.livestream && v1Data.livestream.is_live);
    return {
      isLive,
      title: v1Data.livestream?.session_title || '',
      viewers: v1Data.livestream?.viewer_count || 0,
      url: channelUrl,
    };
  }

  // ── Strategy 3: Legacy v2 API ─────────────────────────────────────────
  const v2Data = await fetchJson(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`);
  if (v2Data) {
    console.log(`✅ Kick v2 API responded for "${slug}"`);
    return {
      isLive: !!(v2Data.livestream && v2Data.livestream.is_live),
      title: v2Data.livestream?.session_title || '',
      viewers: v2Data.livestream?.viewer_count || 0,
      url: channelUrl,
    };
  }

  console.warn(`⚠️ Kick: all strategies failed for slug "${slug}" — check PM2 logs for HTTP status codes`);
  return { isLive: false, title: '', viewers: 0, url: channelUrl, error: true };
}

// ─── Twitch ──────────────────────────────────────────────────────────────────

// Cache the Twitch app access token in memory (expires after ~60 days)
let _twitchToken = null;
let _twitchTokenExpiry = 0;

/**
 * Get a Twitch app access token using Client Credentials flow.
 * @returns {Promise<string|null>}
 */
async function getTwitchToken() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  // Return cached token if still valid
  if (_twitchToken && Date.now() < _twitchTokenExpiry) return _twitchToken;

  const data = await postForm('https://id.twitch.tv/oauth2/token', {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  });

  if (!data?.access_token) return null;

  _twitchToken = data.access_token;
  _twitchTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000 - 60000; // 1 min buffer
  return _twitchToken;
}

/**
 * Extract Twitch username from URL or handle.
 */
function extractTwitchLogin(input) {
  const match = input.match(/twitch\.tv\/([^/?#]+)/i);
  if (match) return match[1].toLowerCase();
  return input.replace(/^@/, '').trim().toLowerCase();
}

/**
 * Check if a Twitch channel is live using Helix API.
 */
async function checkTwitch(handleOrUrl) {
  const login = extractTwitchLogin(handleOrUrl);
  const channelUrl = `https://twitch.tv/${login}`;

  const token = await getTwitchToken();
  if (!token) {
    console.warn('⚠️ TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET not set — skipping Twitch live check');
    return { isLive: false, title: '', viewers: 0, url: channelUrl, error: true };
  }

  const apiUrl = `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`;
  const data = await fetchJson(apiUrl, {
    'Client-ID': process.env.TWITCH_CLIENT_ID,
    'Authorization': `Bearer ${token}`,
  });

  if (!data) {
    console.warn(`⚠️ Twitch API request failed for "${login}" — network error`);
    return { isLive: false, title: '', viewers: 0, url: channelUrl, error: true };
  }

  if (!data.data?.length) {
    console.log(`✅ Twitch API for "${login}" → isLive: false`);
    return { isLive: false, title: '', viewers: 0, url: channelUrl };
  }

  const stream = data.data[0];
  const isLive = stream.type === 'live';
  console.log(`✅ Twitch API for "${login}" → isLive: ${isLive}`);
  return {
    isLive,
    title: stream.title || '',
    viewers: stream.viewer_count || 0,
    url: channelUrl,
  };
}

// ─── YouTube ─────────────────────────────────────────────────────────────────

// Daily quota tracking for YouTube search.list (100 units per call)
const YT_DAILY_QUOTA_LIMIT = parseInt(process.env.YOUTUBE_DAILY_QUOTA_LIMIT) || 100;
let _ytDailySearchCount = 0;
let _ytDailyResetDate = new Date().toDateString();

function _checkAndIncrementYtQuota() {
  const today = new Date().toDateString();
  if (today !== _ytDailyResetDate) {
    _ytDailySearchCount = 0;
    _ytDailyResetDate = today;
  }
  if (_ytDailySearchCount >= YT_DAILY_QUOTA_LIMIT) {
    return false; // over budget
  }
  _ytDailySearchCount++;
  return true;
}

function getYtQuotaStatus() {
  const today = new Date().toDateString();
  if (today !== _ytDailyResetDate) return { used: 0, limit: YT_DAILY_QUOTA_LIMIT };
  return { used: _ytDailySearchCount, limit: YT_DAILY_QUOTA_LIMIT };
}

// Cache resolved channel IDs permanently in memory (handle → channelId)
const _ytChannelIdCache = new Map();

/**
 * Extract YouTube channel ID or handle from a URL or raw input.
 */
function parseYouTubeInput(input) {
  const idMatch = input.match(/(?:youtube\.com\/channel\/|^)(UC[\w-]{22})/);
  if (idMatch) return { type: 'id', value: idMatch[1] };

  const handleMatch = input.match(/(?:youtube\.com\/)?@([\w.-]+)/);
  if (handleMatch) return { type: 'handle', value: handleMatch[1] };

  const customMatch = input.match(/youtube\.com\/c\/([\w.-]+)/i);
  if (customMatch) return { type: 'custom', value: customMatch[1] };

  return { type: 'handle', value: input.replace(/^@/, '').trim() };
}

/**
 * Resolve a YouTube handle to a channel ID (with in-memory cache).
 * Costs 1 API unit on first call, then free from cache.
 */
async function resolveYouTubeChannelId(handle, apiKey) {
  if (_ytChannelIdCache.has(handle)) return _ytChannelIdCache.get(handle);

  const url = `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`;
  const data = await fetchJson(url);
  if (data?.items?.[0]?.id) {
    _ytChannelIdCache.set(handle, data.items[0].id);
    return data.items[0].id;
  }
  return null;
}

/**
 * Fetch concurrent viewer count for a live YouTube video.
 * Uses videos.list API (1 quota unit per call).
 */
async function _getYouTubeViewerCount(videoId, apiKey) {
  if (!videoId || !apiKey) return 0;
  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}&key=${apiKey}`;
    const data = await fetchJson(url);
    const viewers = data?.items?.[0]?.liveStreamingDetails?.concurrentViewers;
    return viewers ? parseInt(viewers, 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * Check if a YouTube channel is currently live.
 *
 * Strategy (API-only):
 *  1. channels.list to resolve handle → channel ID (1 unit, cached)
 *  2. search.list to check live status (100 units)
 *  3. videos.list for viewer count (1 unit)
 *
 * If YOUTUBE_API_KEY is not set, returns isLive:false with error flag.
 */
async function checkYouTube(handleOrUrl, platform = 'youtube') {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const parsed = parseYouTubeInput(handleOrUrl);
  const handle = parsed.type === 'handle' || parsed.type === 'custom' ? parsed.value : null;

  if (!apiKey) {
    console.warn('⚠️ YOUTUBE_API_KEY not set — cannot check YouTube live status');
    return { isLive: false, title: '', viewers: 0, url: handleOrUrl, error: true };
  }

  let channelId = parsed.type === 'id' ? parsed.value : await resolveYouTubeChannelId(parsed.value, apiKey);

  if (!channelId) {
    return { isLive: false, title: '', viewers: 0, url: handleOrUrl, error: true };
  }

  if (!_checkAndIncrementYtQuota()) {
    console.warn(`⚠️ YouTube daily quota reached (${YT_DAILY_QUOTA_LIMIT} search calls) — skipping API check`);
    return { isLive: false, title: '', viewers: 0, url: `https://youtube.com/channel/${channelId}`, error: true };
  }

  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${apiKey}`;
  const data = await fetchJson(searchUrl);

  if (!data) {
    console.warn(`⚠️ YouTube API request failed for "${channelId}" — network error`);
    return { isLive: false, title: '', viewers: 0, url: `https://youtube.com/channel/${channelId}`, error: true };
  }

  if (!data.items?.length) {
    console.log(`✅ YouTube API for "${channelId}" → isLive: false`);
    return { isLive: false, title: '', viewers: 0, url: `https://youtube.com/channel/${channelId}` };
  }

  const live = data.items[0];
  const videoId = live.id?.videoId || '';
  const viewers = videoId ? await _getYouTubeViewerCount(videoId, apiKey) : 0;

  console.log(`✅ YouTube API for "${channelId}" → isLive: true${viewers ? `, viewers: ${viewers}` : ''}`);
  return {
    isLive: true,
    title: live.snippet?.title || '',
    viewers,
    url: handle ? `https://youtube.com/@${handle}/live` : (videoId ? `https://youtube.com/watch?v=${videoId}` : `https://youtube.com/channel/${channelId}`),
  };
}

// ─── Unified checker ─────────────────────────────────────────────────────────

const PLATFORM_CHECKERS = {
  kick: (handle) => checkKick(handle),
  twitch: (handle) => checkTwitch(handle),
  youtube: (handle) => checkYouTube(handle, 'youtube'),
  'youtube-shorts': (handle) => checkYouTube(handle, 'youtube-shorts'),
  // Link-only platforms — no live detection API available
  tiktok: null,
  instagram: null,
  facebook: null,
};

const PLATFORMS = {
  kick: { label: 'Kick', emoji: '🟢', color: 0x53FC18, canDetectLive: true },
  twitch: { label: 'Twitch', emoji: '🟣', color: 0x9146FF, canDetectLive: true },
  youtube: { label: 'YouTube', emoji: '🔴', color: 0xFF0000, canDetectLive: true },
  'youtube-shorts': { label: 'YouTube Shorts', emoji: '📱', color: 0xFF0000, canDetectLive: true },
  tiktok: { label: 'TikTok', emoji: '🎵', color: 0x000000, canDetectLive: false },
  instagram: { label: 'Instagram', emoji: '📸', color: 0xE1306C, canDetectLive: false },
  facebook: { label: 'Facebook Gaming', emoji: '🎮', color: 0x1877F2, canDetectLive: false },
};

/**
 * Check all registered platforms for a user.
 * Returns results for ALL platforms (live and offline), each with its stored URL.
 */
async function checkAllPlatforms(links) {
  const results = await Promise.allSettled(
    links.map(async (link) => {
      const checker = PLATFORM_CHECKERS[link.platform];
      const meta = PLATFORMS[link.platform] || { label: link.platform, emoji: '📺', color: 0x808080 };

      if (!checker) {
        return { platform: link.platform, ...meta, isLive: false, title: '', viewers: 0, url: link.platform_url };
      }

      const result = await checker(link.platform_handle || link.platform_url);

      return {
        platform: link.platform,
        label: meta.label,
        emoji: meta.emoji,
        color: meta.color,
        isLive: result.isLive,
        title: result.title,
        viewers: result.viewers,
        // Always use the stored platform_url for the channel link
        url: link.platform_url,
        // If live, also store the specific live stream URL (e.g. YouTube watch link)
        liveUrl: result.isLive ? result.url : link.platform_url,
      };
    })
  );

  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
}

// ─── Platform result cache ─────────────────────────────────────────────────
// Prevents redundant API/scrape calls within a short window.
// All consumers get consistent data from the same check cycle.

const _platformCache = new Map(); // key: guildId, value: { results, timestamp }
const PLATFORM_CACHE_TTL = 60000; // 60 seconds

/**
 * Cached version of checkAllPlatforms.
 * Returns cached results if within TTL, otherwise fetches fresh.
 * @param {Array} links - Streaming links from DB
 * @param {string} guildId - Guild ID for cache key
 * @returns {Promise<Array>}
 */
async function checkAllPlatformsCached(links, guildId) {
  const cached = _platformCache.get(guildId);
  if (cached && Date.now() - cached.timestamp < PLATFORM_CACHE_TTL) {
    return cached.results;
  }
  const results = await checkAllPlatforms(links);
  _platformCache.set(guildId, { results, timestamp: Date.now() });
  return results;
}

/** Invalidate the cache for a guild (e.g. after manual /go-live) */
function invalidatePlatformCache(guildId) {
  _platformCache.delete(guildId);
}

module.exports = {
  checkKick,
  checkTwitch,
  checkYouTube,
  checkAllPlatforms,
  checkAllPlatformsCached,
  invalidatePlatformCache,
  getYtQuotaStatus,
  PLATFORMS,
  PLATFORM_CHECKERS,
  extractKickSlug,
  extractTwitchLogin,
  parseYouTubeInput,
};
