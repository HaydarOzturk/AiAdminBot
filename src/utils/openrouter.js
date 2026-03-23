/**
 * OpenRouter API client for AI features.
 * Uses free models by default. Requires OPENROUTER_API_KEY in .env.
 *
 * Default: "openrouter/free" — auto-routes to the best available free model.
 * You can also specify a model directly, e.g.:
 *   - meta-llama/llama-3.3-70b-instruct:free
 *   - google/gemini-2.0-flash-exp:free
 *   - qwen/qwen3-235b-a22b:free
 *
 * Browse all free models: https://openrouter.ai/models?q=free
 */

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Free models — "openrouter/free" auto-selects the best available
const FREE_MODELS = [
  'openrouter/free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-235b-a22b:free',
  'google/gemini-2.0-flash-exp:free',
];

/**
 * Check if the OpenRouter API key is configured
 * @returns {boolean}
 */
function isConfigured() {
  return !!process.env.OPENROUTER_API_KEY;
}

/**
 * Get the model to use (from env or default free model)
 * @returns {string}
 */
function getModel() {
  return process.env.AI_MODEL || FREE_MODELS[0];
}

/**
 * Send a chat completion request to OpenRouter
 * @param {Array<{role: string, content: string}>} messages - Chat messages
 * @param {object} [options]
 * @param {string} [options.model] - Override model
 * @param {number} [options.maxTokens] - Max response tokens (default 1024)
 * @param {number} [options.temperature] - Temperature (default 0.7)
 * @param {string} [options.systemPrompt] - System prompt (prepended to messages)
 * @returns {Promise<string>} The AI response text
 */
async function chat(messages, options = {}) {
  if (!isConfigured()) {
    throw new Error('OPENROUTER_API_KEY is not set. Add it to your .env file.');
  }

  const model = options.model || getModel();
  const maxTokens = options.maxTokens || 1024;
  const temperature = options.temperature ?? 0.7;

  // Prepend system prompt if provided
  const fullMessages = [];
  if (options.systemPrompt) {
    fullMessages.push({ role: 'system', content: options.systemPrompt });
  }
  fullMessages.push(...messages);

  const body = {
    model,
    messages: fullMessages,
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

  // Some models (like DeepSeek R1) wrap output in <think>...</think> tags
  // Strip the thinking portion and return only the final answer
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  return text;
}

/**
 * Classify content for moderation using AI.
 * Returns a structured result with category and confidence.
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
        temperature: 0.1, // Low temperature for consistent moderation
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

module.exports = { chat, moderateContent, isConfigured, getModel, FREE_MODELS };
