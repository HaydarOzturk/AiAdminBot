const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const roleMenus = require('../../systems/roleMenus');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('publish-roles')
    .setDescription('Manage and publish self-assign role menus (Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

    // /publish-roles list
    .addSubcommand(sub =>
      sub.setName('list').setDescription('List all role menus for this server')
    )

    // /publish-roles publish <menu> [channel]
    .addSubcommand(sub =>
      sub.setName('publish').setDescription('Publish a role menu to a channel')
        .addStringOption(opt =>
          opt.setName('menu').setDescription('Which menu to publish').setRequired(true).setAutocomplete(true)
        )
        .addChannelOption(opt =>
          opt.setName('channel').setDescription('Channel to publish in (default: current)')
            .addChannelTypes(ChannelType.GuildText)
        )
    )

    // /publish-roles create <slug> <title>
    .addSubcommand(sub =>
      sub.setName('create').setDescription('Create a new role menu')
        .addStringOption(opt =>
          opt.setName('slug').setDescription('Unique identifier (no spaces, e.g. "game-roles")').setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('title').setDescription('Display title (e.g. "🎮 Game Roles")').setRequired(true)
        )
    )

    // /publish-roles edit <menu> [title] [description] [color] [single-select]
    .addSubcommand(sub =>
      sub.setName('edit').setDescription('Edit a role menu\'s settings')
        .addStringOption(opt =>
          opt.setName('menu').setDescription('Menu to edit').setRequired(true).setAutocomplete(true)
        )
        .addStringOption(opt =>
          opt.setName('title').setDescription('New title')
        )
        .addStringOption(opt =>
          opt.setName('description').setDescription('New description')
        )
        .addStringOption(opt =>
          opt.setName('color').setDescription('Embed color hex (e.g. #e74c3c)')
        )
        .addBooleanOption(opt =>
          opt.setName('single-select').setDescription('Only allow one role at a time?')
        )
    )

    // /publish-roles add-role <menu> <role-name> [emoji] [color]
    .addSubcommand(sub =>
      sub.setName('add-role').setDescription('Add a role to a menu')
        .addStringOption(opt =>
          opt.setName('menu').setDescription('Menu to add role to').setRequired(true).setAutocomplete(true)
        )
        .addStringOption(opt =>
          opt.setName('role-name').setDescription('Role name').setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('emoji').setDescription('Button emoji')
        )
        .addStringOption(opt =>
          opt.setName('color').setDescription('Role color hex (e.g. #e74c3c)')
        )
    )

    // /publish-roles remove-role <menu> <role-name>
    .addSubcommand(sub =>
      sub.setName('remove-role').setDescription('Remove a role from a menu')
        .addStringOption(opt =>
          opt.setName('menu').setDescription('Menu to remove role from').setRequired(true).setAutocomplete(true)
        )
        .addStringOption(opt =>
          opt.setName('role-name').setDescription('Role name to remove').setRequired(true)
        )
    )

    // /publish-roles set-requirement <menu> [role]
    .addSubcommand(sub =>
      sub.setName('set-requirement').setDescription('Set or clear a required role for a menu')
        .addStringOption(opt =>
          opt.setName('menu').setDescription('Menu to set requirement on').setRequired(true).setAutocomplete(true)
        )
        .addRoleOption(opt =>
          opt.setName('role').setDescription('Required role (leave empty to clear)')
        )
    )

    // /publish-roles delete <menu>
    .addSubcommand(sub =>
      sub.setName('delete').setDescription('Delete a role menu')
        .addStringOption(opt =>
          opt.setName('menu').setDescription('Menu to delete').setRequired(true).setAutocomplete(true)
        )
    ),

  async autocomplete(interaction) {
    const guildId = interaction.guild.id;
    const focused = interaction.options.getFocused().toLowerCase();
    const menus = roleMenus.getMenusForGuild(guildId);

    const choices = menus
      .filter(m => m.title.toLowerCase().includes(focused) || m.slug.toLowerCase().includes(focused))
      .slice(0, 25)
      .map(m => ({ name: `${m.title} (${m.slug})`, value: String(m.id) }));

    await interaction.respond(choices);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    switch (sub) {
      case 'list':
        return handleList(interaction, guildId);
      case 'publish':
        return handlePublish(interaction, guildId);
      case 'create':
        return handleCreate(interaction, guildId);
      case 'edit':
        return handleEdit(interaction, guildId);
      case 'add-role':
        return handleAddRole(interaction, guildId);
      case 'remove-role':
        return handleRemoveRole(interaction, guildId);
      case 'set-requirement':
        return handleSetRequirement(interaction, guildId);
      case 'delete':
        return handleDelete(interaction, guildId);
    }
  },
};

// ── Subcommand handlers ──────────────────────────────────────────────────

async function handleList(interaction, guildId) {
  const menus = roleMenus.getMenusForGuild(guildId);

  if (menus.length === 0) {
    return interaction.reply({
      content: '📋 No role menus found. Use `/publish-roles create` to make one, or role menus will be seeded from config on next restart.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = menus.map(m => {
    const badges = [];
    if (m.single_select) badges.push('single-select');
    if (m.required_role_id) badges.push('requires role');
    const badgeStr = badges.length ? ` [${badges.join(', ')}]` : '';
    return `• **${m.title}** (\`${m.slug}\`) — ${m.item_count} roles${badgeStr}`;
  });

  return interaction.reply({
    content: `📋 **Role Menus (${menus.length})**\n\n${lines.join('\n')}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handlePublish(interaction, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const menuId = parseInt(interaction.options.getString('menu'), 10);
  const channel = interaction.options.getChannel('channel') || interaction.channel;

  try {
    await roleMenus.sendRoleMenuById(channel, menuId);
    await interaction.editReply({ content: `✅ Role menu published in ${channel}!` });
  } catch (err) {
    await interaction.editReply({ content: `❌ Failed to publish: ${err.message}` });
  }
}

async function handleCreate(interaction, guildId) {
  const slug = interaction.options.getString('slug').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const title = interaction.options.getString('title');

  // Check if slug already exists
  if (roleMenus.getMenuBySlug(guildId, slug)) {
    return interaction.reply({
      content: `❌ A menu with slug \`${slug}\` already exists.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const menuId = roleMenus.createMenu(guildId, { slug, title });
  return interaction.reply({
    content: `✅ Menu **${title}** (\`${slug}\`) created! Now add roles with \`/publish-roles add-role\`.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleEdit(interaction, guildId) {
  const menuId = parseInt(interaction.options.getString('menu'), 10);
  const menu = roleMenus.getMenuWithItems(menuId);

  if (!menu || menu.guild_id !== guildId) {
    return interaction.reply({ content: '❌ Menu not found.', flags: MessageFlags.Ephemeral });
  }

  const fields = {};
  const title = interaction.options.getString('title');
  const description = interaction.options.getString('description');
  const color = interaction.options.getString('color');
  const singleSelect = interaction.options.getBoolean('single-select');

  if (title != null) fields.title = title;
  if (description != null) fields.description = description;
  if (color != null) fields.color = color;
  if (singleSelect != null) fields.single_select = singleSelect ? 1 : 0;

  if (Object.keys(fields).length === 0) {
    return interaction.reply({ content: '❌ No changes specified.', flags: MessageFlags.Ephemeral });
  }

  roleMenus.updateMenu(menuId, fields);

  // Update published Discord messages in background
  roleMenus.updatePublishedMenus(interaction.client, guildId, menuId).catch(() => {});

  return interaction.reply({
    content: `✅ Menu **${menu.title}** updated! Published messages will be refreshed.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleAddRole(interaction, guildId) {
  const menuId = parseInt(interaction.options.getString('menu'), 10);
  const menu = roleMenus.getMenuWithItems(menuId);

  if (!menu || menu.guild_id !== guildId) {
    return interaction.reply({ content: '❌ Menu not found.', flags: MessageFlags.Ephemeral });
  }

  if (roleMenus.getMenuItemCount(menuId) >= 25) {
    return interaction.reply({ content: '❌ Maximum 25 roles per menu (Discord button limit).', flags: MessageFlags.Ephemeral });
  }

  const roleName = interaction.options.getString('role-name');
  const emoji = interaction.options.getString('emoji');
  const color = interaction.options.getString('color');

  // Check for duplicate
  if (menu.items.some(i => i.role_name.toLowerCase() === roleName.toLowerCase())) {
    return interaction.reply({ content: `❌ Role "${roleName}" already exists in this menu.`, flags: MessageFlags.Ephemeral });
  }

  await roleMenus.addMenuItem(menuId, { roleName, emoji, color });

  roleMenus.updatePublishedMenus(interaction.client, guildId, menuId).catch(() => {});

  return interaction.reply({
    content: `✅ Added **${roleName}** to **${menu.title}**. (${menu.items.length + 1} roles total)`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRemoveRole(interaction, guildId) {
  const menuId = parseInt(interaction.options.getString('menu'), 10);
  const menu = roleMenus.getMenuWithItems(menuId);

  if (!menu || menu.guild_id !== guildId) {
    return interaction.reply({ content: '❌ Menu not found.', flags: MessageFlags.Ephemeral });
  }

  const roleName = interaction.options.getString('role-name');
  const item = menu.items.find(i => i.role_name.toLowerCase() === roleName.toLowerCase());

  if (!item) {
    return interaction.reply({ content: `❌ Role "${roleName}" not found in this menu.`, flags: MessageFlags.Ephemeral });
  }

  roleMenus.removeMenuItem(item.id);

  roleMenus.updatePublishedMenus(interaction.client, guildId, menuId).catch(() => {});

  return interaction.reply({
    content: `✅ Removed **${roleName}** from **${menu.title}**.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSetRequirement(interaction, guildId) {
  const menuId = parseInt(interaction.options.getString('menu'), 10);
  const menu = roleMenus.getMenuWithItems(menuId);

  if (!menu || menu.guild_id !== guildId) {
    return interaction.reply({ content: '❌ Menu not found.', flags: MessageFlags.Ephemeral });
  }

  const role = interaction.options.getRole('role');

  roleMenus.updateMenu(menuId, { required_role_id: role ? role.id : null });

  roleMenus.updatePublishedMenus(interaction.client, guildId, menuId).catch(() => {});

  if (role) {
    return interaction.reply({
      content: `✅ Menu **${menu.title}** now requires the **${role.name}** role.`,
      flags: MessageFlags.Ephemeral,
    });
  } else {
    return interaction.reply({
      content: `✅ Requirement cleared for **${menu.title}** — anyone can use it.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleDelete(interaction, guildId) {
  const menuId = parseInt(interaction.options.getString('menu'), 10);
  const menu = roleMenus.getMenuWithItems(menuId);

  if (!menu || menu.guild_id !== guildId) {
    return interaction.reply({ content: '❌ Menu not found.', flags: MessageFlags.Ephemeral });
  }

  roleMenus.deleteMenu(menuId);
  return interaction.reply({
    content: `✅ Menu **${menu.title}** deleted. Published messages will stop working.`,
    flags: MessageFlags.Ephemeral,
  });
}
