const { EmbedBuilder } = require('discord.js');
const { createEmbed } = require('../utils/embedBuilder');
const db = require('../utils/database');

// ── Templates ────────────────────────────────────────────────────────────

const TEMPLATES = [
  {
    id: 'rules',
    name: 'Server Rules',
    description: 'A rules embed with numbered fields',
    messageType: 'rules',
    content: {
      title: 'Server Rules',
      description: 'Please read and follow these rules to keep our community safe and welcoming.',
      color: '#5865f2',
      fields: [
        { name: '1. Be Respectful', value: 'Treat everyone with respect. No harassment, hate speech, or discrimination.', inline: false },
        { name: '2. No Spam', value: 'Do not spam messages, images, or links.', inline: false },
        { name: '3. No NSFW', value: 'Keep all content appropriate and safe for work.', inline: false },
      ],
      footer: 'Breaking rules may result in warnings, mutes, or bans.',
    },
  },
  {
    id: 'welcome-info',
    name: 'Welcome Info',
    description: 'An informational embed for new members',
    messageType: 'info',
    content: {
      title: 'Welcome to the Server!',
      description: 'Here is everything you need to get started.',
      color: '#22c55e',
      fields: [
        { name: 'Verify', value: 'Head to the verification channel to get access.', inline: false },
        { name: 'Roles', value: 'Pick your roles in the roles channel.', inline: false },
        { name: 'Have Fun', value: 'Explore the channels and enjoy your stay!', inline: false },
      ],
    },
  },
  {
    id: 'announcement',
    name: 'Announcement',
    description: 'A general announcement template',
    messageType: 'announcement',
    content: {
      title: 'Announcement',
      description: 'Your announcement text here.',
      color: '#f59e0b',
      footer: 'Posted by the admin team',
    },
  },
  {
    id: 'blank',
    name: 'Blank Embed',
    description: 'Start from scratch',
    messageType: 'custom',
    content: { title: '', description: '', color: '#5865f2', fields: [] },
  },
];

function getTemplates() {
  return JSON.parse(JSON.stringify(TEMPLATES));
}

// ── CRUD ─────────────────────────────────────────────────────────────────

function getMessagesForGuild(guildId, { type, channelId } = {}) {
  let sql = 'SELECT * FROM bot_messages WHERE guild_id = ?';
  const params = [guildId];

  if (type) {
    if (type === 'system') {
      sql += ' AND is_system = 1 AND message_type != ?';
      params.push('bot-action');
    } else if (type === 'bot-action') {
      sql += ' AND message_type = ?';
      params.push('bot-action');
    } else {
      sql += ' AND message_type = ? AND is_system = 0';
      params.push(type);
    }
  }

  if (channelId) {
    sql += ' AND channel_id = ?';
    params.push(channelId);
  }

  sql += ' ORDER BY updated_at DESC';
  return db.all(sql, params);
}

function getMessage(id) {
  return db.get('SELECT * FROM bot_messages WHERE id = ?', [id]);
}

function createMessage(guildId, { name, messageType, content, channelId, createdBy }) {
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content || {});

  db.run(`
    INSERT INTO bot_messages (guild_id, channel_id, message_type, name, content, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [guildId, channelId || null, messageType || 'custom', name, contentStr, createdBy || null]);

  const row = db.get('SELECT last_insert_rowid() as id');
  return row.id;
}

function updateMessage(id, { name, messageType, content }) {
  const sets = ['updated_at = CURRENT_TIMESTAMP'];
  const params = [];

  if (name != null) { sets.push('name = ?'); params.push(name); }
  if (messageType != null) { sets.push('message_type = ?'); params.push(messageType); }
  if (content != null) {
    const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
    sets.push('content = ?');
    params.push(contentStr);
  }

  params.push(id);
  db.run(`UPDATE bot_messages SET ${sets.join(', ')} WHERE id = ?`, params);
}

function deleteMessageRecord(id) {
  db.run('DELETE FROM bot_messages WHERE id = ?', [id]);
}

// ── Build embed payload ──────────────────────────────────────────────────

function buildMessagePayload(record) {
  const content = typeof record.content === 'string' ? JSON.parse(record.content) : record.content;

  const embed = new EmbedBuilder();

  // Color: accept hex string or named color
  if (content.color && content.color.startsWith('#')) {
    embed.setColor(parseInt(content.color.replace('#', ''), 16));
  } else {
    embed.setColor(0x5865f2); // default blurple
  }

  if (content.title) embed.setTitle(content.title);
  if (content.description) embed.setDescription(content.description);
  if (content.footer) embed.setFooter({ text: content.footer });
  if (content.thumbnail) embed.setThumbnail(content.thumbnail);
  if (content.image) embed.setImage(content.image);
  if (content.timestamp) embed.setTimestamp();

  if (Array.isArray(content.fields)) {
    for (const field of content.fields) {
      if (field.name && field.value) {
        embed.addFields({ name: field.name, value: String(field.value), inline: !!field.inline });
      }
    }
  }

  return { embeds: [embed], components: [] };
}

// ── Discord operations ───────────────────────────────────────────────────

/**
 * Publish a message to a Discord channel.
 * If the message is already published in the same channel, edits it.
 */
async function publishMessage(client, id, channelId) {
  const record = getMessage(id);
  if (!record) throw new Error('Message not found');

  const guild = client.guilds.cache.get(record.guild_id);
  if (!guild) throw new Error('Guild not found');

  const channel = await guild.channels.fetch(channelId);
  if (!channel) throw new Error('Channel not found');

  const payload = buildMessagePayload(record);

  // If already published in this channel, edit it
  if (record.message_id && record.channel_id === channelId) {
    try {
      const msg = await channel.messages.fetch(record.message_id);
      await msg.edit(payload);
      return msg;
    } catch {
      // Message was deleted — send new
    }
  }

  // If published in a different channel, delete old first
  if (record.message_id && record.channel_id && record.channel_id !== channelId) {
    try {
      const oldChannel = await guild.channels.fetch(record.channel_id);
      const oldMsg = await oldChannel.messages.fetch(record.message_id);
      await oldMsg.delete();
    } catch {
      // Old message already gone
    }
  }

  const msg = await channel.send(payload);

  db.run(
    'UPDATE bot_messages SET message_id = ?, channel_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [msg.id, channelId, id]
  );

  return msg;
}

/**
 * Update the published Discord message with current DB content.
 */
async function updatePublishedMessage(client, id) {
  const record = getMessage(id);
  if (!record || !record.message_id || !record.channel_id) return;

  const guild = client.guilds.cache.get(record.guild_id);
  if (!guild) return;

  try {
    const channel = await guild.channels.fetch(record.channel_id);
    const msg = await channel.messages.fetch(record.message_id);
    const payload = buildMessagePayload(record);
    await msg.edit(payload);
  } catch (err) {
    console.warn(`Could not update bot message ${record.message_id}: ${err.message}`);
    // Clear stale reference
    db.run('UPDATE bot_messages SET message_id = NULL WHERE id = ?', [id]);
  }
}

/**
 * Delete the Discord message but keep the DB record as a draft.
 */
async function unpublishMessage(client, id) {
  const record = getMessage(id);
  if (!record || !record.message_id) return;

  const guild = client.guilds.cache.get(record.guild_id);
  if (guild) {
    try {
      const channel = await guild.channels.fetch(record.channel_id);
      const msg = await channel.messages.fetch(record.message_id);
      await msg.delete();
    } catch {
      // Already gone
    }
  }

  db.run('UPDATE bot_messages SET message_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
}

/**
 * Delete the DB record and optionally the Discord message.
 */
async function deleteMessage(client, id) {
  const record = getMessage(id);
  if (!record) return;

  // Delete Discord message if published
  if (record.message_id && client) {
    const guild = client.guilds.cache.get(record.guild_id);
    if (guild) {
      try {
        const channel = await guild.channels.fetch(record.channel_id);
        const msg = await channel.messages.fetch(record.message_id);
        await msg.delete();
      } catch {
        // Already gone
      }
    }
  }

  deleteMessageRecord(id);
}

// ── Detection helpers ────────────────────────────────────────────────────

// Channel name patterns that indicate log/action channels (skip entirely)
const LOG_CHANNEL_PATTERNS = [
  /log$/i, /-log$/i, /logs$/i, /kayit/i, /kayıt/i,
  /punishment/i, /ceza/i, /mod-/i, /admin-/i,
  /bot-komut/i, /bot-command/i,
];

// Embed field names that indicate bot action/log messages
const ACTION_FIELD_NAMES = [
  'user', 'kullanıcı', 'moderator', 'action', 'eylem', 'işlem',
  'reason', 'sebep', 'neden', 'duration', 'süre',
  'channel', 'kanal', 'role', 'rol',
  'old role', 'new role', 'removed role', 'added role',
  'eski rol', 'yeni rol',
];

// Embed titles that are transient agent/system messages (skip)
const SKIP_TITLE_PATTERNS = [
  // Agent action results (all locales)
  /İşlem Tamamlandı/i, /İşlem Başarısız/i, /Onay Gerekli/i,
  /Action Completed/i, /Action Failed/i, /Confirmation Required/i,
  // Automod warnings
  /Auto.?mod/i, /Uyarı/i,
];

/**
 * Detect if a message is a bot action/log message (not user-managed content).
 */
function isBotActionMessage(channel, embed) {
  // Check channel name
  if (LOG_CHANNEL_PATTERNS.some(p => p.test(channel.name))) return true;

  // Check embed fields — if it has typical log fields, it's an action message
  const fieldNames = (embed.fields || []).map(f => f.name.toLowerCase());
  const matchCount = fieldNames.filter(fn =>
    ACTION_FIELD_NAMES.some(pattern => fn.includes(pattern))
  ).length;

  // If 2+ fields match action patterns, it's likely a log message
  if (matchCount >= 2) return true;

  // Check if embed has timestamp (common in log messages) + action-like fields
  if (embed.timestamp && matchCount >= 1) return true;

  return false;
}

// ── Scan ─────────────────────────────────────────────────────────────────

const MAX_MESSAGES_PER_CHANNEL = 30;
const MAX_TOTAL_REGISTERED = 100;
const CHANNEL_SCAN_DELAY_MS = 200;

/**
 * Collect all button custom IDs from a Discord message.
 */
function getButtonIds(msg) {
  const ids = [];
  for (const row of (msg.components || [])) {
    for (const comp of (row.components || [])) {
      if (comp.customId) ids.push(comp.customId);
    }
  }
  return ids;
}

/**
 * Scan a channel for untracked bot messages and register them.
 * Skips: log channels, bot-action messages, AI chat replies, agent confirmations.
 * Keeps: polls, giveaways, verification, custom embeds.
 */
async function scanChannel(client, guildId, channelId, remainingBudget) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return 0;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== 0) return 0;
  if (!channel.permissionsFor(guild.members.me)?.has('ViewChannel')) return 0;

  // Skip log channels entirely — they only contain transient action messages
  if (LOG_CHANNEL_PATTERNS.some(p => p.test(channel.name))) return 0;

  const botId = client.user.id;
  let registered = 0;

  try {
    const messages = await channel.messages.fetch({ limit: MAX_MESSAGES_PER_CHANNEL });

    for (const [, msg] of messages) {
      if (registered >= remainingBudget) break;

      if (msg.author.id !== botId) continue;
      if (!msg.embeds?.length) continue;

      // Skip if it's a reply to a user message (AI chat responses)
      if (msg.reference?.messageId) continue;

      // Skip if already tracked in bot_messages
      const existing = db.get(
        'SELECT id FROM bot_messages WHERE guild_id = ? AND message_id = ?',
        [guildId, msg.id]
      );
      if (existing) continue;

      // Skip role menu messages (managed in Role Menus tab)
      const isRoleMenu = db.get(
        'SELECT id FROM role_menu_messages WHERE guild_id = ? AND message_id = ?',
        [guildId, msg.id]
      );
      if (isRoleMenu) continue;

      const buttonIds = getButtonIds(msg);

      // Skip role menus by button ID
      if (buttonIds.some(id => id.startsWith('role_'))) continue;

      // Skip agent confirmation messages
      if (buttonIds.some(id => id.startsWith('agent_confirm_') || id.startsWith('agent_cancel_'))) continue;

      // Detect type by button IDs
      const isPoll = buttonIds.some(id => id.startsWith('poll_vote_'));
      const isGiveaway = buttonIds.includes('giveaway_enter');
      const isVerification = buttonIds.includes('verify_button');

      const embed = msg.embeds[0];

      // Skip bot-action log messages (even if not in a log channel)
      if (!isPoll && !isGiveaway && !isVerification && isBotActionMessage(channel, embed)) continue;

      // Skip transient agent/system messages by embed title
      const embedTitle = embed.title || '';
      if (SKIP_TITLE_PATTERNS.some(p => p.test(embedTitle))) continue;

      // Skip embeds with no title and no description (empty/minimal bot messages)
      if (!embed.title && !embed.description) continue;

      // Extract embed data
      const content = {
        title: embed.title || '',
        description: embed.description || '',
        color: embed.hexColor || '#5865f2',
        footer: embed.footer?.text || '',
        fields: (embed.fields || []).map(f => ({ name: f.name, value: f.value, inline: f.inline })),
      };
      if (embed.thumbnail?.url) content.thumbnail = embed.thumbnail.url;
      if (embed.image?.url) content.image = embed.image.url;

      // Determine type and system status
      const name = embed.title || `Untitled (#${channel.name})`;
      let messageType = 'custom';
      let isSystem = 0;

      if (isVerification) {
        messageType = 'verification';
        isSystem = 1;
      } else if (isPoll) {
        messageType = 'poll';
        isSystem = 1;
      } else if (isGiveaway) {
        messageType = 'giveaway';
        isSystem = 1;
      }

      db.run(`
        INSERT INTO bot_messages (guild_id, channel_id, message_id, message_type, name, content, is_system)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [guildId, channelId, msg.id, messageType, name, JSON.stringify(content), isSystem]);

      registered++;
    }
  } catch {
    // Can't read channel — skip
  }

  return registered;
}

/**
 * Scan all text channels in a guild for untracked bot messages.
 * Throttled: delays between channels, caps total registered messages.
 */
async function scanAllChannels(client, guildId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return 0;

  let total = 0;
  const channels = guild.channels.cache.filter(c => c.type === 0);

  for (const [, channel] of channels) {
    if (total >= MAX_TOTAL_REGISTERED) break;

    const count = await scanChannel(client, guildId, channel.id, MAX_TOTAL_REGISTERED - total);
    total += count;

    // Throttle: small delay between channels to avoid rate limits
    if (CHANNEL_SCAN_DELAY_MS > 0) {
      await new Promise(r => setTimeout(r, CHANNEL_SCAN_DELAY_MS));
    }
  }

  if (total > 0) {
    console.log(`Scanned and registered ${total} bot message(s) for guild ${guild.name}`);
  }

  return total;
}

module.exports = {
  getTemplates,
  getMessagesForGuild,
  getMessage,
  createMessage,
  updateMessage,
  deleteMessage,
  buildMessagePayload,
  publishMessage,
  updatePublishedMessage,
  unpublishMessage,
  scanChannel,
  scanAllChannels,
};
