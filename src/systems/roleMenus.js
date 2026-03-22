const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { createEmbed } = require('../utils/embedBuilder');
const fs = require('fs');
const path = require('path');

/**
 * Load role menu config from file
 * @returns {object} Role menu configuration
 */
function loadRoleMenuConfig() {
  const configPath = path.join(__dirname, '..', '..', 'config', 'role-menus.json');
  const examplePath = path.join(__dirname, '..', '..', 'config', 'role-menus.example.json');

  const filePath = fs.existsSync(configPath) ? configPath : examplePath;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Ensure a role exists in the guild, create it if not
 * @param {import('discord.js').Guild} guild
 * @param {string} roleName
 * @param {string} color - Hex color
 * @returns {import('discord.js').Role}
 */
async function ensureRole(guild, roleName, color) {
  let role = guild.roles.cache.find(r => r.name === roleName);

  if (!role) {
    role = await guild.roles.create({
      name: roleName,
      colors: { primaryColor: color || '#99aab5' },
      reason: 'Auto-created by AdminBot role menu',
    });
    console.log(`  ✅ Created role: ${roleName}`);
  }

  return role;
}

/**
 * Send a role menu embed with buttons to a channel
 * @param {import('discord.js').TextChannel} channel
 * @param {string} menuType - 'gameRoles', 'platformRoles', or 'colorRoles'
 */
async function sendRoleMenu(channel, menuType) {
  const config = loadRoleMenuConfig();
  const menu = config[menuType];

  if (!menu) {
    throw new Error(`Unknown menu type: ${menuType}`);
  }

  // Ensure all roles exist
  for (const roleConfig of menu.roles) {
    await ensureRole(channel.guild, roleConfig.name, roleConfig.color);
  }

  // Build embed
  const roleList = menu.roles.map(r => `${r.emoji} **${r.name}**`).join('\n');
  const embed = createEmbed({
    title: menu.title,
    description: `${menu.description}\n\n${roleList}`,
    color: 'primary',
  });

  // Build button rows (max 5 buttons per row, max 5 rows)
  const rows = [];
  let currentRow = new ActionRowBuilder();

  for (let i = 0; i < menu.roles.length; i++) {
    const roleConfig = menu.roles[i];

    const button = new ButtonBuilder()
      .setCustomId(`role_${menuType}_${roleConfig.name}`)
      .setLabel(roleConfig.name)
      .setStyle(ButtonStyle.Secondary);

    // Add emoji if it's a standard emoji (not custom)
    if (roleConfig.emoji) {
      button.setEmoji(roleConfig.emoji);
    }

    currentRow.addComponents(button);

    // Discord allows max 5 buttons per row
    if ((i + 1) % 5 === 0 || i === menu.roles.length - 1) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
  }

  await channel.send({ embeds: [embed], components: rows });
}

/**
 * Handle a role menu button click
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleRoleButton(interaction) {
  const customId = interaction.customId; // e.g. "role_gameRoles_GTA V"
  const parts = customId.split('_');
  const menuType = parts[1];
  const roleName = parts.slice(2).join('_'); // Handle role names with underscores

  const config = loadRoleMenuConfig();
  const menu = config[menuType];

  if (!menu) {
    return interaction.reply({ content: '❌ Menu not found.', flags: MessageFlags.Ephemeral });
  }

  const member = interaction.member;
  const guild = interaction.guild;

  // Find the role
  const role = guild.roles.cache.find(r => r.name === roleName);
  if (!role) {
    return interaction.reply({
      content: `❌ Role "${roleName}" not found. An admin should run /role-menu again.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    // Check if this is a single-select menu (like color roles)
    if (menu.singleSelect) {
      // Remove all other roles from this menu first
      const menuRoleNames = menu.roles.map(r => r.name);
      const rolesToRemove = member.roles.cache.filter(r => menuRoleNames.includes(r.name));

      for (const [, existingRole] of rolesToRemove) {
        await member.roles.remove(existingRole);
      }

      // If they clicked the same role they had, just remove it (toggle off)
      if (rolesToRemove.has(role.id)) {
        return interaction.reply({
          content: `🔴 **${roleName}** role removed.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      // Add the new role
      await member.roles.add(role);
      return interaction.reply({
        content: `🟢 **${roleName}** role given! (Previous color role removed)`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Multi-select: toggle the role
    if (member.roles.cache.has(role.id)) {
      // Remove the role
      await member.roles.remove(role);
      return interaction.reply({
        content: `🔴 **${roleName}** role removed.`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      // Add the role
      await member.roles.add(role);
      return interaction.reply({
        content: `🟢 **${roleName}** role given!`,
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (error) {
    console.error(`❌ Failed to toggle role ${roleName}:`, error);
    return interaction.reply({
      content: '❌ Could not change role. Check bot permissions.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

module.exports = { sendRoleMenu, handleRoleButton, loadRoleMenuConfig };
