/**
 * Per-Channel AI Assist — Smart detection + intent-based responses.
 *
 * Each channel can have AI activated with a specific intent (help, moderation,
 * registration, games). The bot monitors messages and only responds when
 * smart detection determines the message is relevant to the channel's intent.
 */

const { chat: aiChat, isConfigured: aiIsConfigured } = require('../utils/openrouter');
const { buildGuildContext, getGuildMemories } = require('./aiChat');
const db = require('../utils/database');

// ── Intent Registry ──────────────────────────────────────────────────────

const INTENTS = [
  {
    id: 'help-support',
    name: 'Help & Support',
    description: 'Answers questions and provides help. Responds to question marks, help requests, and confusion.',
    responseStyle: 'helpful',
    systemPromptTemplate: `You are a helpful support assistant in the #{channelName} channel of the "#{serverName}" Discord server.
Your job is to answer questions, help with problems, and guide users.
Channel topic: #{channelTopic}
#{customPrompt}

Guidelines:
- Only answer when someone clearly asks a question or needs help
- Be concise and accurate
- If you don't know, say so and suggest asking a moderator
- Respond in the same language the user writes in
- Keep responses under 1500 characters`,
    triggerPatterns: {
      questionMarks: true,
      questionWords: ['how', 'what', 'why', 'where', 'when', 'who', 'which', 'can', 'does', 'is there',
                      'nasıl', 'ne', 'neden', 'nerede', 'ne zaman', 'kim', 'hangi', 'yapabilir mi',
                      'wie', 'was', 'warum', 'wo', 'wann', 'wer', 'cómo', 'qué', 'por qué',
                      'comment', 'quoi', 'pourquoi', 'como', 'что', 'как', 'почему'],
      helpKeywords: ['help', 'yardım', 'hilfe', 'ayuda', 'aide', 'ajuda',
                     'how to', 'nasıl yapılır', 'how do i', 'how can i',
                     'stuck', 'problem', 'issue', 'sorun', 'hata', 'error'],
      mentionsBot: true,
    },
  },
  {
    id: 'moderation',
    name: 'Moderation Assist',
    description: 'Watches for rule violations and reminds users. Stricter tone.',
    responseStyle: 'strict',
    systemPromptTemplate: `You are a moderation assistant in the #{channelName} channel of "#{serverName}".
Your role is to remind users about rules when they are violated, de-escalate conflicts, and maintain order.
Channel topic: #{channelTopic}
#{customPrompt}

#{serverRules}

Guidelines:
- Only speak up when you detect a potential rule violation or conflict
- Be firm but fair — cite the specific rule being broken
- Do NOT take mod actions yourself — just warn and remind
- If things escalate, suggest the user contact a moderator
- Respond in the same language the user writes in
- Keep responses under 1000 characters`,
    triggerPatterns: {
      toxicityKeywords: ['shut up', 'stfu', 'kapa çeneni', 'sus', 'idiot', 'stupid', 'aptal',
                         'fight me', 'ban', 'reported', 'salak', 'mal', 'gerizekalı'],
      capsLockRatio: 0.7,
      mentionSpam: 4,
      mentionsBot: true,
    },
  },
  {
    id: 'registration',
    name: 'Registration Guide',
    description: 'Guides new users through verification and onboarding. Responds to greetings and confusion.',
    responseStyle: 'welcoming',
    systemPromptTemplate: `You are a friendly guide in the #{channelName} registration/welcome channel of "#{serverName}".
Your job is to greet newcomers and help them through the verification process.
Channel topic: #{channelTopic}
#{customPrompt}

Guidelines:
- When someone says hello or seems new, welcome them warmly
- Explain the verification steps (usually /verify command or click the verify button)
- Point them to important channels like rules, roles, and introductions
- Be enthusiastic and make them feel welcome
- Respond in the same language the user writes in
- Keep responses under 1200 characters`,
    triggerPatterns: {
      greetings: ['hello', 'hi', 'hey', 'merhaba', 'selam', 'sa', 'slm', 'hallo', 'hola', 'bonjour',
                  'good morning', 'good evening', 'günaydın', 'iyi akşamlar',
                  'new here', 'just joined', 'yeni geldim', 'yeniyim', 'burdayım'],
      confusionKeywords: ['what do i do', 'ne yapmalıyım', 'how do i start', 'nereden başlayacağım',
                          'verify', 'doğrulama', 'kayıt', 'register', 'role', 'rol', 'nasıl girerim'],
      mentionsBot: true,
    },
  },
  {
    id: 'mini-games',
    name: 'Mini Games & Fun',
    description: 'Plays trivia, word games, and fun activities. Responds to game triggers.',
    responseStyle: 'playful',
    systemPromptTemplate: `You are a fun game master in the #{channelName} channel of "#{serverName}".
You run trivia, word games, riddles, and fun activities.
Channel topic: #{channelTopic}
#{customPrompt}

Available games you can run:
- Trivia: Ask a multiple-choice or open question. Wait for answers. Reveal the correct one.
- Word Game: Give a word, users must make a new word from the last letter.
- Riddle: Post a riddle, let users guess.
- Would You Rather: Post two choices.
- Fun Fact: Share an interesting fact.

Guidelines:
- When someone says "play", "game", "trivia", "quiz", "riddle" — start a game
- Keep it fun and energetic, use emojis
- Respond in the same language the user writes in
- Keep responses under 1500 characters`,
    triggerPatterns: {
      gameKeywords: ['play', 'game', 'trivia', 'quiz', 'riddle', 'oyna', 'oyun', 'bilmece',
                     'would you rather', 'fun fact', 'challenge', 'meydan okuma',
                     'spiel', 'juego', 'jeu', 'soru', 'question'],
      mentionsBot: true,
    },
  },
];

function getIntents() {
  return INTENTS.map(i => ({ id: i.id, name: i.name, description: i.description, responseStyle: i.responseStyle }));
}

function getIntentById(id) {
  return INTENTS.find(i => i.id === id);
}

// ── Config Cache ─────────────────────────────────────────────────────────

const configCache = new Map(); // channelId → { config, cachedAt }
const CONFIG_CACHE_TTL = 60000; // 60 seconds

function getChannelConfig(guildId, channelId) {
  const cached = configCache.get(channelId);
  if (cached && Date.now() - cached.cachedAt < CONFIG_CACHE_TTL) {
    return cached.config;
  }

  const config = db.get(
    'SELECT * FROM channel_ai_config WHERE guild_id = ? AND channel_id = ?',
    [guildId, channelId]
  );

  configCache.set(channelId, { config: config || null, cachedAt: Date.now() });
  return config || null;
}

function clearConfigCache(channelId) {
  if (channelId) {
    configCache.delete(channelId);
  } else {
    configCache.clear();
  }
}

function getAllConfigs(guildId) {
  return db.all('SELECT * FROM channel_ai_config WHERE guild_id = ?', [guildId]);
}

function upsertConfig(guildId, channelId, { enabled, intent, customPrompt, autoDetectIntent, responseCooldown }) {
  db.run(`
    INSERT INTO channel_ai_config (guild_id, channel_id, enabled, intent, custom_prompt, auto_detect_intent, response_cooldown)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, channel_id) DO UPDATE SET
      enabled = excluded.enabled,
      intent = excluded.intent,
      custom_prompt = excluded.custom_prompt,
      auto_detect_intent = excluded.auto_detect_intent,
      response_cooldown = excluded.response_cooldown,
      updated_at = CURRENT_TIMESTAMP
  `, [
    guildId, channelId,
    enabled ? 1 : 0,
    intent || 'help-support',
    customPrompt || null,
    autoDetectIntent != null ? (autoDetectIntent ? 1 : 0) : 1,
    responseCooldown || 30,
  ]);
  clearConfigCache(channelId);
}

// ── Response Cooldown ────────────────────────────────────────────────────

const cooldownMap = new Map(); // channelId → lastResponseTimestamp

function isOnCooldown(channelId, cooldownSeconds) {
  const last = cooldownMap.get(channelId);
  if (!last) return false;
  return (Date.now() - last) < cooldownSeconds * 1000;
}

function setCooldown(channelId) {
  cooldownMap.set(channelId, Date.now());
}

// ── Smart Detection ──────────────────────────────────────────────────────

function shouldRespond(message, intent, botId) {
  const content = message.content;
  const lower = content.toLowerCase().trim();
  let score = 0;

  // Direct bot mention — always respond
  if (intent.triggerPatterns.mentionsBot && message.mentions.has(botId)) {
    return 5;
  }

  // Question mark at end
  if (intent.triggerPatterns.questionMarks && content.trim().endsWith('?')) {
    score += 2;
  }

  // Question words
  if (intent.triggerPatterns.questionWords) {
    for (const word of intent.triggerPatterns.questionWords) {
      if (lower.startsWith(word + ' ') || lower.startsWith(word + ',') || lower === word) {
        score += 2;
        break;
      }
    }
  }

  // Help keywords
  if (intent.triggerPatterns.helpKeywords) {
    for (const kw of intent.triggerPatterns.helpKeywords) {
      if (lower.includes(kw)) { score += 2; break; }
    }
  }

  // Greetings (registration)
  if (intent.triggerPatterns.greetings) {
    for (const g of intent.triggerPatterns.greetings) {
      if (lower.startsWith(g) || lower === g) { score += 2; break; }
    }
  }

  // Confusion keywords (registration)
  if (intent.triggerPatterns.confusionKeywords) {
    for (const kw of intent.triggerPatterns.confusionKeywords) {
      if (lower.includes(kw)) { score += 2; break; }
    }
  }

  // Game keywords
  if (intent.triggerPatterns.gameKeywords) {
    for (const kw of intent.triggerPatterns.gameKeywords) {
      if (lower.includes(kw)) { score += 2; break; }
    }
  }

  // Toxicity keywords (moderation)
  if (intent.triggerPatterns.toxicityKeywords) {
    for (const kw of intent.triggerPatterns.toxicityKeywords) {
      if (lower.includes(kw)) { score += 2; break; }
    }
  }

  // Caps lock ratio (moderation)
  if (intent.triggerPatterns.capsLockRatio && content.length >= 20) {
    const upperCount = (content.match(/[A-Z]/g) || []).length;
    if (upperCount / content.length >= intent.triggerPatterns.capsLockRatio) {
      score += 2;
    }
  }

  // Mention spam (moderation)
  if (intent.triggerPatterns.mentionSpam) {
    if (message.mentions.users.size >= intent.triggerPatterns.mentionSpam) {
      score += 3;
    }
  }

  // Short messages (<3 words) capped — skip casual "lol", "ok", etc.
  if (content.split(/\s+/).length < 3 && intent.id !== 'registration') {
    score = Math.min(score, 1);
  }

  return score;
}

// ── Build Prompt ─────────────────────────────────────────────────────────

async function buildPrompt(intent, message, customPrompt) {
  const guild = message.guild;
  let prompt = intent.systemPromptTemplate;

  prompt = prompt.replace(/#{channelName}/g, message.channel.name);
  prompt = prompt.replace(/#{serverName}/g, guild.name);
  prompt = prompt.replace(/#{channelTopic}/g, message.channel.topic || 'No topic set');
  prompt = prompt.replace(/#{customPrompt}/g, customPrompt || '');

  // Server rules (for moderation intent)
  if (prompt.includes('#{serverRules}')) {
    try {
      const rulesChannel = guild.channels.cache.find(c =>
        c.isTextBased() && (c.name.includes('rule') || c.name.includes('kural'))
      );
      if (rulesChannel) {
        const msgs = await rulesChannel.messages.fetch({ limit: 5 });
        const rulesText = msgs.map(m => m.content || m.embeds?.[0]?.description || '').filter(Boolean).join('\n');
        prompt = prompt.replace(/#{serverRules}/g, rulesText ? `Server Rules:\n${rulesText}` : '');
      } else {
        prompt = prompt.replace(/#{serverRules}/g, '');
      }
    } catch {
      prompt = prompt.replace(/#{serverRules}/g, '');
    }
  }

  // Add lightweight guild context
  const memberCount = guild.memberCount;
  const roles = guild.roles.cache
    .filter(r => r.name !== '@everyone' && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map(r => r.name)
    .slice(0, 15)
    .join(', ');

  prompt += `\n\nServer info: ${guild.name} (${memberCount} members)`;
  prompt += `\nRoles: ${roles}`;

  // Add community memories
  try {
    const memories = getGuildMemories(guild.id);
    if (memories && memories.length > 0) {
      prompt += '\n\nCommunity knowledge:\n' + memories.map(m => `- ${m.value}`).join('\n');
    }
  } catch {}

  return prompt;
}

// ── Resolve Mentions ─────────────────────────────────────────────────────

function resolveMentions(message) {
  let content = message.content;
  for (const [, user] of message.mentions.users) {
    content = content.replace(new RegExp(`<@!?${user.id}>`, 'g'), `@${user.username}`);
  }
  for (const [, role] of message.mentions.roles) {
    content = content.replace(new RegExp(`<@&${role.id}>`, 'g'), `@${role.name}`);
  }
  for (const [, channel] of message.mentions.channels) {
    content = content.replace(new RegExp(`<#${channel.id}>`, 'g'), `#${channel.name}`);
  }
  return content;
}

// ── Main Handler ─────────────────────────────────────────────────────────

const RESPONSE_THRESHOLD = 2;

/**
 * Handle a message for per-channel AI.
 * Returns true if AI responded, false if skipped.
 */
async function handleChannelAi(message) {
  // Skip bots, system messages, DMs
  if (message.author.bot) return false;
  if (!message.guild) return false;
  if (!message.content) return false;

  // Check if AI is configured
  if (!aiIsConfigured()) return false;

  // Check channel config
  const config = getChannelConfig(message.guild.id, message.channel.id);
  if (!config || !config.enabled) return false;

  // Look up intent
  const intent = getIntentById(config.intent);
  if (!intent) return false;

  // Smart detection
  const score = shouldRespond(message, intent, message.client.user.id);
  if (score < RESPONSE_THRESHOLD) return false;

  // Cooldown check
  const cooldown = config.response_cooldown || 30;
  if (isOnCooldown(message.channel.id, cooldown)) return false;

  try {
    // Build prompt
    const systemPrompt = await buildPrompt(intent, message, config.custom_prompt);
    const resolvedContent = resolveMentions(message);

    // Call AI
    const response = await aiChat(
      [{ role: 'user', content: resolvedContent }],
      { systemPrompt, maxTokens: 1024, temperature: 0.7 }
    );

    if (!response || response.trim().length === 0) return false;

    // Split and send (Discord 2000 char limit)
    const chunks = [];
    let remaining = response;
    while (remaining.length > 0) {
      if (remaining.length <= 2000) {
        chunks.push(remaining);
        break;
      }
      const splitAt = remaining.lastIndexOf(' ', 2000);
      chunks.push(remaining.slice(0, splitAt > 0 ? splitAt : 2000));
      remaining = remaining.slice(splitAt > 0 ? splitAt + 1 : 2000);
    }

    for (const chunk of chunks) {
      await message.reply({ content: chunk, allowedMentions: { repliedUser: false } });
    }

    setCooldown(message.channel.id);
    return true;
  } catch (error) {
    console.error(`Channel AI error in #${message.channel.name}: ${error.message}`);
    return false;
  }
}

module.exports = {
  handleChannelAi,
  getIntents,
  getIntentById,
  getAllConfigs,
  upsertConfig,
  clearConfigCache,
  INTENTS,
};
