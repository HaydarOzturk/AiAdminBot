const { Events } = require('discord.js');
const { createEmbed } = require('../utils/embedBuilder');
const { t } = require('../utils/locale');
const { config } = require('../utils/permissions');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    // Ignore bots, DMs, and system messages
    if (message.author.bot) return;
    if (!message.guild) return;

    // ── XP / Leveling ─────────────────────────────────────────────────────
    const leveling = require('../systems/leveling');

    try {
      const result = await leveling.processMessage(message);

      if (result) {
        // User leveled up!
        const levelUpChannelName = config.leveling?.levelUpChannelName;
        const targetChannel = levelUpChannelName
          ? message.guild.channels.cache.find(c => c.name === levelUpChannelName)
          : message.channel;

        if (targetChannel) {
          const description = result.tierChanged
            ? t('leveling.levelUpTierDesc', { user: message.author.username, level: result.newLevel, tier: result.tier.name })
            : t('leveling.levelUpDesc', { user: message.author.username, level: result.newLevel });

          const embed = createEmbed({
            title: t('leveling.levelUp'),
            description,
            color: result.tier?.color ? undefined : 'success',
            fields: [
              { name: t('leveling.level'), value: `${result.newLevel}`, inline: true },
              { name: t('leveling.tier'), value: result.tier?.name || '-', inline: true },
            ],
            thumbnail: message.author.displayAvatarURL({ dynamic: true, size: 128 }),
            timestamp: true,
          });

          // Override color with tier color if available
          if (result.tier?.color) {
            const { EmbedBuilder } = require('discord.js');
            embed.setColor(result.tier.color);
          }

          await targetChannel.send({ embeds: [embed] });
        }

        // Update tier role if tier changed
        if (result.tierChanged && result.tier) {
          const member = await message.guild.members.fetch(message.author.id).catch(() => null);
          if (member) {
            await leveling.updateTierRole(member, result.tier);
          }
        }
      }
    } catch (error) {
      console.error('❌ Leveling error:', error.message);
    }

    // ── AI Setup Interview (follow-up messages) ──────────────────────────
    try {
      const aiSetup = require('../systems/aiSetup');
      if (aiSetup.hasActiveSession(message.guild.id)) {
        const handled = await aiSetup.handleMessage(message);
        if (handled) return; // Don't process further if this was an interview message
      }
    } catch (error) {
      console.error('❌ AI setup error:', error.message);
    }

    // ── AI Smart Moderation ──────────────────────────────────────────────
    try {
      const aiModeration = require('../systems/aiModeration');
      await aiModeration.checkMessage(message);
    } catch (error) {
      console.error('❌ AI moderation error:', error.message);
    }

    // ── AI Chat Assistant ────────────────────────────────────────────────
    try {
      const { getAllAiChatNames } = require('../utils/locale');
      const aiChatNames = getAllAiChatNames();

      if (aiChatNames.has(message.channel.name)) {
        const aiChat = require('../systems/aiChat');
        await aiChat.handleMessage(message);
      }
    } catch (error) {
      console.error('❌ AI chat error:', error.message);
    }
  },
};
