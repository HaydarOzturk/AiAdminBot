/**
 * Poll System
 *
 * Create polls with up to 10 options. Users vote via buttons.
 * Supports timed polls that auto-close and show results.
 */

const db = require('../utils/database');
const { createEmbed } = require('../utils/embedBuilder');
const { t } = require('../utils/locale');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { chat, isConfigured } = require('../utils/openrouter');

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

// Active poll timers: pollId -> timeout
const pollTimers = new Map();

/**
 * Create a new poll
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {string} question
 * @param {string[]} options
 * @param {number} durationMinutes - 0 for no time limit
 */
async function createPoll(interaction, question, options, durationMinutes = 0) {
  const g = interaction.guild.id;

  const embed = createEmbed({
    title: `📊 ${question}`,
    color: 'primary',
    timestamp: true,
  });

  const optionLines = options.map((opt, i) => `${NUMBER_EMOJIS[i]} ${opt} — **0** votes`);
  embed.setDescription(optionLines.join('\n'));

  if (durationMinutes > 0) {
    const endsAt = new Date(Date.now() + durationMinutes * 60000);
    embed.setFooter({ text: `Ends at ${endsAt.toLocaleTimeString()} • 0 total votes` });
  } else {
    embed.setFooter({ text: '0 total votes' });
  }

  // Build button rows (max 5 per row, max 2 rows = 10 options)
  const rows = [];
  for (let i = 0; i < options.length; i += 5) {
    const row = new ActionRowBuilder();
    const chunk = options.slice(i, i + 5);
    chunk.forEach((opt, j) => {
      const idx = i + j;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`poll_vote_${idx}`)
          .setLabel(opt.slice(0, 80))
          .setEmoji(NUMBER_EMOJIS[idx])
          .setStyle(ButtonStyle.Secondary)
      );
    });
    rows.push(row);
  }

  const reply = await interaction.reply({ embeds: [embed], components: rows, fetchReply: true });

  // Save to DB
  const endsAt = durationMinutes > 0 ? new Date(Date.now() + durationMinutes * 60000).toISOString() : null;
  db.run(
    `INSERT INTO polls (guild_id, channel_id, message_id, creator_id, question, options, ends_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [g, interaction.channel.id, reply.id, interaction.user.id, question, JSON.stringify(options), endsAt]
  );

  // Set timer if timed
  if (durationMinutes > 0) {
    const timer = setTimeout(() => closePoll(reply.id, g, interaction.client), durationMinutes * 60000);
    pollTimers.set(reply.id, timer);
  }
}

/**
 * Handle a vote button press
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleVote(interaction) {
  const optionIndex = parseInt(interaction.customId.replace('poll_vote_', ''));
  const messageId = interaction.message.id;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  const poll = db.get(
    'SELECT * FROM polls WHERE message_id = ? AND guild_id = ?',
    [messageId, guildId]
  );

  if (!poll || poll.closed) {
    return interaction.reply({ content: t('polls.closed', {}, guildId), ephemeral: true });
  }

  // Check if already voted
  const existingVote = db.get(
    'SELECT * FROM poll_votes WHERE poll_message_id = ? AND user_id = ?',
    [messageId, userId]
  );

  if (existingVote) {
    if (existingVote.option_index === optionIndex) {
      // Remove vote
      db.run('DELETE FROM poll_votes WHERE poll_message_id = ? AND user_id = ?', [messageId, userId]);
      await interaction.reply({ content: t('polls.voteRemoved', {}, guildId), ephemeral: true });
    } else {
      // Change vote
      db.run(
        'UPDATE poll_votes SET option_index = ? WHERE poll_message_id = ? AND user_id = ?',
        [optionIndex, messageId, userId]
      );
      await interaction.reply({ content: t('polls.voteChanged', {}, guildId), ephemeral: true });
    }
  } else {
    // New vote
    db.run(
      'INSERT INTO poll_votes (poll_message_id, user_id, option_index) VALUES (?, ?, ?)',
      [messageId, userId, optionIndex]
    );
    await interaction.reply({ content: t('polls.voteRecorded', {}, guildId), ephemeral: true });
  }

  // Update embed with new counts
  await updatePollEmbed(interaction.message, poll);
}

async function updatePollEmbed(message, poll) {
  const options = JSON.parse(poll.options);
  const votes = db.all(
    'SELECT option_index, COUNT(*) as count FROM poll_votes WHERE poll_message_id = ? GROUP BY option_index',
    [poll.message_id]
  );

  const totalVotes = db.get(
    'SELECT COUNT(*) as total FROM poll_votes WHERE poll_message_id = ?',
    [poll.message_id]
  );
  const total = totalVotes?.total || 0;

  const voteCounts = {};
  for (const v of votes) voteCounts[v.option_index] = v.count;

  const optionLines = options.map((opt, i) => {
    const count = voteCounts[i] || 0;
    const bar = total > 0 ? '█'.repeat(Math.round((count / total) * 10)) : '';
    const percent = total > 0 ? Math.round((count / total) * 100) : 0;
    return `${NUMBER_EMOJIS[i]} ${opt} — **${count}** votes ${bar} ${percent}%`;
  });

  const embed = createEmbed({
    title: `📊 ${poll.question}`,
    color: 'primary',
    timestamp: true,
  });
  embed.setDescription(optionLines.join('\n'));
  embed.setFooter({ text: `${total} total votes` });

  try {
    await message.edit({ embeds: [embed] });
  } catch {}
}

async function closePoll(messageId, guildId, client) {
  db.run('UPDATE polls SET closed = 1 WHERE message_id = ? AND guild_id = ?', [messageId, guildId]);

  const poll = db.get('SELECT * FROM polls WHERE message_id = ? AND guild_id = ?', [messageId, guildId]);
  if (!poll) return;

  try {
    const channel = client.channels.cache.get(poll.channel_id);
    if (!channel) return;
    const message = await channel.messages.fetch(messageId);

    // Update embed with final results
    await updatePollEmbed(message, poll);

    // Remove buttons
    await message.edit({ components: [] });
  } catch {}

  pollTimers.delete(messageId);
}

/**
 * AI-generated poll suggestions based on a topic
 * @param {string} topic - General topic or question
 * @param {string} guildId - For locale
 * @returns {Promise<{question: string, options: string[]}|null>}
 */
async function aiSuggestPoll(topic) {
  if (!isConfigured()) return null;

  try {
    const result = await chat(
      [{ role: 'user', content: `Create a Discord poll about: "${topic}"` }],
      {
        systemPrompt: `You generate engaging Discord poll questions and options. Respond ONLY in JSON:
{"question": "The poll question?", "options": ["Option 1", "Option 2", "Option 3", "Option 4"]}

Rules:
- Question should be engaging and clear
- 3-5 options, each under 80 characters
- Options should be distinct and cover the range of opinions
- Match the language of the topic`,
        maxTokens: 256,
        temperature: 0.8,
      }
    );

    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

/**
 * AI-generated summary of poll results
 * @param {string} question
 * @param {Array} results - [{option, count}]
 * @param {number} totalVotes
 * @returns {Promise<string|null>}
 */
async function aiSummarizePoll(question, results, totalVotes) {
  if (!isConfigured() || totalVotes < 3) return null;

  try {
    const resultText = results.map(r => `"${r.option}": ${r.count} votes (${Math.round(r.count / totalVotes * 100)}%)`).join('\n');

    return await chat(
      [{ role: 'user', content: `Poll: "${question}"\nResults (${totalVotes} total votes):\n${resultText}` }],
      {
        systemPrompt: 'You write brief, fun 1-2 sentence summaries of Discord poll results. Be witty and engaging. Keep it under 200 characters.',
        maxTokens: 100,
        temperature: 0.9,
      }
    );
  } catch {
    return null;
  }
}

module.exports = { createPoll, handleVote, closePoll, aiSuggestPoll, aiSummarizePoll };
