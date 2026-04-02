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

    const g = message.guild?.id;

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
            ? t('leveling.levelUpTierDesc', { user: message.author.username, level: result.newLevel, tier: result.tier.name }, g)
            : t('leveling.levelUpDesc', { user: message.author.username, level: result.newLevel }, g);

          const embed = createEmbed({
            title: t('leveling.levelUp', {}, g),
            description,
            color: result.tier?.color ? undefined : 'success',
            fields: [
              { name: t('leveling.level', {}, g), value: `${result.newLevel}`, inline: true },
              { name: t('leveling.tier', {}, g), value: result.tier?.name || '-', inline: true },
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

    // ── AI Admin Agent ──────────────────────────────────────────────────
    try {
      const agent = require('../agent');
      const handled = await agent.handleMessage(message);
      if (handled) return; // Agent handled the message — stop processing
    } catch (error) {
      console.error('❌ AI Agent error:', error.message);
    }

    // ── Custom Commands ────────────────────────────────────────────────
    try {
      const customCommands = require('../systems/customCommands');
      const handled = await customCommands.checkMessage(message);
      if (handled) return; // Custom command was triggered — stop processing
    } catch (error) {
      console.error('❌ Custom commands error:', error.message);
    }

    // ── Advanced Auto-Moderation ────────────────────────────────────────
    try {
      const automod = require('../systems/automod');
      const blocked = await automod.checkMessage(message);
      if (blocked) return; // Message was deleted by automod — stop processing
    } catch (error) {
      console.error('❌ AutoMod error:', error.message);
    }

    // ── Link Filter ─────────────────────────────────────────────────────
    try {
      const linkFilter = require('../systems/linkFilter');
      const blocked = await linkFilter.checkMessage(message);
      if (blocked) return; // Message was deleted — stop processing
    } catch (error) {
      console.error('❌ Link filter error:', error.message);
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

    // ── Message Logging for Knowledge System ─────────────────────────────
    try {
      const knowledgeBase = require('../systems/knowledgeBase');
      knowledgeBase.logMessage(message);
    } catch {
      // Silent fail — logging should never block message flow
    }
  },
};
