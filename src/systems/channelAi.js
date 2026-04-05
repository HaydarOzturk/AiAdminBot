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

function upsertConfig(guildId, channelId, { enabled, intent, customPrompt, autoDetectIntent, responseCooldown, allowTempChannels, maxConcurrentGames }) {
  db.run(`
    INSERT INTO channel_ai_config (guild_id, channel_id, enabled, intent, custom_prompt, auto_detect_intent, response_cooldown, allow_temp_channels, max_concurrent_games)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, channel_id) DO UPDATE SET
      enabled = excluded.enabled,
      intent = excluded.intent,
      custom_prompt = excluded.custom_prompt,
      auto_detect_intent = excluded.auto_detect_intent,
      response_cooldown = excluded.response_cooldown,
      allow_temp_channels = excluded.allow_temp_channels,
      max_concurrent_games = excluded.max_concurrent_games,
      updated_at = CURRENT_TIMESTAMP
  `, [
    guildId, channelId,
    enabled ? 1 : 0,
    intent || 'help-support',
    customPrompt || null,
    autoDetectIntent != null ? (autoDetectIntent ? 1 : 0) : 1,
    responseCooldown || 30,
    allowTempChannels ? 1 : 0,
    Math.max(1, Math.min(5, maxConcurrentGames || 2)),
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

// ── Game Sessions ────────────────────────────────────────────────────────

/**
 * Game session state per channel.
 * Tracks conversation history so the AI remembers questions/answers.
 */
const gameSessions = new Map(); // channelId → session

const GAME_SESSION_TTL = 5 * 60 * 1000; // 5 minutes inactivity → session ends
const MAX_GAME_HISTORY = 20;
const MAX_QUESTIONS_PER_SESSION = 10;
const ANSWER_BATCH_DELAY = 10000; // 10 seconds to collect answers before evaluating

function hasActiveGameSession(channelId) {
  const session = gameSessions.get(channelId);
  if (!session) return false;
  if (Date.now() - session.lastActivity > GAME_SESSION_TTL) {
    gameSessions.delete(channelId);
    return false;
  }
  return true;
}

function getGameSession(channelId) {
  const session = gameSessions.get(channelId);
  if (!session) return null;
  if (Date.now() - session.lastActivity > GAME_SESSION_TTL) {
    gameSessions.delete(channelId);
    return null;
  }
  return session;
}

/**
 * Count active game sessions for a guild.
 */
function getGuildGameCount(guildId) {
  let count = 0;
  for (const [, session] of gameSessions) {
    if (session.guildId === guildId && Date.now() - session.lastActivity < GAME_SESSION_TTL) count++;
  }
  return count;
}

function startGameSession(channelId, guildId, userId) {
  const session = {
    messages: [],
    players: new Set([userId]),
    guildId,
    startedAt: Date.now(),
    lastActivity: Date.now(),
    questionCount: 0,
    joinPhase: true,
    joinPhaseEndAt: Date.now() + 30000,
    pendingAnswers: [], // buffered answers for batching
    answerTimer: null, // timer for answer batch processing
    tempChannelId: null, // if this game runs in a temp channel
  };
  gameSessions.set(channelId, session);
  return session;
}

function addToGameHistory(session, role, content) {
  session.messages.push({ role, content });
  // Trim to keep context window manageable
  if (session.messages.length > MAX_GAME_HISTORY) {
    session.messages = session.messages.slice(-MAX_GAME_HISTORY);
  }
  session.lastActivity = Date.now();
}

async function endGameSession(channelId, client) {
  const session = gameSessions.get(channelId);
  if (session) {
    if (session.answerTimer) clearTimeout(session.answerTimer);
    // Clean up temp channel after 60s grace period
    if (session.tempChannelId && client) {
      setTimeout(async () => {
        try {
          const ch = await client.channels.fetch(session.tempChannelId);
          if (ch) await ch.delete('Game session ended');
        } catch {}
      }, 60000);
    }
  }
  gameSessions.delete(channelId);
}

// Clean up expired sessions every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [channelId, session] of gameSessions) {
    if (now - session.lastActivity > GAME_SESSION_TTL) {
      gameSessions.delete(channelId);
    }
  }
}, 120000);

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

  // For mini-games: check if there's an active game session
  const isGameIntent = intent.id === 'mini-games';
  let gameSession = isGameIntent ? getGameSession(message.channel.id) : null;

  if (gameSession) {
    // Active game session — every message in the channel is part of the game
    gameSession.players.add(message.author.id);
    return await handleGameMessage(message, intent, config, gameSession);
  }

  // Smart detection for non-game or game-start trigger
  const score = shouldRespond(message, intent, message.client.user.id);
  if (score < RESPONSE_THRESHOLD) return false;

  // Cooldown check (skip for active game sessions)
  const cooldown = config.response_cooldown || 30;
  if (isOnCooldown(message.channel.id, cooldown)) return false;

  // For mini-games: start a new game session with join phase
  if (isGameIntent) {
    // Check per-guild game limit
    const maxGames = config.max_concurrent_games || 2;
    const currentGames = getGuildGameCount(message.guild.id);
    if (currentGames >= maxGames) {
      // Check if temp channels are allowed
      if (config.allow_temp_channels) {
        // Create temp channel for this game
        try {
          const tempCh = await message.guild.channels.create({
            name: `oyun-oturumu-${currentGames + 1}`,
            type: 0,
            parent: message.channel.parent,
            reason: 'Temporary game session channel',
          });
          await message.reply({ content: `🎮 Ana kanal meşgul! Oyun için geçici kanal oluşturuldu: ${tempCh}`, allowedMentions: { repliedUser: false } });
          gameSession = startGameSession(tempCh.id, message.guild.id, message.author.id);
          gameSession.tempChannelId = tempCh.id;
          // Continue with temp channel (the join phase announcement goes there)
          const locale = getLocale(message.guild.id);
          const joinMessages = {
            tr: '🎮 **Oyun başlıyor!** Katılmak isteyenler 30 saniye içinde bir mesaj yazsın!\n\n⏳ 30 saniye bekleniyor... Hazır olduğunuzda "başla" yazın.',
          };
          const joinMsg = joinMessages[locale] || '🎮 **Game starting!** Type anything within 30 seconds to join!\n\n⏳ Waiting 30 seconds... Type "start" when ready.';
          await tempCh.send({ content: joinMsg });
          return true;
        } catch (err) {
          console.error('Failed to create temp game channel:', err.message);
          await message.reply({ content: '❌ Geçici kanal oluşturulamadı.', allowedMentions: { repliedUser: false } });
          return false;
        }
      } else {
        const locale = getLocale(message.guild.id);
        const busyMsg = locale === 'tr'
          ? '🎮 Şu anda başka bir oyun devam ediyor. Lütfen bitmesini bekleyin!'
          : '🎮 A game is already in progress. Please wait for it to finish!';
        await message.reply({ content: busyMsg, allowedMentions: { repliedUser: false } });
        return false;
      }
    }

    gameSession = startGameSession(message.channel.id, message.guild.id, message.author.id);

    // Announce join phase in the guild's configured language
    const locale = getLocale(message.guild.id);
    const joinMessages = {
      tr: '🎮 **Oyun başlıyor!** Katılmak isteyenler 30 saniye içinde bir mesaj yazsın!\n\n⏳ 30 saniye bekleniyor... Hazır olduğunuzda "başla" yazın.',
      de: '🎮 **Spiel startet!** Schreibt etwas innerhalb von 30 Sekunden um teilzunehmen!\n\n⏳ 30 Sekunden warten... Schreibt "start" wenn bereit.',
      es: '🎮 **¡El juego comienza!** ¡Escribe algo en 30 segundos para unirte!\n\n⏳ Esperando 30 segundos... Escribe "start" cuando estés listo.',
      fr: '🎮 **Le jeu commence !** Tapez quelque chose dans les 30 secondes pour rejoindre !\n\n⏳ 30 secondes d\'attente... Tapez "start" quand vous êtes prêt.',
      pt: '🎮 **Jogo começando!** Digite algo em 30 segundos para participar!\n\n⏳ Aguardando 30 segundos... Digite "start" quando estiver pronto.',
      ru: '🎮 **Игра начинается!** Напишите что-нибудь в течение 30 секунд чтобы присоединиться!\n\n⏳ Ожидание 30 секунд... Напишите "start" когда будете готовы.',
      ar: '🎮 **اللعبة تبدأ!** اكتب أي شيء خلال 30 ثانية للانضمام!\n\n⏳ انتظار 30 ثانية... اكتب "start" عندما تكون جاهزاً.',
    };
    const joinMsg = joinMessages[locale] || '🎮 **Game starting!** Type anything within 30 seconds to join!\n\n⏳ Waiting 30 seconds... Type "start" when ready.';

    await message.channel.send({ content: joinMsg });

    // Auto-start after 30 seconds
    setTimeout(async () => {
      const currentSession = getGameSession(message.channel.id);
      if (currentSession && currentSession.joinPhase) {
        currentSession.joinPhase = false;
        addToGameHistory(currentSession, 'user', `[JOIN_PHASE_OVER — ${currentSession.players.size} player(s) joined. Start the game now with the first question!]`);

        // Build player names
        const playerNames = [];
        for (const pid of currentSession.players) {
          try {
            const m = await message.guild.members.fetch(pid);
            playerNames.push(m.displayName || m.user.username);
          } catch { playerNames.push(pid); }
        }

        const langNames = { tr: 'Turkish', en: 'English', de: 'German', es: 'Spanish', fr: 'French', pt: 'Portuguese', ru: 'Russian', ar: 'Arabic' };
        const srvLang = langNames[getLocale(message.guild.id)] || 'English';
        let systemPrompt = GAME_SYSTEM_PROMPT
          .replace('{players}', playerNames.join(', '))
          .replace(/{maxQuestions}/g, String(MAX_QUESTIONS_PER_SESSION))
          .replace('{questionCount}', '0')
          .replace(/{serverLanguage}/g, srvLang);
        if (config.custom_prompt) systemPrompt += '\n\nExtra instructions: ' + config.custom_prompt;

        try {
          const resp = await aiChat(currentSession.messages, { systemPrompt, maxTokens: 1024, temperature: 0.8 });
          if (resp) {
            addToGameHistory(currentSession, 'assistant', resp);
            if (resp.includes('?')) currentSession.questionCount++;
            await message.channel.send({ content: resp.substring(0, 2000) });
          }
        } catch (err) {
          console.error('Game auto-start error:', err.message);
        }
      }
    }, 30000);

    return true;
  }

  // Non-game intent: one-shot response
  try {
    const systemPrompt = await buildPrompt(intent, message, config.custom_prompt);
    const resolvedContent = resolveMentions(message);

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

// ── Game Message Handler ─────────────────────────────────────────────────

const GAME_SYSTEM_PROMPT = `You are a fun game master running an interactive game session in a Discord channel.

CRITICAL RULES FOR GAME SESSIONS:
1. You have FULL MEMORY of this conversation. Read the message history carefully.
2. When you ask a question, WAIT for the user's answer before moving on.
3. When a user answers, EVALUATE their answer against the correct answer.
4. Be LENIENT with typos and spelling errors — if the answer is close enough to be recognizable, count it as CORRECT. For example "Shakespare" = "Shakespeare" = CORRECT.
5. Say if they were RIGHT or WRONG, reveal the correct answer, and give a score update.
6. Only then ask the next question.
7. Track scores per player across the session.
8. After {maxQuestions} questions, end the game with a final scoreboard.
9. If someone says "stop", "end", "quit", "bitir", "dur" — end the game early with scores.

GAME PHASES:
- JOIN PHASE: When the game starts, say "Oyun başlıyor! Katılmak isteyenler 30 saniye içinde bir mesaj yazın!" (or equivalent in the user's language). Wait for the [JOIN_PHASE_OVER] marker before asking the first question.
- PLAY PHASE: Ask question → Wait for answer → Evaluate → Score → Next question
- END PHASE: Show final scores, congratulate winner

Current players: {players}
Questions asked so far: {questionCount}/{maxQuestions}

Keep responses fun with emojis.
IMPORTANT: The server language is {serverLanguage}. Always respond in {serverLanguage}. If users write in another language, still respond in {serverLanguage}.
Keep each response under 1500 characters.`;

/**
 * Handle a message within an active game session.
 * Uses answer batching: collects answers for 10s, then evaluates all at once.
 */
async function handleGameMessage(message, intent, config, session) {
  const resolvedContent = resolveMentions(message);
  const lower = resolvedContent.toLowerCase().trim();

  // Join phase: collect players, don't start the game yet
  if (session.joinPhase) {
    session.players.add(message.author.id);
    session.lastActivity = Date.now();

    const shouldStart = Date.now() >= session.joinPhaseEndAt ||
                        ['start', 'başla', 'hadi', 'go', 'ready', 'hazır'].includes(lower);

    if (shouldStart) {
      session.joinPhase = false;
      addToGameHistory(session, 'user', `[JOIN_PHASE_OVER — ${session.players.size} players joined. Start the game now with the first question!]`);
    } else {
      return false; // Let the auto-start timer handle it
    }
    // Fall through to AI call
  } else {
    // Check for game-end commands — process immediately
    if (['stop', 'end', 'quit', 'bitir', 'dur', 'bitti'].includes(lower)) {
      if (session.answerTimer) { clearTimeout(session.answerTimer); session.answerTimer = null; }
      // Flush any pending answers
      if (session.pendingAnswers.length > 0) {
        const batch = session.pendingAnswers.map(a => `${a.username}: ${a.content}`).join('\n');
        addToGameHistory(session, 'user', batch);
        session.pendingAnswers = [];
      }
      addToGameHistory(session, 'user', `${message.author.username}: ${resolvedContent}`);
      addToGameHistory(session, 'user', '[GAME OVER — User requested end. Show final scoreboard and congratulate.]');
      // Fall through to immediate AI call
    } else if (session.questionCount >= MAX_QUESTIONS_PER_SESSION) {
      addToGameHistory(session, 'user', `${message.author.username}: ${resolvedContent}`);
      addToGameHistory(session, 'user', '[MAX QUESTIONS REACHED — End the game now with final scoreboard.]');
      // Fall through to immediate AI call
    } else {
      // Buffer the answer for batch processing
      session.pendingAnswers.push({ username: message.author.username, content: resolvedContent });
      session.lastActivity = Date.now();

      // Start batch timer if not already running
      if (!session.answerTimer) {
        session.answerTimer = setTimeout(() => {
          processAnswerBatch(message.channel, session, config).catch(err => {
            console.error('Answer batch error:', err.message);
          });
        }, ANSWER_BATCH_DELAY);
      }
      return true; // Buffered, will be processed by timer
    }
  }

  try {
    // Build game-specific system prompt
    const playerNames = [];
    for (const playerId of session.players) {
      try {
        const member = await message.guild.members.fetch(playerId);
        playerNames.push(member.displayName || member.user.username);
      } catch {
        playerNames.push(playerId);
      }
    }

    const langNames = { tr: 'Turkish', en: 'English', de: 'German', es: 'Spanish', fr: 'French', pt: 'Portuguese', ru: 'Russian', ar: 'Arabic' };
    const srvLang = langNames[getLocale(message.guild.id)] || 'English';
    let systemPrompt = GAME_SYSTEM_PROMPT
      .replace('{players}', playerNames.join(', '))
      .replace(/{maxQuestions}/g, String(MAX_QUESTIONS_PER_SESSION))
      .replace('{questionCount}', String(session.questionCount))
      .replace(/{serverLanguage}/g, srvLang);

    // Add custom prompt if set
    if (config.custom_prompt) {
      systemPrompt += '\n\nExtra instructions: ' + config.custom_prompt;
    }

    // Send full conversation history to AI
    const response = await aiChat(
      session.messages,
      { systemPrompt, maxTokens: 1024, temperature: 0.8 }
    );

    if (!response || response.trim().length === 0) return false;

    // Track if this response likely contains a new question
    if (response.includes('?')) {
      session.questionCount++;
    }

    // Add AI response to session history
    addToGameHistory(session, 'assistant', response);

    // Check if game should end
    const shouldEnd = lower === 'stop' || lower === 'end' || lower === 'quit' ||
                      lower === 'bitir' || lower === 'dur' || lower === 'bitti' ||
                      session.questionCount >= MAX_QUESTIONS_PER_SESSION ||
                      response.toLowerCase().includes('final skor') ||
                      response.toLowerCase().includes('final score') ||
                      response.toLowerCase().includes('game over');

    // Send response — use channel.send for games to avoid MESSAGE_REFERENCE errors
    const chunks = [];
    let remaining = response;
    while (remaining.length > 0) {
      if (remaining.length <= 2000) { chunks.push(remaining); break; }
      const splitAt = remaining.lastIndexOf(' ', 2000);
      chunks.push(remaining.slice(0, splitAt > 0 ? splitAt : 2000));
      remaining = remaining.slice(splitAt > 0 ? splitAt + 1 : 2000);
    }

    for (const chunk of chunks) {
      await message.channel.send({ content: chunk });
    }

    // End session if game is over
    if (shouldEnd) {
      await endGameSession(message.channel.id, message.client);
    }

    return true;
  } catch (error) {
    console.error(`Game session error in #${message.channel.name}: ${error.message}`);
    // Don't let a crash kill the session — just log it
    return false;
  }
}

/**
 * Process a batch of buffered answers — sends all answers to AI at once.
 */
async function processAnswerBatch(channel, session, config) {
  session.answerTimer = null;

  if (session.pendingAnswers.length === 0) return;

  // Combine all buffered answers into one message
  const batch = session.pendingAnswers.map(a => `${a.username}: ${a.content}`).join('\n');
  session.pendingAnswers = [];

  addToGameHistory(session, 'user', batch);

  try {
    const guild = channel.guild;
    const playerNames = [];
    for (const playerId of session.players) {
      try { const m = await guild.members.fetch(playerId); playerNames.push(m.displayName || m.user.username); }
      catch { playerNames.push(playerId); }
    }

    const langNames = { tr: 'Turkish', en: 'English', de: 'German', es: 'Spanish', fr: 'French', pt: 'Portuguese', ru: 'Russian', ar: 'Arabic' };
    const srvLang = langNames[getLocale(guild.id)] || 'English';

    let systemPrompt = GAME_SYSTEM_PROMPT
      .replace('{players}', playerNames.join(', '))
      .replace(/{maxQuestions}/g, String(MAX_QUESTIONS_PER_SESSION))
      .replace('{questionCount}', String(session.questionCount))
      .replace(/{serverLanguage}/g, srvLang);

    if (config.custom_prompt) systemPrompt += '\n\nExtra instructions: ' + config.custom_prompt;

    const response = await aiChat(session.messages, { systemPrompt, maxTokens: 1024, temperature: 0.8 });

    if (!response || response.trim().length === 0) return;

    if (response.includes('?')) session.questionCount++;
    addToGameHistory(session, 'assistant', response);

    const shouldEnd = session.questionCount >= MAX_QUESTIONS_PER_SESSION ||
                      response.toLowerCase().includes('final skor') ||
                      response.toLowerCase().includes('final score') ||
                      response.toLowerCase().includes('game over');

    // Send
    const chunks = [];
    let remaining = response;
    while (remaining.length > 0) {
      if (remaining.length <= 2000) { chunks.push(remaining); break; }
      const splitAt = remaining.lastIndexOf(' ', 2000);
      chunks.push(remaining.slice(0, splitAt > 0 ? splitAt : 2000));
      remaining = remaining.slice(splitAt > 0 ? splitAt + 1 : 2000);
    }
    for (const chunk of chunks) {
      await channel.send({ content: chunk });
    }

    if (shouldEnd) {
      await endGameSession(channel.id, channel.client);
    }
  } catch (error) {
    console.error(`Answer batch error in #${channel.name}: ${error.message}`);
  }
}

module.exports = {
  handleChannelAi,
  hasActiveGameSession,
  getIntents,
  getIntentById,
  getAllConfigs,
  upsertConfig,
  clearConfigCache,
  getGuildGameCount,
  INTENTS,
};
