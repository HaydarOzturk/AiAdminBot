/**
 * Knowledge Base & Memory System
 *
 * - Message logging for "what did I miss?" and smart search
 * - Server knowledge base with categories (game, team, schedule, rule, faq)
 * - Auto-FAQ detection and matching
 * - Periodic channel summaries
 */

const db = require('../utils/database');
const { chat, isConfigured } = require('../utils/openrouter');
const { t } = require('../utils/locale');

// ── Message Logging ────────────────────────────────────────────────────────

const MAX_MESSAGE_LENGTH = 500;
const RETENTION_DAYS = 7;

/**
 * Log a message for future search/summarization.
 * Called from messageCreate event. Lightweight — no AI calls.
 */
function logMessage(message) {
  if (!message.content || message.content.length === 0) return;
  if (message.author.bot) return;
  if (!message.guild) return;

  const content = message.content.slice(0, MAX_MESSAGE_LENGTH);

  try {
    db.run(
      'INSERT INTO message_log (guild_id, channel_id, user_id, user_name, content) VALUES (?, ?, ?, ?, ?)',
      [message.guild.id, message.channel.id, message.author.id, message.author.username, content]
    );
  } catch {
    // Silent fail — logging should never block message flow
  }
}

/**
 * Prune old messages and generate channel summaries.
 * Called periodically (every 6 hours).
 */
async function pruneAndSummarize(client) {
  try {
    // Generate summaries for active channels before deleting
    if (isConfigured()) {
      const activeChannels = db.all(
        `SELECT DISTINCT guild_id, channel_id, COUNT(*) as msg_count
         FROM message_log
         WHERE created_at < datetime('now', '-1 day')
         AND created_at > datetime('now', '-2 days')
         GROUP BY guild_id, channel_id
         HAVING msg_count >= 10`
      );

      for (const ch of activeChannels) {
        try {
          await generateChannelSummary(ch.guild_id, ch.channel_id, '1 day');
        } catch {
          // Continue with other channels
        }
      }
    }

    // Delete old messages
    db.run(
      `DELETE FROM message_log WHERE created_at < datetime('now', '-${RETENTION_DAYS} days')`
    );
  } catch (err) {
    console.error('Knowledge base prune error:', err.message);
  }
}

// ── Channel Summaries ──────────────────────────────────────────────────────

/**
 * Generate a summary for a specific channel over a time period.
 */
async function generateChannelSummary(guildId, channelId, period = '8 hours') {
  const messages = db.all(
    `SELECT user_name, content, created_at FROM message_log
     WHERE guild_id = ? AND channel_id = ?
     AND created_at > datetime('now', '-${period}')
     ORDER BY created_at ASC`,
    [guildId, channelId]
  );

  if (messages.length < 3) return null;

  // Sample if too many messages
  let sampled = messages;
  if (messages.length > 150) {
    const first = messages.slice(0, 40);
    const last = messages.slice(-40);
    const step = Math.floor(messages.length / 70);
    const middle = messages.filter((_, i) => i % step === 0).slice(0, 70);
    sampled = [...first, ...middle, ...last];
  }

  const formatted = sampled.map(m => `[${m.user_name}] ${m.content}`).join('\n');

  try {
    const summary = await chat(
      [{ role: 'user', content: `Summarize this Discord conversation (${messages.length} messages):\n\n${formatted.slice(0, 6000)}` }],
      {
        systemPrompt: `You summarize Discord conversations concisely. Highlight: key topics discussed, decisions made, questions asked, and notable events. Use bullet points. Keep under 500 characters. Respond in the same language as the messages.`,
        maxTokens: 256,
        temperature: 0.3,
      }
    );

    // Store the summary
    const periodStart = messages[0].created_at;
    const periodEnd = messages[messages.length - 1].created_at;

    db.run(
      `INSERT INTO channel_summaries (guild_id, channel_id, summary, message_count, period_start, period_end)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [guildId, channelId, summary, messages.length, periodStart, periodEnd]
    );

    return summary;
  } catch (err) {
    console.error('Summary generation error:', err.message);
    return null;
  }
}

/**
 * Get a summary of recent activity in a channel.
 * Used by /what-did-i-miss command.
 */
async function getChannelSummary(guildId, channelId, hours = 8) {
  if (!isConfigured()) return null;

  const messages = db.all(
    `SELECT user_name, content, created_at FROM message_log
     WHERE guild_id = ? AND channel_id = ?
     AND created_at > datetime('now', '-${hours} hours')
     ORDER BY created_at ASC`,
    [guildId, channelId]
  );

  if (messages.length === 0) {
    // Try stored summaries
    const stored = db.all(
      `SELECT summary, message_count, period_start, period_end FROM channel_summaries
       WHERE guild_id = ? AND channel_id = ?
       AND period_end > datetime('now', '-${hours} hours')
       ORDER BY period_end DESC LIMIT 3`,
      [guildId, channelId]
    );

    if (stored.length > 0) {
      return stored.map(s => s.summary).join('\n\n');
    }
    return null;
  }

  // Sample and summarize
  let sampled = messages;
  if (messages.length > 150) {
    const first = messages.slice(0, 40);
    const last = messages.slice(-40);
    const step = Math.floor(messages.length / 70);
    const middle = messages.filter((_, i) => i % step === 0).slice(0, 70);
    sampled = [...first, ...middle, ...last];
  }

  const formatted = sampled.map(m => `[${m.user_name}] ${m.content}`).join('\n');

  try {
    return await chat(
      [{ role: 'user', content: `Summarize what happened in this Discord channel (${messages.length} messages over ${hours} hours):\n\n${formatted.slice(0, 6000)}` }],
      {
        systemPrompt: `You create helpful "what did I miss?" summaries for Discord channels. Include:
- Main topics discussed
- Any decisions or conclusions reached
- Important questions asked (and answers if given)
- Notable events or announcements
Use bullet points. Be concise but thorough. Respond in the same language as the messages.`,
        maxTokens: 512,
        temperature: 0.3,
      }
    );
  } catch (err) {
    console.error('Channel summary error:', err.message);
    return null;
  }
}

// ── Knowledge Base CRUD ────────────────────────────────────────────────────

function addKnowledge(guildId, category, content, taughtBy, question = null, tags = null) {
  db.run(
    `INSERT INTO knowledge_base (guild_id, category, question, content, tags, taught_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [guildId, category, question, content, tags, taughtBy]
  );
  return db.get('SELECT last_insert_rowid() as id').id;
}

function deleteKnowledge(guildId, id) {
  const existing = db.get('SELECT * FROM knowledge_base WHERE id = ? AND guild_id = ?', [id, guildId]);
  if (!existing) return false;
  db.run('DELETE FROM knowledge_base WHERE id = ? AND guild_id = ?', [id, guildId]);
  return true;
}

function listKnowledge(guildId, category = null) {
  if (category) {
    return db.all('SELECT * FROM knowledge_base WHERE guild_id = ? AND category = ? ORDER BY created_at DESC', [guildId, category]);
  }
  return db.all('SELECT * FROM knowledge_base WHERE guild_id = ? ORDER BY category, created_at DESC', [guildId]);
}

/**
 * AI-powered semantic search across knowledge base entries.
 */
async function searchKnowledge(guildId, query) {
  const entries = db.all('SELECT * FROM knowledge_base WHERE guild_id = ? ORDER BY created_at DESC LIMIT 100', [guildId]);
  if (entries.length === 0) return [];

  if (!isConfigured()) {
    // Fallback: simple text search
    const lower = query.toLowerCase();
    return entries.filter(e =>
      e.content.toLowerCase().includes(lower) ||
      (e.question && e.question.toLowerCase().includes(lower)) ||
      (e.tags && e.tags.toLowerCase().includes(lower))
    );
  }

  const numbered = entries.map((e, i) => `${i + 1}. [${e.category}] ${e.question ? `Q: ${e.question} A: ` : ''}${e.content}`).join('\n');

  try {
    const result = await chat(
      [{ role: 'user', content: `Query: "${query}"\n\nKnowledge entries:\n${numbered.slice(0, 4000)}` }],
      {
        systemPrompt: `You search a knowledge base. Return ONLY the numbers of relevant entries as a comma-separated list (e.g., "1,3,7"). If nothing matches, return "none".`,
        maxTokens: 64,
        temperature: 0.1,
      }
    );

    if (result.toLowerCase().includes('none')) return [];

    const indices = result.match(/\d+/g);
    if (!indices) return [];

    return indices
      .map(i => parseInt(i) - 1)
      .filter(i => i >= 0 && i < entries.length)
      .map(i => entries[i]);
  } catch {
    // Fallback to text search
    const lower = query.toLowerCase();
    return entries.filter(e => e.content.toLowerCase().includes(lower));
  }
}

// ── Auto-FAQ ───────────────────────────────────────────────────────────────

/**
 * Check if a message is a question that matches a known FAQ.
 * Returns the matching FAQ entry or null.
 */
async function checkFaq(message) {
  if (!message.content.endsWith('?')) return null;
  if (message.content.length < 10) return null;
  if (!isConfigured()) return null;

  const faqs = db.all(
    'SELECT * FROM knowledge_base WHERE guild_id = ? AND category = ? LIMIT 50',
    [message.guild.id, 'faq']
  );

  if (faqs.length === 0) return null;

  const faqList = faqs.map((f, i) => `${i + 1}. Q: ${f.question}`).join('\n');

  try {
    const result = await chat(
      [{ role: 'user', content: `User question: "${message.content}"\n\nKnown FAQs:\n${faqList}` }],
      {
        systemPrompt: `You match user questions to known FAQs. If the user's question is similar to one of the FAQs, return ONLY: {"match": NUMBER, "confidence": 0.0-1.0}. If no match, return: {"match": 0, "confidence": 0}`,
        maxTokens: 32,
        temperature: 0.1,
      }
    );

    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    let parsed;
    try { parsed = JSON.parse(jsonMatch[0]); } catch { return null; }

    if (parsed.match > 0 && parsed.confidence >= 0.6) {
      const faq = faqs[parsed.match - 1];
      return { ...faq, confidence: parsed.confidence };
    }
  } catch {
    // Silent fail
  }

  return null;
}

// ── Smart Search ───────────────────────────────────────────────────────────

/**
 * Search message history with AI understanding.
 */
async function searchMessages(guildId, query, options = {}) {
  const { userId, channelId, limit = 50 } = options;

  let sql = 'SELECT user_name, content, created_at FROM message_log WHERE guild_id = ?';
  const params = [guildId];

  if (userId) { sql += ' AND user_id = ?'; params.push(userId); }
  if (channelId) { sql += ' AND channel_id = ?'; params.push(channelId); }

  // Simple keyword pre-filter
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (keywords.length > 0) {
    sql += ` AND (${keywords.map(() => 'LOWER(content) LIKE ?').join(' OR ')})`;
    keywords.forEach(k => params.push(`%${k}%`));
  }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const messages = db.all(sql, params);
  if (messages.length === 0) return null;

  if (!isConfigured()) {
    return messages.map(m => `[${m.user_name}] ${m.content}`).join('\n').slice(0, 2000);
  }

  const formatted = messages.map(m => `[${m.user_name}] ${m.content}`).join('\n');

  try {
    return await chat(
      [{ role: 'user', content: `Search query: "${query}"\n\nMessages found:\n${formatted.slice(0, 4000)}` }],
      {
        systemPrompt: 'Summarize the search results, highlighting the most relevant messages that match the query. Be concise. Respond in the same language as the query.',
        maxTokens: 512,
        temperature: 0.3,
      }
    );
  } catch {
    return messages.map(m => `[${m.user_name}] ${m.content}`).join('\n').slice(0, 2000);
  }
}

// ── Periodic maintenance ───────────────────────────────────────────────────

let _pruneInterval = null;

function startKnowledgeMaintenance(client) {
  if (_pruneInterval) return;
  // Run every 6 hours
  _pruneInterval = setInterval(() => pruneAndSummarize(client), 6 * 60 * 60 * 1000);
  console.log('✅ Knowledge base maintenance started (prune every 6h)');
}

module.exports = {
  logMessage,
  getChannelSummary,
  addKnowledge,
  deleteKnowledge,
  listKnowledge,
  searchKnowledge,
  checkFaq,
  searchMessages,
  startKnowledgeMaintenance,
};
