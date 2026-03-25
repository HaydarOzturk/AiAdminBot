/**
 * Streaming Checker — Detects live status on external platforms.
 *
 * Supported platforms:
 *   - kick       → Kick.com (public API v2)
 *   - youtube    → YouTube horizontal (Data API v3)
 *   - youtube-shorts → YouTube Shorts / vertical (same API, separate link)
 *
 * Each checker returns: { isLive, title, viewers, url }
 * All checkers are non-throwing — they return isLive:false on error.
 */

const https = require('https');

// ─── Generic HTTPS JSON fetch ────────────────────────────────────────────────

/**
 * Simple HTTPS GET that returns parsed JSON. Times out after `ms` ms.
 * @param {string} url
 * @param {number} [ms=6000]
 * @returns {Promise<object|null>}
 */
function fetchJson(url, ms = 6000) {
  return new Promise(resolve => {
    const req = https.get(url, { timeout: ms, headers: { 'User-Agent': 'AiAdminBot/1.0' } }, res => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ─── Kick ────────────────────────────────────────────────────────────────────

/**
 * Extract the Kick channel slug from a URL or handle.
 * Accepts: "username", "kick.com/username", "https://kick.com/username"
 * @param {string} input
 * @returns {string}
 */
function extractKickSlug(input) {
  // Strip URL parts if present
  const match = input.match(/kick\.com\/([^/?#]+)/i);
  if (match) return match[1].toLowerCase();
  // Assume it's a raw handle
  return input.replace(/^@/, '').trim().toLowerCase();
}

/**
 * Check if a Kick channel is live.
 * Uses the public v2 API: https://kick.com/api/v2/channels/{slug}
 * @param {string} handleOrUrl — Kick username or full URL
 * @returns {Promise<{ isLive: boolean, title: string, viewers: number, url: string }>}
 */
async function checkKick(handleOrUrl) {
  const slug = extractKickSlug(handleOrUrl);
  const apiUrl = `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`;

  const data = await fetchJson(apiUrl);

  if (!data) {
    return { isLive: false, title: '', viewers: 0, url: `https://kick.com/${slug}` };
  }

  const isLive = !!(data.livestream && data.livestream.is_live);
  const title = data.livestream?.session_title || '';
  const viewers = data.livestream?.viewer_count || 0;

  return {
    isLive,
    title,
    viewers,
    url: `https://kick.com/${slug}`,
  };
}

// ─── YouTube ─────────────────────────────────────────────────────────────────

/**
 * Extract YouTube channel ID or handle from a URL or raw input.
 * Accepts many forms:
 *   - "UCxxxxxx" (channel ID)
 *   - "@handle"
 *   - "youtube.com/channel/UCxxxxxx"
 *   - "youtube.com/@handle"
 *   - "youtube.com/c/CustomName"
 * @param {string} input
 * @returns {{ type: 'id'|'handle'|'custom', value: string }}
 */
function parseYouTubeInput(input) {
  // Channel ID pattern
  const idMatch = input.match(/(?:youtube\.com\/channel\/|^)(UC[\w-]{22})/);
  if (idMatch) return { type: 'id', value: idMatch[1] };

  // Handle pattern: @handle in URL or raw
  const handleMatch = input.match(/(?:youtube\.com\/)?@([\w.-]+)/);
  if (handleMatch) return { type: 'handle', value: handleMatch[1] };

  // Custom URL: /c/Name
  const customMatch = input.match(/youtube\.com\/c\/([\w.-]+)/i);
  if (customMatch) return { type: 'custom', value: customMatch[1] };

  // Fallback — treat as handle
  return { type: 'handle', value: input.replace(/^@/, '').trim() };
}

/**
 * Resolve a YouTube handle/custom name to a channel ID using the API.
 * @param {string} handle
 * @param {string} apiKey
 * @returns {Promise<string|null>}
 */
async function resolveYouTubeChannelId(handle, apiKey) {
  // Try the channels endpoint with forHandle (costs 1 quota unit)
  const url = `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`;
  const data = await fetchJson(url);
  if (data?.items?.[0]?.id) return data.items[0].id;
  return null;
}

/**
 * Check if a YouTube channel is currently live streaming.
 * Uses the search endpoint with eventType=live (costs 100 quota units).
 * @param {string} handleOrUrl — YouTube channel URL, handle, or channel ID
 * @param {'youtube'|'youtube-shorts'} [platform='youtube']
 * @returns {Promise<{ isLive: boolean, title: string, viewers: number, url: string }>}
 */
async function checkYouTube(handleOrUrl, platform = 'youtube') {
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    console.warn('⚠️ YOUTUBE_API_KEY not set — skipping YouTube live check');
    return { isLive: false, title: '', viewers: 0, url: handleOrUrl };
  }

  const parsed = parseYouTubeInput(handleOrUrl);

  let channelId = null;
  if (parsed.type === 'id') {
    channelId = parsed.value;
  } else {
    channelId = await resolveYouTubeChannelId(parsed.value, apiKey);
  }

  if (!channelId) {
    return { isLive: false, title: '', viewers: 0, url: handleOrUrl };
  }

  // Search for active live broadcasts on this channel (100 quota units)
  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${apiKey}`;
  const data = await fetchJson(searchUrl);

  if (!data?.items?.length) {
    return { isLive: false, title: '', viewers: 0, url: `https://youtube.com/channel/${channelId}` };
  }

  const live = data.items[0];
  const videoId = live.id?.videoId || '';
  const title = live.snippet?.title || '';
  const channelUrl = platform === 'youtube-shorts'
    ? `https://youtube.com/channel/${channelId}/shorts`
    : `https://youtube.com/channel/${channelId}`;

  return {
    isLive: true,
    title,
    viewers: 0, // Search endpoint doesn't return viewer count
    url: videoId ? `https://youtube.com/watch?v=${videoId}` : channelUrl,
  };
}

// ─── Unified checker ─────────────────────────────────────────────────────────

/**
 * Platform checker registry. Add new platforms here.
 */
const PLATFORM_CHECKERS = {
  kick: (handle) => checkKick(handle),
  youtube: (handle) => checkYouTube(handle, 'youtube'),
  'youtube-shorts': (handle) => checkYouTube(handle, 'youtube-shorts'),
};

/**
 * Supported platform metadata (for UI display).
 */
const PLATFORMS = {
  kick: { label: 'Kick', emoji: '🟢', color: 0x53FC18 },
  youtube: { label: 'YouTube', emoji: '🔴', color: 0xFF0000 },
  'youtube-shorts': { label: 'YouTube Shorts', emoji: '📱', color: 0xFF0000 },
};

/**
 * Check all registered platforms for a user in a guild.
 * @param {Array<{ platform: string, platform_handle: string, platform_url: string }>} links
 * @returns {Promise<Array<{ platform: string, label: string, emoji: string, isLive: boolean, title: string, viewers: number, url: string }>>}
 */
async function checkAllPlatforms(links) {
  const results = await Promise.allSettled(
    links.map(async (link) => {
      const checker = PLATFORM_CHECKERS[link.platform];
      if (!checker) {
        return { platform: link.platform, ...PLATFORMS[link.platform], isLive: false, title: '', viewers: 0, url: link.platform_url };
      }

      const result = await checker(link.platform_handle || link.platform_url);
      const meta = PLATFORMS[link.platform] || { label: link.platform, emoji: '📺', color: 0x808080 };

      return {
        platform: link.platform,
        label: meta.label,
        emoji: meta.emoji,
        color: meta.color,
        ...result,
      };
    })
  );

  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
}

module.exports = {
  checkKick,
  checkYouTube,
  checkAllPlatforms,
  PLATFORMS,
  PLATFORM_CHECKERS,
  extractKickSlug,
  parseYouTubeInput,
};
