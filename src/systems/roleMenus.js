const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { createEmbed } = require('../utils/embedBuilder');
const { loadConfig } = require('../utils/paths');
const db = require('../utils/database');

// Map of old role names to their new names (for migration)
const ROLE_RENAMES = {
  'Twitch Sub': 'Twitch Follower',
  'YouTube Sub': 'YouTube Follower',
  'Kick Sub': 'Kick Follower',
};

// ── Legacy config support ────────────────────────────────────────────────

/**
 * Load role menu config from file (legacy, used for backward compat + seeding)
 * @returns {object} Role menu configuration
 */
function loadRoleMenuConfig() {
  return loadConfig('role-menus.json');
}

// ── Role helper ──────────────────────────────────────────────────────────

/**
 * Ensure a role exists in the guild, create it if not.
 * Also renames legacy roles (e.g. "Twitch Sub" → "Twitch Follower").
 * @param {import('discord.js').Guild} guild
 * @param {string} roleName
 * @param {string} color - Hex color
 * @returns {import('discord.js').Role}
 */
async function ensureRole(guild, roleName, color) {
  let role = guild.roles.cache.find(r => r.name === roleName);

  if (!role) {
    // Check if there's a legacy role that should be renamed
    const legacyName = Object.entries(ROLE_RENAMES).find(([, newName]) => newName === roleName)?.[0];
    if (legacyName) {
      const legacyRole = guild.roles.cache.find(r => r.name === legacyName);
      if (legacyRole) {
        await legacyRole.edit({ name: roleName, reason: 'Renamed by AdminBot (Sub → Follower)' });
        console.log(`  🔄 Renamed role: "${legacyName}" → "${roleName}"`);
        return legacyRole;
      }
    }

    role = await guild.roles.create({
      name: roleName,
      color: color || '#99aab5',
      reason: 'Auto-created by AdminBot role menu',
    });
    console.log(`  ✅ Created role: ${roleName}`);
  }

  return role;
}

// ── DB CRUD functions ────────────────────────────────────────────────────

/**
 * Get all role menus for a guild (with item counts)
 */
function getMenusForGuild(guildId) {
  return db.all(`
    SELECT rm.*, COUNT(rmi.id) as item_count
    FROM role_menus rm
    LEFT JOIN role_menu_items rmi ON rmi.menu_id = rm.id
    WHERE rm.guild_id = ?
    GROUP BY rm.id
    ORDER BY rm.created_at ASC
  `, [guildId]);
}

/**
 * Get a single menu with all its items
 */
function getMenuWithItems(menuId) {
  const menu = db.get('SELECT * FROM role_menus WHERE id = ?', [menuId]);
  if (!menu) return null;
  menu.items = db.all(
    'SELECT * FROM role_menu_items WHERE menu_id = ? ORDER BY position ASC, id ASC',
    [menuId]
  );
  return menu;
}

/**
 * Get a menu by guild + slug
 */
function getMenuBySlug(guildId, slug) {
  return db.get('SELECT * FROM role_menus WHERE guild_id = ? AND slug = ?', [guildId, slug]);
}

/**
 * Create a new role menu
 * @returns {number} The new menu's ID
 */
function createMenu(guildId, { slug, title, description, color, singleSelect, requiredRoleId }) {
  db.run(`
    INSERT INTO role_menus (guild_id, slug, title, description, color, single_select, required_role_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [guildId, slug, title, description || null, color || '#5865f2', singleSelect ? 1 : 0, requiredRoleId || null]);

  const row = db.get('SELECT last_insert_rowid() as id');
  return row.id;
}

/**
 * Update a menu's settings
 */
function updateMenu(menuId, fields) {
  const allowed = ['title', 'description', 'color', 'single_select', 'required_role_id'];
  const sets = [];
  const params = [];

  for (const [key, value] of Object.entries(fields)) {
    const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase(); // camelCase → snake_case
    if (allowed.includes(dbKey)) {
      sets.push(`${dbKey} = ?`);
      params.push(value);
    }
  }

  if (sets.length === 0) return;
  sets.push('updated_at = CURRENT_TIMESTAMP');
  params.push(menuId);
  db.run(`UPDATE role_menus SET ${sets.join(', ')} WHERE id = ?`, params);
}

/**
 * Delete a menu and all its items + published message records
 */
function deleteMenu(menuId) {
  db.run('DELETE FROM role_menu_items WHERE menu_id = ?', [menuId]);
  db.run('DELETE FROM role_menu_messages WHERE menu_id = ?', [menuId]);
  db.run('DELETE FROM role_menus WHERE id = ?', [menuId]);
}

/**
 * Add an item (role) to a menu
 * @returns {number} The new item's ID
 */
function addMenuItem(menuId, { roleName, emoji, color, position }) {
  // Get max position if not specified
  if (position == null) {
    const max = db.get('SELECT MAX(position) as maxPos FROM role_menu_items WHERE menu_id = ?', [menuId]);
    position = (max?.maxPos ?? -1) + 1;
  }

  db.run(`
    INSERT INTO role_menu_items (menu_id, role_name, emoji, color, position)
    VALUES (?, ?, ?, ?, ?)
  `, [menuId, roleName, emoji || null, color || '#99aab5', position]);

  const row = db.get('SELECT last_insert_rowid() as id');
  return row.id;
}

/**
 * Update a menu item
 */
function updateMenuItem(itemId, fields) {
  const allowed = ['role_name', 'emoji', 'color', 'position'];
  const sets = [];
  const params = [];

  for (const [key, value] of Object.entries(fields)) {
    const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (allowed.includes(dbKey)) {
      sets.push(`${dbKey} = ?`);
      params.push(value);
    }
  }

  if (sets.length === 0) return;
  params.push(itemId);
  db.run(`UPDATE role_menu_items SET ${sets.join(', ')} WHERE id = ?`, params);
}

/**
 * Remove an item from a menu
 */
function removeMenuItem(itemId) {
  db.run('DELETE FROM role_menu_items WHERE id = ?', [itemId]);
}

/**
 * Get item count for a menu
 */
function getMenuItemCount(menuId) {
  const row = db.get('SELECT COUNT(*) as cnt FROM role_menu_items WHERE menu_id = ?', [menuId]);
  return row?.cnt || 0;
}

// ── Publish / unpublish ──────────────────────────────────────────────────

/**
 * Send a role menu to a channel (DB-based)
 * @param {import('discord.js').TextChannel} channel
 * @param {number} menuId
 * @returns {import('discord.js').Message} The sent message
 */
async function sendRoleMenuById(channel, menuId) {
  const menu = getMenuWithItems(menuId);
  if (!menu) throw new Error('Menu not found');
  if (!menu.items || menu.items.length === 0) throw new Error('Menu has no roles');

  // Ensure all roles exist in the guild
  for (const item of menu.items) {
    const role = await ensureRole(channel.guild, item.role_name, item.color);
    // Store the role ID for future reference
    if (!item.role_id || item.role_id !== role.id) {
      db.run('UPDATE role_menu_items SET role_id = ? WHERE id = ?', [role.id, item.id]);
    }
  }

  // Build embed
  const roleList = menu.items.map(r => `${r.emoji || '▪️'} **${r.role_name}**`).join('\n');
  const desc = menu.description ? `${menu.description}\n\n${roleList}` : roleList;
  const embed = createEmbed({
    title: menu.title,
    description: desc,
    color: 'primary',
  });

  if (menu.required_role_id) {
    const reqRole = channel.guild.roles.cache.get(menu.required_role_id);
    if (reqRole) {
      embed.setFooter({ text: `Requires: ${reqRole.name}` });
    }
  }

  // Build button rows (max 5 per row, max 5 rows = 25 buttons)
  const rows = [];
  let currentRow = new ActionRowBuilder();

  for (let i = 0; i < menu.items.length; i++) {
    const item = menu.items[i];

    const button = new ButtonBuilder()
      .setCustomId(`role_${menu.id}_${item.id}`)
      .setLabel(item.role_name)
      .setStyle(ButtonStyle.Secondary);

    if (item.emoji) {
      button.setEmoji(item.emoji);
    }

    currentRow.addComponents(button);

    if ((i + 1) % 5 === 0 || i === menu.items.length - 1) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
  }

  const message = await channel.send({ embeds: [embed], components: rows });

  // Track the published message
  db.run(`
    INSERT OR REPLACE INTO role_menu_messages (menu_id, guild_id, channel_id, message_id)
    VALUES (?, ?, ?, ?)
  `, [menuId, channel.guild.id, channel.id, message.id]);

  return message;
}

/**
 * Update all published messages for a menu (after editing)
 */
async function updatePublishedMenus(client, guildId, menuId) {
  const menu = getMenuWithItems(menuId);
  if (!menu || !menu.items.length) return;

  const messages = db.all(
    'SELECT * FROM role_menu_messages WHERE menu_id = ? AND guild_id = ?',
    [menuId, guildId]
  );

  for (const record of messages) {
    try {
      const guild = await client.guilds.fetch(guildId);
      const channel = await guild.channels.fetch(record.channel_id);
      if (!channel) throw new Error('Channel not found');
      const msg = await channel.messages.fetch(record.message_id);
      if (!msg) throw new Error('Message not found');

      // Rebuild embed + buttons
      const roleList = menu.items.map(r => `${r.emoji || '▪️'} **${r.role_name}**`).join('\n');
      const desc = menu.description ? `${menu.description}\n\n${roleList}` : roleList;
      const embed = createEmbed({ title: menu.title, description: desc, color: 'primary' });

      if (menu.required_role_id) {
        const reqRole = guild.roles.cache.get(menu.required_role_id);
        if (reqRole) embed.setFooter({ text: `Requires: ${reqRole.name}` });
      }

      const rows = [];
      let currentRow = new ActionRowBuilder();
      for (let i = 0; i < menu.items.length; i++) {
        const item = menu.items[i];
        const button = new ButtonBuilder()
          .setCustomId(`role_${menu.id}_${item.id}`)
          .setLabel(item.role_name)
          .setStyle(ButtonStyle.Secondary);
        if (item.emoji) button.setEmoji(item.emoji);
        currentRow.addComponents(button);
        if ((i + 1) % 5 === 0 || i === menu.items.length - 1) {
          rows.push(currentRow);
          currentRow = new ActionRowBuilder();
        }
      }

      await msg.edit({ embeds: [embed], components: rows });
    } catch (err) {
      // Message or channel was deleted — remove stale record
      console.warn(`⚠️ Could not update published menu message ${record.message_id}: ${err.message}`);
      db.run('DELETE FROM role_menu_messages WHERE id = ?', [record.id]);
    }
  }
}

/**
 * Get published message locations for a menu
 */
function getPublishedMessages(menuId, guildId) {
  return db.all(
    'SELECT * FROM role_menu_messages WHERE menu_id = ? AND guild_id = ?',
    [menuId, guildId]
  );
}

/**
 * Remove a published message record (and optionally delete the Discord message)
 */
async function unpublishMessage(client, recordId) {
  const record = db.get('SELECT * FROM role_menu_messages WHERE id = ?', [recordId]);
  if (!record) return;

  try {
    const guild = await client.guilds.fetch(record.guild_id);
    const channel = await guild.channels.fetch(record.channel_id);
    const msg = await channel.messages.fetch(record.message_id);
    await msg.delete();
  } catch {
    // Message already gone — that's fine
  }

  db.run('DELETE FROM role_menu_messages WHERE id = ?', [recordId]);
}

// ── Seed from JSON config ────────────────────────────────────────────────

/**
 * Seed role menus from config/role-menus.json into the database for a guild.
 * Idempotent — skips menus that already exist for the guild.
 */
function seedMenusFromConfig(guildId) {
  let config;
  try {
    config = loadRoleMenuConfig();
  } catch {
    return; // No config file — nothing to seed
  }

  if (!config || typeof config !== 'object') return;

  for (const [slug, menuData] of Object.entries(config)) {
    // Skip if already seeded
    const existing = getMenuBySlug(guildId, slug);
    if (existing) continue;

    const menuId = createMenu(guildId, {
      slug,
      title: menuData.title || slug,
      description: menuData.description || null,
      color: menuData.color || '#5865f2',
      singleSelect: !!menuData.singleSelect,
      requiredRoleId: null,
    });

    if (Array.isArray(menuData.roles)) {
      menuData.roles.forEach((roleData, index) => {
        addMenuItem(menuId, {
          roleName: roleData.name,
          emoji: roleData.emoji || null,
          color: roleData.color || '#99aab5',
          position: index,
        });
      });
    }

    console.log(`  📋 Seeded role menu "${slug}" for guild ${guildId}`);
  }
}

// ── Button interaction handler ───────────────────────────────────────────

/**
 * Handle a role menu button click.
 * Supports both new numeric format (role_{menuId}_{itemId}) and
 * legacy string format (role_{menuType}_{roleName}).
 */
async function handleRoleButton(interaction) {
  const customId = interaction.customId; // e.g. "role_3_17" or "role_gameRoles_GTA V"
  const parts = customId.split('_');
  const menuKey = parts[1];
  const rest = parts.slice(2).join('_');

  const member = interaction.member;
  const guild = interaction.guild;

  let menu, roleName, isSingleSelect;

  // Determine if this is a new-format (numeric) or legacy-format (string) button
  if (/^\d+$/.test(menuKey)) {
    // ── New format: role_{menuId}_{itemId} ──
    const menuId = parseInt(menuKey, 10);
    const itemId = parseInt(rest, 10);

    menu = getMenuWithItems(menuId);
    if (!menu) {
      return interaction.reply({ content: '❌ Menu not found.', flags: MessageFlags.Ephemeral });
    }

    const item = menu.items.find(i => i.id === itemId);
    if (!item) {
      return interaction.reply({ content: '❌ Role option not found.', flags: MessageFlags.Ephemeral });
    }

    // Required role check
    if (menu.required_role_id) {
      if (!member.roles.cache.has(menu.required_role_id)) {
        const reqRole = guild.roles.cache.get(menu.required_role_id);
        const reqName = reqRole ? reqRole.name : 'a required role';
        return interaction.reply({
          content: `❌ You need the **${reqName}** role to use this menu.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    roleName = item.role_name;
    isSingleSelect = !!menu.single_select;
  } else {
    // ── Legacy format: role_{menuType}_{roleName} ──
    const menuType = menuKey;
    roleName = rest;

    let config;
    try {
      config = loadRoleMenuConfig();
    } catch {
      return interaction.reply({ content: '❌ Role menu config not found.', flags: MessageFlags.Ephemeral });
    }

    menu = config[menuType];
    if (!menu) {
      return interaction.reply({ content: '❌ Menu not found.', flags: MessageFlags.Ephemeral });
    }

    isSingleSelect = !!menu.singleSelect;
    // Wrap legacy menu roles into items-like structure for single-select logic
    menu.items = menu.roles?.map(r => ({ role_name: r.name })) || [];
  }

  // Find the Discord role
  let role = guild.roles.cache.find(r => r.name === roleName);
  if (!role && ROLE_RENAMES[roleName]) {
    role = guild.roles.cache.find(r => r.name === ROLE_RENAMES[roleName]);
  }
  if (!role) {
    return interaction.reply({
      content: `❌ Role "${roleName}" not found. An admin should re-publish this menu.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    if (isSingleSelect) {
      // Remove all other roles from this menu first
      const menuRoleNames = menu.items.map(i => i.role_name);
      const rolesToRemove = member.roles.cache.filter(r => menuRoleNames.includes(r.name));

      for (const [, existingRole] of rolesToRemove) {
        await member.roles.remove(existingRole);
      }

      // Toggle off if they clicked the same role
      if (rolesToRemove.has(role.id)) {
        return interaction.reply({
          content: `🔴 **${roleName}** role removed.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      await member.roles.add(role);
      return interaction.reply({
        content: `🟢 **${roleName}** role given! (Previous selection removed)`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Multi-select: toggle
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role);
      return interaction.reply({
        content: `🔴 **${roleName}** role removed.`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
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

// ── Legacy wrapper (for serverSetup.js compatibility) ────────────────────

/**
 * Legacy sendRoleMenu — still supports string menuType for serverSetup auto-setup.
 * If the guild has a DB menu with that slug, uses it. Otherwise falls back to JSON config.
 */
async function sendRoleMenu(channel, menuType) {
  const guildId = channel.guild.id;

  // Try DB first
  const dbMenu = getMenuBySlug(guildId, menuType);
  if (dbMenu) {
    return sendRoleMenuById(channel, dbMenu.id);
  }

  // Fall back to legacy JSON config
  const config = loadRoleMenuConfig();
  const menu = config[menuType];

  if (!menu) {
    throw new Error(`Unknown menu type: ${menuType}`);
  }

  for (const roleConfig of menu.roles) {
    await ensureRole(channel.guild, roleConfig.name, roleConfig.color);
  }

  const roleList = menu.roles.map(r => `${r.emoji} **${r.name}**`).join('\n');
  const embed = createEmbed({
    title: menu.title,
    description: `${menu.description}\n\n${roleList}`,
    color: 'primary',
  });

  const rows = [];
  let currentRow = new ActionRowBuilder();

  for (let i = 0; i < menu.roles.length; i++) {
    const roleConfig = menu.roles[i];
    const button = new ButtonBuilder()
      .setCustomId(`role_${menuType}_${roleConfig.name}`)
      .setLabel(roleConfig.name)
      .setStyle(ButtonStyle.Secondary);

    if (roleConfig.emoji) {
      button.setEmoji(roleConfig.emoji);
    }

    currentRow.addComponents(button);

    if ((i + 1) % 5 === 0 || i === menu.roles.length - 1) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
  }

  await channel.send({ embeds: [embed], components: rows });
}

module.exports = {
  // Legacy exports (backward compat)
  sendRoleMenu,
  handleRoleButton,
  loadRoleMenuConfig,
  // New DB-based exports
  getMenusForGuild,
  getMenuWithItems,
  getMenuBySlug,
  createMenu,
  updateMenu,
  deleteMenu,
  addMenuItem,
  updateMenuItem,
  removeMenuItem,
  getMenuItemCount,
  sendRoleMenuById,
  updatePublishedMenus,
  getPublishedMessages,
  unpublishMessage,
  seedMenusFromConfig,
  ensureRole,
};
