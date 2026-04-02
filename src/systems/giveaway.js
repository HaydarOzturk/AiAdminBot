/**
 * Giveaway System
 *
 * Create timed giveaways with button entry.
 * Auto-selects winner(s) when time expires.
 * Supports re-rolling winners.
 */

const db = require('../utils/database');
const { createEmbed } = require('../utils/embedBuilder');
const { t } = require('../utils/locale');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { chat, isConfigured } = require('../utils/openrouter');

// Active giveaway timers: giveawayId -> timeout
const giveawayTimers = new Map();

/**
 * Create a new giveaway
 */
async function createGiveaway(interaction, prize, durationMinutes, winnerCount = 1) {
  const g = interaction.guild.id;
  const endsAt = new Date(Date.now() + durationMinutes * 60000);

  const embed = createEmbed({
    title: '🎉 ' + t('giveaway.title', {}, g),
    description: `**${prize}**\n\n${t('giveaway.clickToEnter', {}, g)}\n${t('giveaway.endsAt', { time: `<t:${Math.floor(endsAt.getTime() / 1000)}:R>` }, g)}\n\n${t('giveaway.hostedBy', { user: `<@${interaction.user.id}>` }, g)}`,
    color: 'purple',
    timestamp: true,
  });

  embed.setFooter({ text: `${winnerCount} winner(s) • 0 entries` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('giveaway_enter')
      .setLabel(t('giveaway.enterButton', {}, g))
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Primary)
  );

  const reply = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

  db.run(
    `INSERT INTO giveaways (guild_id, channel_id, message_id, creator_id, prize, winner_count, ends_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [g, interaction.channel.id, reply.id, interaction.user.id, prize, winnerCount, endsAt.toISOString()]
  );

  const timer = setTimeout(() => endGiveaway(reply.id, g, interaction.client), durationMinutes * 60000);
  giveawayTimers.set(reply.id, timer);
}

/**
 * Handle giveaway entry button
 */
async function handleEntry(interaction) {
  const messageId = interaction.message.id;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  const giveaway = db.get(
    'SELECT * FROM giveaways WHERE message_id = ? AND guild_id = ?',
    [messageId, guildId]
  );

  if (!giveaway || giveaway.ended) {
    return interaction.reply({ content: t('giveaway.alreadyEnded', {}, guildId), ephemeral: true });
  }

  // Check if already entered
  const existing = db.get(
    'SELECT * FROM giveaway_entries WHERE giveaway_message_id = ? AND user_id = ?',
    [messageId, userId]
  );

  if (existing) {
    // Remove entry
    db.run('DELETE FROM giveaway_entries WHERE giveaway_message_id = ? AND user_id = ?', [messageId, userId]);
    const count = db.get('SELECT COUNT(*) as count FROM giveaway_entries WHERE giveaway_message_id = ?', [messageId]);
    await updateGiveawayEmbed(interaction.message, giveaway, count?.count || 0);
    return interaction.reply({ content: t('giveaway.entryRemoved', {}, guildId), ephemeral: true });
  }

  // Add entry
  db.run(
    'INSERT INTO giveaway_entries (giveaway_message_id, user_id) VALUES (?, ?)',
    [messageId, userId]
  );

  const count = db.get('SELECT COUNT(*) as count FROM giveaway_entries WHERE giveaway_message_id = ?', [messageId]);
  await updateGiveawayEmbed(interaction.message, giveaway, count?.count || 0);
  return interaction.reply({ content: t('giveaway.entryAdded', {}, guildId), ephemeral: true });
}

async function updateGiveawayEmbed(message, giveaway, entryCount) {
  const endsAtTimestamp = Math.floor(new Date(giveaway.ends_at).getTime() / 1000);

  const embed = createEmbed({
    title: '🎉 ' + t('giveaway.title', {}, giveaway.guild_id),
    description: `**${giveaway.prize}**\n\n${t('giveaway.clickToEnter', {}, giveaway.guild_id)}\n${t('giveaway.endsAt', { time: `<t:${endsAtTimestamp}:R>` }, giveaway.guild_id)}\n\n${t('giveaway.hostedBy', { user: `<@${giveaway.creator_id}>` }, giveaway.guild_id)}`,
    color: 'purple',
    timestamp: true,
  });

  embed.setFooter({ text: `${giveaway.winner_count} winner(s) • ${entryCount} entries` });

  try {
    await message.edit({ embeds: [embed] });
  } catch {}
}

/**
 * End a giveaway and pick winners
 */
async function endGiveaway(messageId, guildId, client) {
  const giveaway = db.get('SELECT * FROM giveaways WHERE message_id = ? AND guild_id = ?', [messageId, guildId]);
  if (!giveaway || giveaway.ended) return;

  db.run('UPDATE giveaways SET ended = 1 WHERE message_id = ? AND guild_id = ?', [messageId, guildId]);

  const entries = db.all('SELECT user_id FROM giveaway_entries WHERE giveaway_message_id = ?', [messageId]);

  try {
    const channel = client.channels.cache.get(giveaway.channel_id);
    if (!channel) return;
    const message = await channel.messages.fetch(messageId);

    const winners = pickWinners(entries.map(e => e.user_id), giveaway.winner_count);

    const winnerText = winners.length > 0
      ? winners.map(id => `<@${id}>`).join(', ')
      : t('giveaway.noEntries', {}, guildId);

    const embed = createEmbed({
      title: '🎉 ' + t('giveaway.ended', {}, guildId),
      description: `**${giveaway.prize}**\n\n**${t('giveaway.winners', {}, guildId)}:** ${winnerText}`,
      color: 'info',
      timestamp: true,
    });

    embed.setFooter({ text: `${entries.length} entries` });

    await message.edit({ embeds: [embed], components: [] });

    // Announce winners
    if (winners.length > 0) {
      await channel.send({
        content: `🎉 ${t('giveaway.congratulations', {}, guildId)} ${winnerText}! ${t('giveaway.wonPrize', { prize: giveaway.prize }, guildId)}`,
      });
    }
  } catch (err) {
    console.error('Failed to end giveaway:', err.message);
  }

  giveawayTimers.delete(messageId);
}

function pickWinners(userIds, count) {
  const shuffled = [...userIds].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * Re-roll giveaway winners
 */
async function rerollGiveaway(messageId, guildId, client) {
  const giveaway = db.get('SELECT * FROM giveaways WHERE message_id = ? AND guild_id = ?', [messageId, guildId]);
  if (!giveaway) return null;

  const entries = db.all('SELECT user_id FROM giveaway_entries WHERE giveaway_message_id = ?', [messageId]);
  if (entries.length === 0) return [];

  return pickWinners(entries.map(e => e.user_id), giveaway.winner_count);
}

/**
 * Restore timers for active giveaways on bot restart
 */
function restoreGiveawayTimers(client) {
  const active = db.all('SELECT * FROM giveaways WHERE ended = 0 AND ends_at IS NOT NULL');
  let restored = 0;

  for (const giveaway of active) {
    const remaining = new Date(giveaway.ends_at).getTime() - Date.now();
    if (remaining <= 0) {
      // Already expired, end it now
      endGiveaway(giveaway.message_id, giveaway.guild_id, client);
    } else {
      const timer = setTimeout(() => endGiveaway(giveaway.message_id, giveaway.guild_id, client), remaining);
      giveawayTimers.set(giveaway.message_id, timer);
      restored++;
    }
  }

  if (restored > 0) console.log(`🎉 Restored ${restored} active giveaway timers`);
}

/**
 * AI-generated hype description for a giveaway prize
 * @param {string} prize
 * @returns {Promise<string|null>}
 */
async function aiHypeDescription(prize) {
  if (!isConfigured()) return null;

  try {
    const result = await chat(
      [{ role: 'user', content: `Write a short, exciting giveaway description for this prize: "${prize}"` }],
      {
        systemPrompt: 'You write brief, exciting Discord giveaway descriptions (2-3 sentences max, under 200 chars). Use emojis. Be hype but not cringe. Match the prize language.',
        maxTokens: 100,
        temperature: 0.9,
      }
    );
    return result.slice(0, 200);
  } catch {
    return null;
  }
}

/**
 * AI-generated congratulations message for winners
 * @param {string} prize
 * @param {string[]} winnerMentions
 * @returns {Promise<string|null>}
 */
async function aiCongratulations(prize, winnerMentions) {
  if (!isConfigured()) return null;

  try {
    return await chat(
      [{ role: 'user', content: `Winners: ${winnerMentions.join(', ')} just won "${prize}"!` }],
      {
        systemPrompt: 'Write a fun, creative 1-sentence congratulations for giveaway winners. Use emojis. Keep under 150 chars. Be enthusiastic!',
        maxTokens: 80,
        temperature: 0.9,
      }
    );
  } catch {
    return null;
  }
}

module.exports = { createGiveaway, handleEntry, endGiveaway, rerollGiveaway, restoreGiveawayTimers, aiHypeDescription, aiCongratulations };
