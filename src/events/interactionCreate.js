const { Events, MessageFlags } = require('discord.js');
const { t } = require('../utils/locale');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    const g = interaction.guild?.id;

    // Handle slash commands
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);

      if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`Error executing /${interaction.commandName}:`, error);

        const errorMsg = { content: t('general.error', {}, g), flags: MessageFlags.Ephemeral };

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorMsg);
        } else {
          await interaction.reply(errorMsg);
        }
      }
    }

    // Handle autocomplete
    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (command?.autocomplete) {
        try {
          await command.autocomplete(interaction);
        } catch (error) {
          console.error(`Autocomplete error for /${interaction.commandName}:`, error);
        }
      }
      return;
    }

    // Handle button interactions
    if (interaction.isButton()) {
      // Verification button
      if (interaction.customId === 'verify_button') {
        const verification = require('../systems/verification');
        await verification.handleVerifyButton(interaction);
        return;
      }

      // Role menu buttons (start with "role_")
      if (interaction.customId.startsWith('role_')) {
        const roleMenus = require('../systems/roleMenus');
        await roleMenus.handleRoleButton(interaction);
        return;
      }

      // Poll vote buttons (start with "poll_vote_")
      if (interaction.customId.startsWith('poll_vote_')) {
        try {
          const polls = require('../systems/polls');
          await polls.handleVote(interaction);
        } catch (error) {
          console.error('Poll vote error:', error.message);
        }
        return;
      }

      // Agent confirmation buttons
      if (interaction.customId.startsWith('agent_confirm_') || interaction.customId.startsWith('agent_cancel_')) {
        try {
          const { handleConfirmation } = require('../agent');
          await handleConfirmation(interaction);
        } catch (error) {
          console.error('Agent confirmation error:', error.message);
        }
        return;
      }

      // Giveaway entry button
      if (interaction.customId === 'giveaway_enter') {
        try {
          const giveaway = require('../systems/giveaway');
          await giveaway.handleEntry(interaction);
        } catch (error) {
          console.error('Giveaway entry error:', error.message);
        }
        return;
      }
    }
  },
};
