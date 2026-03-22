const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { sendRoleMenu } = require('../../systems/roleMenus');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('role-menu')
    .setDescription('Send a role selection menu to this channel (Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option
        .setName('menu')
        .setDescription('Which role menu would you like to send?')
        .setRequired(true)
        .addChoices(
          { name: '🎮 Game Roles', value: 'gameRoles' },
          { name: '📺 Platform Roles', value: 'platformRoles' },
          { name: '🌈 Color Roles', value: 'colorRoles' },
          { name: '📦 Send All', value: 'all' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const menuType = interaction.options.getString('menu');

    try {
      if (menuType === 'all') {
        await sendRoleMenu(interaction.channel, 'gameRoles');
        await sendRoleMenu(interaction.channel, 'platformRoles');
        await sendRoleMenu(interaction.channel, 'colorRoles');
        await interaction.editReply({
          content: '✅ All role menus sent! (Game + Platform + Color)',
        });
      } else {
        await sendRoleMenu(interaction.channel, menuType);
        await interaction.editReply({
          content: `✅ Role menu sent!`,
        });
      }
    } catch (error) {
      console.error('Failed to send role menu:', error);
      await interaction.editReply({
        content: '❌ Could not send role menu. Error: ' + error.message,
      });
    }
  },
};
