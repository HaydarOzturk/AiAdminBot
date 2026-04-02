/**
 * Starboard System
 *
 * When a message gets enough star reactions, it's posted to #starboard channel.
 * Configurable threshold per guild.
 */

const db = require('../utils/database');
const { createEmbed } = require('../utils/embedBuilder');
const { t, channelName } = require('../utils/locale');
const { chat, isConfigured } = require('../utils/openrouter');

const DEFAULT_EMOJI = '⭐';
const DEFAULT_THRESHOLD = 3;

function getStarboardSettings(guildId) {
  const row = db.get('SELECT * FROM starboard_settings WHERE guild_id = ?', [guildId]);
  if (!row) return null;
  return {
    enabled: !!row.enabled,
    channelId: row.channel_id,
    threshold: row.threshold || DEFAULT_THRESHOLD,
    emoji: row.emoji || DEFAULT_EMOJI,
    selfStar: !!row.self_star,
  };
}

/**
 * Handle a reaction add event for starboard
 * @param {import('discord.js').MessageReaction} reaction
 * @param {import('discord.js').User} user
 */
async function handleReaction(reaction, user) {
  if (!reaction.message.guild) return;
  if (user.bot) return;

  const guildId = reaction.message.guild.id;
  const settings = getStarboardSettings(guildId);
  if (!settings || !settings.enabled) return;

  // Check if it's the star emoji
  const emojiName = reaction.emoji.name;
  if (emojiName !== settings.emoji) return;

  // Prevent self-starring
  if (!settings.selfStar && reaction.message.author.id === user.id) return;

  // Fetch full message and reaction count
  const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
  const starReaction = message.reactions.cache.get(settings.emoji);
  if (!starReaction) return;

  const count = starReaction.count;

  // Check threshold
  if (count < settings.threshold) return;

  // Find starboard channel
  const starChannel = settings.channelId
    ? message.guild.channels.cache.get(settings.channelId)
    : message.guild.channels.cache.find(c => c.name === channelName('starboard', guildId));

  if (!starChannel) return;

  // Check if already posted
  const existing = db.get(
    'SELECT starboard_message_id FROM starboard_entries WHERE guild_id = ? AND original_message_id = ?',
    [guildId, message.id]
  );

  const starText = `${settings.emoji} **${count}** | <#${message.channel.id}>`;

  const embed = createEmbed({
    color: 'warning',
    fields: [],
    timestamp: true,
  });

  embed.setAuthor({
    name: message.author.tag,
    iconURL: message.author.displayAvatarURL({ size: 64 }),
  });

  if (message.content) {
    embed.setDescription(message.content.slice(0, 4096));
  }

  // Add image if present
  const attachment = message.attachments.first();
  if (attachment && attachment.contentType?.startsWith('image/')) {
    embed.setImage(attachment.url);
  }

  embed.addFields({ name: 'Source', value: `[Jump to message](${message.url})`, inline: false });

  // Add AI commentary for new entries
  const isNewEntry = !existing || !existing.starboard_message_id;
  if (isNewEntry && message.content) {
    const aiComment = await aiStarComment(message.content, count);
    if (aiComment) {
      embed.addFields({ name: '🤖 AI says', value: aiComment, inline: false });
    }
  }

  if (existing && existing.starboard_message_id) {
    // Update existing starboard message
    try {
      const starMsg = await starChannel.messages.fetch(existing.starboard_message_id);
      await starMsg.edit({ content: starText, embeds: [embed] });
    } catch {
      // Message was deleted, re-post
      const newMsg = await starChannel.send({ content: starText, embeds: [embed] });
      db.run(
        'UPDATE starboard_entries SET starboard_message_id = ?, star_count = ? WHERE guild_id = ? AND original_message_id = ?',
        [newMsg.id, count, guildId, message.id]
      );
    }
  } else {
    // Post new starboard entry
    const newMsg = await starChannel.send({ content: starText, embeds: [embed] });
    db.run(
      `INSERT INTO starboard_entries (guild_id, original_message_id, starboard_message_id, channel_id, author_id, star_count)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, original_message_id) DO UPDATE SET starboard_message_id = ?, star_count = ?`,
      [guildId, message.id, newMsg.id, message.channel.id, message.author.id, count, newMsg.id, count]
    );
  }
}

/**
 * AI-generated witty commentary for a starred message
 * @param {string} messageContent
 * @param {number} starCount
 * @returns {Promise<string|null>}
 */
async function aiStarComment(messageContent, starCount) {
  if (!isConfigured() || !messageContent) return null;

  try {
    const result = await chat(
      [{ role: 'user', content: `This Discord message got ${starCount} stars:\n"${messageContent.slice(0, 300)}"` }],
      {
        systemPrompt: 'You write witty, brief one-liner reactions to starred Discord messages (like a funny host). Keep under 100 chars. Use 1-2 emojis max. Match the message language. Be clever, not mean.',
        maxTokens: 60,
        temperature: 0.9,
      }
    );
    return result.slice(0, 100);
  } catch {
    return null;
  }
}

module.exports = { handleReaction, getStarboardSettings, aiStarComment };
