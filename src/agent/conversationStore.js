/**
 * Conversation Store for AI Agent
 * Manages multi-turn conversation state per user per guild.
 */

const db = require('../utils/database');

// In-memory cache for fast access
const conversations = new Map();

const MAX_MESSAGES = 20;
const EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

// Cleanup every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, conv] of conversations) {
    if (now - conv.lastActivity > EXPIRY_MS) {
      conversations.delete(key);
      db.run('DELETE FROM agent_conversations WHERE id = ?', [key]);
    }
  }
}, 10 * 60 * 1000);

function getKey(guildId, userId) {
  return `${guildId}-${userId}`;
}

function getConversation(guildId, userId) {
  const key = getKey(guildId, userId);

  if (conversations.has(key)) {
    const conv = conversations.get(key);
    conv.lastActivity = Date.now();
    return conv;
  }

  // Try loading from DB
  const row = db.get('SELECT * FROM agent_conversations WHERE id = ?', [key]);
  if (row) {
    const conv = {
      messages: JSON.parse(row.messages || '[]'),
      pendingAction: row.pending_action ? JSON.parse(row.pending_action) : null,
      lastActivity: Date.now(),
    };
    conversations.set(key, conv);
    return conv;
  }

  // Create new
  const conv = { messages: [], pendingAction: null, lastActivity: Date.now() };
  conversations.set(key, conv);
  return conv;
}

function addMessage(guildId, userId, role, content) {
  const conv = getConversation(guildId, userId);
  conv.messages.push({ role, content });

  // Trim to max
  while (conv.messages.length > MAX_MESSAGES) {
    conv.messages.shift();
  }

  conv.lastActivity = Date.now();
  save(guildId, userId, conv);
}

function setPendingAction(guildId, userId, action) {
  const conv = getConversation(guildId, userId);
  conv.pendingAction = action;
  save(guildId, userId, conv);
}

function clearPendingAction(guildId, userId) {
  const conv = getConversation(guildId, userId);
  conv.pendingAction = null;
  save(guildId, userId, conv);
}

function getPendingAction(guildId, userId) {
  const conv = getConversation(guildId, userId);
  return conv.pendingAction;
}

function resetConversation(guildId, userId) {
  const key = getKey(guildId, userId);
  conversations.delete(key);
  db.run('DELETE FROM agent_conversations WHERE id = ?', [key]);
}

function save(guildId, userId, conv) {
  const key = getKey(guildId, userId);
  db.run(
    `INSERT INTO agent_conversations (id, guild_id, user_id, messages, pending_action, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET messages = ?, pending_action = ?, updated_at = datetime('now')`,
    [key, guildId, userId, JSON.stringify(conv.messages), conv.pendingAction ? JSON.stringify(conv.pendingAction) : null,
     JSON.stringify(conv.messages), conv.pendingAction ? JSON.stringify(conv.pendingAction) : null]
  );
}

module.exports = {
  getConversation,
  addMessage,
  setPendingAction,
  clearPendingAction,
  getPendingAction,
  resetConversation,
};
