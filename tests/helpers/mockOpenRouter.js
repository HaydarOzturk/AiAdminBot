/**
 * Mock AI provider responses for testing
 *
 * Intercepts global.fetch to return canned responses
 * for Gemini and OpenRouter API calls.
 *
 * Usage:
 *   const restore = mockAIResponse('Hello!');
 *   // ... run code that calls AI ...
 *   restore(); // cleanup
 */

const AI_URL_PATTERNS = [
  'generativelanguage.googleapis.com',
  'openrouter.ai',
];

function isAIUrl(url) {
  return AI_URL_PATTERNS.some(p => url.includes(p));
}

/**
 * Mock a successful AI response
 * @param {string} responseText - Text the AI should "respond" with
 * @returns {Function} Cleanup function to restore original fetch
 */
function mockAIResponse(responseText) {
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (isAIUrl(String(url))) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          // Gemini format
          candidates: [{
            content: { parts: [{ text: responseText }] },
          }],
          // OpenRouter format
          choices: [{
            message: { content: responseText },
          }],
        }),
        text: async () => responseText,
      };
    }
    return originalFetch(url, opts);
  };
  return () => { global.fetch = originalFetch; };
}

/**
 * Mock an AI API error
 * @param {number} statusCode - HTTP status to return
 * @returns {Function} Cleanup function
 */
function mockAIError(statusCode = 500) {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (isAIUrl(String(url))) {
      return {
        ok: false,
        status: statusCode,
        json: async () => ({ error: 'API error' }),
        text: async () => 'API error',
      };
    }
    return originalFetch(url);
  };
  return () => { global.fetch = originalFetch; };
}

module.exports = { mockAIResponse, mockAIError };
