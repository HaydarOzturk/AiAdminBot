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

/**
 * Check if a Kick channel is live.
 */
async function checkKick(handleOrUrl) {
  const slug = extractKickSlug(handleOrUrl);
  const apiUrl = `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`;
  const data = await fetchJson(apiUrl);

  if (!data) {
    return { isLive: false, title: '', viewers: 0, url: `https://kick.com/${slug}` };
  }

  return {
    isLive: !!(data.livestream && data.livestream.is_live),
    title: data.livestream?.session_title || '',
    viewers: data.livestream?.viewer_count || 0,
    url: `https://kick.com/${slug}`,
  };
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
    return { isLive: false, title: '', viewers: 0, url: channelUrl };
  }

  const apiUrl = `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`;
  const data = await fetchJson(apiUrl, {
    'Client-ID': process.env.TWITCH_CLIENT_ID,
    'Authorization': `Bearer ${token}`,
  });

  if (!data?.data?.length) {
    return { isLive: false, title: '', viewers: 0, url: channelUrl };
  }

  const stream = data.data[0];
  return {
    isLive: stream.type === 'live',
    title: stream.title || '',
    viewers: stream.viewer_count || 0,
    url: channelUrl,
  };
}

// ─── YouTube ─────────────────────────────────────────────────────────────────

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
 * Resolve a YouTube handle to a channel ID.
 */
async function resolveYouTubeChannelId(handle, apiKey) {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`;
  const data = await fetchJson(url);
  if (data?.items?.[0]?.id) return data.items[0].id;
  return null;
}

/**
 * Check if a YouTube channel is currently live.
 */
async function checkYouTube(handleOrUrl, platform = 'youtube') {
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    console.warn('⚠️ YOUTUBE_API_KEY not set — skipping YouTube live check');
    return { isLive: false, title: '', viewers: 0, url: handleOrUrl };
  }

  const parsed = parseYouTubeInput(handleOrUrl);
  let channelId = parsed.type === 'id' ? parsed.value : await resolveYouTubeChannelId(parsed.value, apiKey);

  if (!channelId) {
    return { isLive: false, title: '', viewers: 0, url: handleOrUrl };
  }

  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${apiKey}`;
  const data = await fetchJson(searchUrl);

  if (!data?.items?.length) {
    return { isLive: false, title: '', viewers: 0, url: `https://youtube.com/channel/${channelId}` };
  }

  const live = data.items[0];
  const videoId = live.id?.videoId || '';

  return {
    isLive: true,
    title: live.snippet?.title || '',
    viewers: 0,
    url: videoId ? `https://youtube.com/watch?v=${videoId}` : `https://youtube.com/channel/${channelId}`,
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

module.exports = {
  checkKick,
  checkTwitch,
  checkYouTube,
  checkAllPlatforms,
  PLATFORMS,
  PLATFORM_CHECKERS,
  extractKickSlug,
  extractTwitchLogin,
  parseYouTubeInput,
};
