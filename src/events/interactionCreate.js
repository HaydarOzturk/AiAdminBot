const { Events, MessageFlags } = require('discord.js');
const { t } = require('../utils/locale');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
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

        const errorMsg = { content: t('general.error'), flags: MessageFlags.Ephemeral };

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorMsg);
        } else {
          await interaction.reply(errorMsg);
        }
      }
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
    }
  },
};
