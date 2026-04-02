/**
 * Confirmation flow for destructive agent actions.
 * Uses Discord buttons for Yes/No confirmation.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createEmbed } = require('../utils/embedBuilder');
const { t } = require('../utils/locale');
const conversationStore = require('./conversationStore');

let _confirmationCounter = 0;

/**
 * Send a confirmation prompt for a destructive action.
 */
async function sendConfirmation(message, action, description) {
  const confirmId = `agent_confirm_${++_confirmationCounter}`;
  const cancelId = `agent_cancel_${_confirmationCounter}`;

  // Store pending action
  conversationStore.setPendingAction(message.guild.id, message.author.id, {
    ...action,
    confirmId,
    cancelId,
    expiresAt: Date.now() + 120000, // 2 minutes
  });

  const embed = createEmbed({
    title: t('agent.confirmTitle', {}, message.guild.id),
    description: description,
    color: 'warning',
    timestamp: true,
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(confirmId)
      .setLabel(t('agent.confirmYes', {}, message.guild.id))
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(cancelId)
      .setLabel(t('agent.confirmNo', {}, message.guild.id))
      .setStyle(ButtonStyle.Secondary),
  );

  await message.reply({ embeds: [embed], components: [row] });
}

/**
 * Handle a confirmation button click.
 */
async function handleConfirmation(interaction) {
  const isConfirm = interaction.customId.startsWith('agent_confirm_');
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  const pending = conversationStore.getPendingAction(guildId, userId);
  if (!pending) {
    return interaction.reply({ content: t('agent.confirmExpired', {}, guildId), ephemeral: true });
  }

  // Verify this is the right button
  if (pending.confirmId !== interaction.customId && pending.cancelId !== interaction.customId) {
    return interaction.reply({ content: t('agent.confirmNotYours', {}, guildId), ephemeral: true });
  }

  // Check expiry
  if (Date.now() > pending.expiresAt) {
    conversationStore.clearPendingAction(guildId, userId);
    return interaction.reply({ content: t('agent.confirmExpired', {}, guildId), ephemeral: true });
  }

  conversationStore.clearPendingAction(guildId, userId);

  if (!isConfirm) {
    // Remove buttons
    await interaction.update({ components: [] });
    await interaction.followUp({ content: t('agent.confirmCancelled', {}, guildId) });
    return;
  }

  // Execute the action
  await interaction.update({ components: [] });

  try {
    const { getTool } = require('./toolRegistry');
    const tool = getTool(pending.tool);
    if (!tool) {
      return interaction.followUp({ content: t('agent.toolNotFound', {}, guildId) });
    }

    const result = await tool.execute(interaction.guild, interaction.member, pending.params);

    const embed = createEmbed({
      title: result.success ? '✅ ' + t('agent.actionCompleted', {}, guildId) : '❌ ' + t('agent.actionFailed', {}, guildId),
      description: result.message,
      color: result.success ? 'success' : 'danger',
      timestamp: true,
    });

    await interaction.followUp({ embeds: [embed] });

    // Save to conversation
    conversationStore.addMessage(guildId, userId, 'assistant', `Action completed: ${result.message}`);
  } catch (err) {
    console.error('Agent confirmation execution error:', err.message);
    await interaction.followUp({ content: `Error: ${err.message}` });
  }
}

module.exports = { sendConfirmation, handleConfirmation };
