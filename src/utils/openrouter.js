/**
 * AI provider abstraction — supports Google Gemini (direct) and OpenRouter.
 *
 * Priority: GEMINI_API_KEY → OPENROUTER_API_KEY
 *
 * Gemini (recommended):
 *   Get a free key at https://aistudio.google.com/apikey
 *   Set GEMINI_API_KEY in .env — that's it.
 *   Default model: gemini-2.0-flash (free, fast, great at Turkish)
 *
 * OpenRouter (fallback):
 *   Get a free key at https://openrouter.ai/keys
 *   Set OPENROUTER_API_KEY in .env
 *   Default model: openrouter/free
 */

// ── Provider detection ──────────────────────────────────────────────────────

function getProvider() {
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.OPENROUTER_API_KEY) return 'openrouter';
  return null;
}

function isConfigured() {
  return getProvider() !== null;
}

function getModel() {
  if (process.env.AI_MODEL) return process.env.AI_MODEL;
  // Gemini 3.1 Flash Lite: highest free rate limits (15 RPM, 500 RPD)
  return getProvider() === 'gemini' ? 'gemini-3.1-flash-lite-preview' : 'openrouter/free';
}

// Free OpenRouter models for reference
const FREE_MODELS = [
  'openrouter/free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-235b-a22b:free',
  'google/gemini-2.0-flash-exp:free',
];

// ── Gemini API ──────────────────────────────────────────────────────────────

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

async function geminiChat(messages, options = {}) {
  const model = options.model || getModel();
  const maxTokens = options.maxTokens || 1024;
  const temperature = options.temperature ?? 0.7;

  // Convert OpenAI-style messages to Gemini format
  const contents = [];
  let systemInstruction = null;

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemInstruction = msg.content;
    } else {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }
  }

  const body = {
    contents,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
    },
  };

  // Gemini supports system instructions natively
  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const url = `${GEMINI_API_URL}/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();

  if (!data.candidates || data.candidates.length === 0) {
    throw new Error('Gemini returned no candidates');
  }

  return data.candidates[0].content?.parts?.[0]?.text || '';
}

// ── OpenRouter API ──────────────────────────────────────────────────────────

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function openrouterChat(messages, options = {}) {
  const model = options.model || getModel();
  const maxTokens = options.maxTokens || 1024;
  const temperature = options.temperature ?? 0.7;

  const body = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
  };

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://github.com/discord-admin-bot',
      'X-Title': 'Discord Admin Bot',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();

  if (!data.choices || data.choices.length === 0) {
    throw new Error('OpenRouter returned no choices');
  }

  let text = data.choices[0].message?.content || '';

  // Some models wrap output in <think>...</think> tags
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  return text;
}

// ── Unified chat function ───────────────────────────────────────────────────

/**
 * Send a chat completion request to the configured AI provider.
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} [options]
 * @param {string} [options.model] - Override model
 * @param {number} [options.maxTokens] - Max response tokens (default 1024)
 * @param {number} [options.temperature] - Temperature (default 0.7)
 * @param {string} [options.systemPrompt] - System prompt (prepended to messages)
 * @returns {Promise<string>} The AI response text
 */
async function chat(messages, options = {}) {
  const provider = getProvider();
  if (!provider) {
    throw new Error('No AI provider configured. Set GEMINI_API_KEY or OPENROUTER_API_KEY in .env');
  }

  // Prepend system prompt if provided
  const fullMessages = [];
  if (options.systemPrompt) {
    fullMessages.push({ role: 'system', content: options.systemPrompt });
  }
  fullMessages.push(...messages);

  if (provider === 'gemini') {
    return geminiChat(fullMessages, options);
  }
  return openrouterChat(fullMessages, options);
}

// ── Moderation ──────────────────────────────────────────────────────────────

/**
 * Classify content for moderation using AI.
 * @param {string} content - Message content to check
 * @returns {Promise<{flagged: boolean, category: string, confidence: number, reason: string}>}
 */
async function moderateContent(content) {
  if (!isConfigured()) {
    return { flagged: false, category: 'none', confidence: 0, reason: 'AI not configured' };
  }

  const systemPrompt = `You are a Discord server content moderator for a Turkish gaming community. You MUST detect violations in BOTH Turkish and English.

Categories:
- toxicity: Insults, slurs, harassment, hate speech, personal attacks, swearing AT someone
- spam: Repetitive messages, excessive caps, gibberish, advertisement links
- nsfw: Sexual or explicit content, sexual slurs
- threat: Threats of violence or harm
- none: Message is clean

Turkish profanity examples that MUST be flagged as toxicity:
- "orospu" and any variation (orosbu, 0rospu, etc.) — severe slur
- "siktir", "sikerim", "sikeyim" — vulgar insults
- "amına", "amina koyayım" — vulgar insults
- "piç", "pezevenk", "gavat", "ibne" — slurs
- "ananı", "anani" — maternal insults
- Combining slurs with usernames (e.g. "orospu [name]") — personal attack, HIGH confidence

Respond in EXACTLY this JSON format, nothing else:
{"flagged": true/false, "category": "category_name", "confidence": 0.0-1.0, "reason": "brief explanation"}

Rules:
- Flag Turkish profanity with confidence >= 0.9
- Normal gaming talk, slang, abbreviations (gg, wp, ez) = NOT flagged
- Friendly casual language and banter = NOT flagged
- When in doubt about Turkish words, flag with lower confidence (0.6-0.7)`;

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

module.exports = { chat, moderateContent, isConfigured, getModel, getProvider, FREE_MODELS };
