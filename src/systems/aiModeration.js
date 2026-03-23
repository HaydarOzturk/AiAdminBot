const { chat, moderateContent, isConfigured } = require('../utils/openrouter');
const { createEmbed } = require('../utils/embedBuilder');
const { sendModLog, logModAction } = require('../utils/modLogger');
const { t, channelName } = require('../utils/locale');
const { loadConfig } = require('../utils/paths');
const { fetchRules } = require('./rulesReader');
const db = require('../utils/database');

const CONFIDENCE_THRESHOLD = parseFloat(process.env.AI_MOD_CONFIDENCE_THRESHOLD) || 0.8;

// Cache recent checks to avoid re-checking edits (messageId -> result)
const recentChecks = new Map();
const CACHE_TTL = 300000; // 5 minutes

// ── Keyword pre-filter ──────────────────────────────────────────────────────
// Merges a built-in default list with per-guild custom words from the DB.
// Also supports config/moderation.json for global overrides.

// Default list — covers common Turkish and English slurs/profanity
const DEFAULT_BLOCKED = [
  // Turkish
  'orospu', 'piç', 'siktir', 'amına', 'amina', 'yarrak', 'göt', 'got',
  'sikerim', 'sikeyim', 'ananı', 'anani', 'pezevenk', 'gavat', 'ibne',
  'döl', 'kaltak', 'fahişe', 'fahise', 'köpek herif',
  // English
  'nigger', 'nigga', 'faggot', 'retard', 'cunt',
];

// Per-guild cache: guildId -> Set<string>
const _guildCache = new Map();
const GUILD_CACHE_TTL = 600000; // 10 minutes

/**
 * Load config-based overrides (once)
 */
let _configWords = null;
function getConfigWords() {
  if (_configWords !== null) return _configWords;
  try {
    const modConfig = loadConfig('moderation.json');
    if (modConfig.blockedWords && Array.isArray(modConfig.blockedWords)) {
      _configWords = modConfig.blockedWords.map(w => w.toLowerCase());
      return _configWords;
    }
  } catch { /* file not found */ }
  _configWords = [];
  return _configWords;
}

/**
 * Get the full blocked word set for a guild:
 *   defaults + config/moderation.json + DB per-guild words
 */
function getBlockedWordsForGuild(guildId) {
  if (_guildCache.has(guildId)) return _guildCache.get(guildId);

  const words = new Set([
    ...DEFAULT_BLOCKED,
    ...getConfigWords(),
  ]);

  // Load per-guild words from DB
  try {
    const rows = db.all(
      'SELECT word FROM blocked_words WHERE guild_id = ?',
      [guildId]
    );
    for (const row of rows) {
      words.add(row.word.toLowerCase());
    }
  } catch { /* DB not ready yet */ }

  _guildCache.set(guildId, words);
  setTimeout(() => _guildCache.delete(guildId), GUILD_CACHE_TTL);

  return words;
}

/**
 * Clear cached blocklist for a guild (called when /blocklist add/remove runs)
 */
function clearGuildCache(guildId) {
  _guildCache.delete(guildId);
}

/**
 * Fast keyword check — catches obvious slurs without needing AI.
 * Returns a moderation result if a blocked word is found, null otherwise.
 */
function keywordCheck(content, guildId) {
  const lower = content.toLowerCase();
  // Normalize Turkish special chars for bypass attempts
  const normalized = lower
    .replace(/1/g, 'i').replace(/3/g, 'e').replace(/0/g, 'o')
    .replace(/\$/g, 's').replace(/@/g, 'a').replace(/!/g, 'i');

  const blocked = getBlockedWordsForGuild(guildId);

  for (const word of blocked) {
    if (lower.includes(word) || normalized.includes(word)) {
      return {
        flagged: true,
        category: 'toxicity',
        confidence: 0.95,
        reason: `Blocked word detected`,
      };
    }
  }
  return null;
}

/**
 * Build moderation prompt with optional server rules context
 * @param {string|null} rulesText
 * @returns {string}
 */
function buildModerationPrompt(rulesText) {
  let prompt = `You are a Discord server content moderator for a gaming community. You MUST detect violations in ALL languages, especially Turkish and English.

Categories:
- toxicity: Insults, slurs, harassment, hate speech, personal attacks, swearing AT someone
- spam: Repetitive messages, excessive caps, gibberish, advertisement links
- nsfw: Sexual or explicit content, sexual slurs
- threat: Threats of violence or harm
- rules: Message violates a specific server rule (only if server rules are provided below)
- none: Message is clean

Turkish profanity examples that MUST be flagged as toxicity:
- "orospu" and any variation (orosbu, 0rospu, etc.) — severe slur
- "siktir", "sikerim", "sikeyim" — vulgar insults
- "amına", "amina koyayım" — vulgar insults
- "piç", "pezevenk", "gavat", "ibne" — slurs
- "ananı", "anani" — maternal insults
- Combining slurs with usernames (e.g. "orospu [name]") — personal attack, HIGH confidence`;

  if (rulesText) {
    prompt += `

=== SERVER RULES ===
The following are the server's official rules. Messages that CLEARLY violate these rules should be flagged with category "rules".
Only flag if the violation is obvious — don't flag borderline cases.

${rulesText}
=== END RULES ===`;
  }

  prompt += `

Respond in EXACTLY this JSON format, nothing else:
{"flagged": true/false, "category": "category_name", "confidence": 0.0-1.0, "reason": "brief explanation"}

Rules:
- Flag Turkish profanity with confidence >= 0.9
- Normal gaming talk, slang, abbreviations (gg, wp, ez) = NOT flagged
- Friendly casual language and banter = NOT flagged
- When in doubt about Turkish words, flag with lower confidence (0.6-0.7)
- For server rule violations, use confidence 0.7-0.9 depending on how clear the violation is`;

  return prompt;
}

/**
 * Run AI moderation with server rules context
 * @param {string} content - Message to check
 * @param {import('discord.js').Guild} guild - The guild (for fetching rules)
 * @returns {Promise<{flagged: boolean, category: string, confidence: number, reason: string}>}
 */
async function moderateWithRules(content, guild) {
  if (!isConfigured()) {
    return { flagged: false, category: 'none', confidence: 0, reason: 'AI not configured' };
  }

  // Fetch rules (cached)
  let rulesText = null;
  try {
    rulesText = await fetchRules(guild);
  } catch { /* rules not available */ }

  const systemPrompt = buildModerationPrompt(rulesText);

  try {
    const result = await chat(
      [{ role: 'user', content: `Analyze this message:\n"${content}"` }],
      {
        systemPrompt,
        maxTokens: 256,
        temperature: 0.1,
      }
    );

    // Parse JSON from response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { flagged: false, category: 'none', confidence: 0, reason: 'Failed to parse AI response' };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      flagged: !!parsed.flagged,
      category: parsed.category || 'none',
      confidence: parseFloat(parsed.confidence) || 0,
      reason: parsed.reason || '',
    };
  } catch (err) {
    console.error('AI moderation error:', err.message);
    return { flagged: false, category: 'none', confidence: 0, reason: 'AI error: ' + err.message };
  }
}

/**
 * Check a message for content violations using keyword filter + AI
 * @param {import('discord.js').Message} message
 * @returns {Promise<void>}
 */
async function checkMessage(message) {
  if (process.env.AI_MODERATION_ENABLED !== 'true') return;

  // Don't moderate bots or DMs
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!message.content || message.content.trim().length === 0) return;

  // Don't moderate staff
  const { getPermissionLevel } = require('../utils/permissions');
  const member = await message.guild.members.fetch(message.author.id).catch(() => null);
  if (member && getPermissionLevel(member) >= 2) return; // Moderator+ exempt

  // Check cache
  if (recentChecks.has(message.id)) return;

  try {
    // Phase 1: Fast keyword pre-filter (works even without AI configured)
    let result = keywordCheck(message.content, message.guild.id);

    // Phase 2: AI moderation with server rules context
    if (!result && isConfigured() && message.content.length >= 5) {
      result = await moderateWithRules(message.content, message.guild);
    }

    if (!result) return;

    // Cache the result
    recentChecks.set(message.id, result);
    setTimeout(() => recentChecks.delete(message.id), CACHE_TTL);

    if (!result.flagged) return;
    if (result.confidence < CONFIDENCE_THRESHOLD) return;

    // ── Take action based on category ────────────────────────────────────

    console.log(`🤖 AI flagged message from ${message.author.tag}: [${result.category}] ${result.reason} (${Math.round(result.confidence * 100)}%)`);

    // Log to punishment channel
    const guild = message.guild;
    const botUser = guild.members.me.user;

    const caseId = logModAction(
      'ai-flag',
      message.author.id,
      guild.id,
      botUser.id,
      `[AI ${result.category}] ${result.reason}`
    );

    // Build log embed
    const embed = createEmbed({
      title: t('moderation.aiWarningTitle'),
      color: result.category === 'threat' ? 'danger' : 'orange',
      fields: [
        { name: t('moderation.user'), value: `${message.author.tag}\n<@${message.author.id}>`, inline: true },
        { name: t('moderation.channel'), value: `<#${message.channel.id}>`, inline: true },
        { name: t('moderation.category'), value: categoryLabel(result.category), inline: true },
        { name: t('moderation.confidence'), value: `${Math.round(result.confidence * 100)}%`, inline: true },
        { name: t('moderation.reason'), value: result.reason || '-', inline: false },
        { name: t('moderation.message'), value: message.content.length > 512 ? message.content.slice(0, 509) + '...' : message.content, inline: false },
        { name: t('moderation.caseId'), value: `#${caseId}`, inline: true },
      ],
      timestamp: true,
    });

    // Send to punishment log
    const logChannelName = channelName('punishment-log');
    const logChannel = guild.channels.cache.find(c => c.name === logChannelName && c.isTextBased());
    if (logChannel) {
      await logChannel.send({ embeds: [embed] });
    }

    // For high-confidence toxic/threat content, also add a warning to DB
    if (result.confidence >= 0.9 && (result.category === 'toxicity' || result.category === 'threat')) {
      db.run(
        'INSERT INTO warnings (user_id, guild_id, moderator_id, reason) VALUES (?, ?, ?, ?)',
        [message.author.id, guild.id, botUser.id, t('moderation.aiAutoWarningReason', { reason: result.reason })]
      );

      // Reply to the user with a warning
      try {
        await message.reply({
          content: t('moderation.aiAutoWarning', { category: categoryLabel(result.category) }),
        });
      } catch {
        // Message might have been deleted
      }
    }

    // For rule violations, just warn — don't auto-punish
    if (result.category === 'rules' && result.confidence >= 0.8) {
      try {
        await message.reply({
          content: t('moderation.rulesViolationWarning', { reason: result.reason }),
        });
      } catch {
        // Message might have been deleted
      }
    }

    // For spam, delete the message
    if (result.category === 'spam' && result.confidence >= 0.9) {
      try {
        await message.delete();
      } catch {
        // Might not have permission
      }
    }
  } catch (err) {
    console.error('AI moderation check failed:', err.message);
  }
}

/**
 * Human-readable category labels
 */
function categoryLabel(category) {
  const labels = {
    toxicity: t('moderation.categories.toxicity'),
    spam: t('moderation.categories.spam'),
    nsfw: t('moderation.categories.nsfw'),
    threat: t('moderation.categories.threat'),
    rules: t('moderation.categories.rules'),
    none: t('moderation.categories.clean'),
  };
  return labels[category] || category;
}

module.exports = { checkMessage, clearGuildCache };
