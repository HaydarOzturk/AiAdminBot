const {
  ChannelType,
  PermissionFlagsBits,
  PermissionsBitField,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { channelName, t } = require('../utils/locale');
const { projectPath, loadConfig } = require('../utils/paths');

// ── Config loading ──────────────────────────────────────────────────────────

function loadSetupConfig() {
  return loadConfig('server-setup.json');
}

/**
 * Generate a default server config using localized channel names from the current locale.
 * Used by /ai-setup default mode to create a server in any supported language.
 * @returns {object} Server setup config with localized names
 */
function buildLocalizedDefaultConfig() {
  const cn = channelName; // shorthand

  const ownerRole = t('roles.serverOwner');
  const adminRole = t('roles.admin');
  const modRole = t('roles.moderator');
  const verifiedRole = t('roles.verified');
  const unverifiedRole = t('roles.unverified');

  return {
    roles: [
      { name: ownerRole, color: '#e74c3c', hoist: true, permissions: ['Administrator'], position: 'top' },
      { name: adminRole, color: '#e67e22', hoist: true, permissions: ['Administrator'], position: 'high' },
      { name: modRole, color: '#2ecc71', hoist: true, permissions: ['ManageMessages', 'KickMembers', 'MuteMembers', 'DeafenMembers', 'MoveMembers', 'ManageNicknames', 'ModerateMembers'], position: 'high' },
      { name: verifiedRole, color: '#3498db', hoist: false, permissions: [], position: 'low' },
      { name: unverifiedRole, color: '#95a5a6', hoist: false, permissions: [], position: 'bottom' },
    ],
    categories: [
      {
        name: cn('cat-verification'),
        channels: [
          {
            name: cn('rules'), type: 'text', topic: 'Server rules',
            permissions: {
              everyone: { deny: ['SendMessages'], allow: ['ViewChannel', 'ReadMessageHistory'] },
            },
          },
          {
            name: cn('verification'), type: 'text', topic: 'Click the verify button!',
            autoSetup: 'verification',
            permissions: {
              everyone: { deny: ['SendMessages'], allow: ['ViewChannel', 'ReadMessageHistory'] },
              [verifiedRole]: { deny: ['ViewChannel'] },
            },
          },
        ],
      },
      {
        name: cn('cat-roles'),
        channels: [
          {
            name: cn('color-roles'), type: 'text', topic: 'Pick your name color!',
            autoSetup: 'roleMenu:colorRoles',
            permissions: {
              everyone: { deny: ['SendMessages', 'ViewChannel'] },
              [unverifiedRole]: { deny: ['ViewChannel'] },
              [verifiedRole]: { allow: ['ViewChannel', 'ReadMessageHistory'] },
            },
          },
          {
            name: cn('game-roles'), type: 'text', topic: 'Select your games!',
            autoSetup: 'roleMenu:gameRoles',
            permissions: {
              everyone: { deny: ['SendMessages', 'ViewChannel'] },
              [unverifiedRole]: { deny: ['ViewChannel'] },
              [verifiedRole]: { allow: ['ViewChannel', 'ReadMessageHistory'] },
            },
          },
          {
            name: cn('platform-roles'), type: 'text', topic: 'Select your platforms!',
            autoSetup: 'roleMenu:platformRoles',
            permissions: {
              everyone: { deny: ['SendMessages', 'ViewChannel'] },
              [unverifiedRole]: { deny: ['ViewChannel'] },
              [verifiedRole]: { allow: ['ViewChannel', 'ReadMessageHistory'] },
            },
          },
        ],
      },
      {
        name: cn('cat-chat'),
        channels: [
          {
            name: cn('general-chat'), type: 'text', topic: 'General chat',
            permissions: {
              everyone: { deny: ['ViewChannel'] },
              [unverifiedRole]: { deny: ['ViewChannel'] },
              [verifiedRole]: { allow: ['ViewChannel', 'SendMessages'] },
            },
          },
          {
            name: cn('media'), type: 'text', topic: 'Share images, videos and links',
            permissions: {
              everyone: { deny: ['ViewChannel'] },
              [unverifiedRole]: { deny: ['ViewChannel'] },
              [verifiedRole]: { allow: ['ViewChannel', 'SendMessages', 'AttachFiles', 'EmbedLinks'] },
            },
          },
          {
            name: cn('bot-commands'), type: 'text', topic: 'Use bot commands here!',
            permissions: {
              everyone: { deny: ['ViewChannel'] },
              [unverifiedRole]: { deny: ['ViewChannel'] },
              [verifiedRole]: { allow: ['ViewChannel', 'SendMessages'] },
            },
          },
          {
            name: cn('ai-chat'), type: 'text', topic: 'Chat with AI! Type a message and AI will respond.',
            permissions: {
              everyone: { deny: ['ViewChannel'] },
              [unverifiedRole]: { deny: ['ViewChannel'] },
              [verifiedRole]: { allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
            },
          },
        ],
      },
      {
        name: cn('cat-welcome'),
        channels: [
          {
            name: cn('welcome'), type: 'text', topic: 'Welcome new members!',
            permissions: {
              everyone: { deny: ['SendMessages', 'ViewChannel'] },
              [verifiedRole]: { allow: ['ViewChannel', 'ReadMessageHistory', 'AddReactions'] },
            },
          },
          {
            name: cn('goodbye'), type: 'text', topic: 'Farewell messages',
            permissions: {
              everyone: { deny: ['SendMessages', 'ViewChannel'] },
              [verifiedRole]: { allow: ['ViewChannel', 'ReadMessageHistory'] },
            },
          },
        ],
      },
      {
        name: cn('cat-voice'),
        channels: [
          {
            name: cn('voice-general'), type: 'voice',
            permissions: {
              everyone: { deny: ['ViewChannel'] },
              [unverifiedRole]: { deny: ['ViewChannel'] },
              [verifiedRole]: { allow: ['ViewChannel', 'Connect', 'Speak'] },
            },
          },
          {
            name: cn('voice-game-1'), type: 'voice',
            permissions: {
              everyone: { deny: ['ViewChannel'] },
              [unverifiedRole]: { deny: ['ViewChannel'] },
              [verifiedRole]: { allow: ['ViewChannel', 'Connect', 'Speak'] },
            },
          },
          {
            name: cn('voice-game-2'), type: 'voice',
            permissions: {
              everyone: { deny: ['ViewChannel'] },
              [unverifiedRole]: { deny: ['ViewChannel'] },
              [verifiedRole]: { allow: ['ViewChannel', 'Connect', 'Speak'] },
            },
          },
          {
            name: cn('voice-music'), type: 'voice',
            permissions: {
              everyone: { deny: ['ViewChannel'] },
              [unverifiedRole]: { deny: ['ViewChannel'] },
              [verifiedRole]: { allow: ['ViewChannel', 'Connect', 'Speak'] },
            },
          },
        ],
      },
      {
        name: cn('cat-logs'),
        staffOnly: true,
        channels: [
          { name: cn('message-log'), type: 'text', topic: 'Deleted and edited messages' },
          { name: cn('join-leave-log'), type: 'text', topic: 'Member join/leave logs' },
          { name: cn('punishment-log'), type: 'text', topic: 'Warning, mute, kick, ban logs' },
          { name: cn('role-log'), type: 'text', topic: 'Role change logs' },
          { name: cn('name-log'), type: 'text', topic: 'Nickname change logs' },
          { name: cn('channel-log'), type: 'text', topic: 'Channel change logs' },
          { name: cn('ban-log'), type: 'text', topic: 'Ban logs' },
        ],
      },
      {
        name: cn('cat-staff'),
        staffOnly: true,
        channels: [
          { name: cn('staff-chat'), type: 'text', topic: 'Staff chat' },
          { name: cn('staff-commands'), type: 'text', topic: 'Staff bot commands' },
          { name: cn('staff-voice'), type: 'voice' },
        ],
      },
      {
        name: cn('cat-streaming'),
        channels: [
          {
            name: cn('stream-announcements'), type: 'text',
            topic: t('streaming.announcementsTopic'),
            permissions: {
              everyone: { deny: ['SendMessages'], allow: ['ViewChannel', 'ReadMessageHistory'] },
            },
          },
          {
            name: cn('stream-chat'), type: 'text',
            topic: t('streaming.chatTopic'),
            permissions: {
              everyone: { deny: ['ViewChannel'] },
              [unverifiedRole]: { deny: ['ViewChannel'] },
              [verifiedRole]: { allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
            },
          },
        ],
      },
      {
        name: cn('cat-afk'),
        channels: [
          {
            name: cn('afk'), type: 'voice',
            afkChannel: true,
            permissions: {
              everyone: { allow: ['ViewChannel', 'Connect'], deny: ['Speak'] },
            },
          },
        ],
      },
    ],
  };
}

// ── Permission string → discord.js flag map ─────────────────────────────────

const PERM_MAP = {
  ViewChannel: PermissionFlagsBits.ViewChannel,
  SendMessages: PermissionFlagsBits.SendMessages,
  ReadMessageHistory: PermissionFlagsBits.ReadMessageHistory,
  AddReactions: PermissionFlagsBits.AddReactions,
  AttachFiles: PermissionFlagsBits.AttachFiles,
  EmbedLinks: PermissionFlagsBits.EmbedLinks,
  Connect: PermissionFlagsBits.Connect,
  Speak: PermissionFlagsBits.Speak,
  ManageMessages: PermissionFlagsBits.ManageMessages,
  KickMembers: PermissionFlagsBits.KickMembers,
  MuteMembers: PermissionFlagsBits.MuteMembers,
  DeafenMembers: PermissionFlagsBits.DeafenMembers,
  MoveMembers: PermissionFlagsBits.MoveMembers,
  ManageNicknames: PermissionFlagsBits.ManageNicknames,
  ModerateMembers: PermissionFlagsBits.ModerateMembers,
  Administrator: PermissionFlagsBits.Administrator,
};

/**
 * Convert array of permission strings to a bitfield
 */
function permStringsToFlags(permStrings) {
  let bits = 0n;
  for (const p of permStrings) {
    if (PERM_MAP[p]) bits |= PERM_MAP[p];
  }
  return bits;
}

// ── Main setup runner ───────────────────────────────────────────────────────

/**
 * Run the full server setup: roles, categories, channels, permissions,
 * verification message, and role menus.
 *
 * Idempotent — skips anything that already exists (matched by name).
 *
 * @param {import('discord.js').Guild} guild
 * @returns {object} Summary of what was created / skipped
 */
async function runSetup(guild) {
  // Use the custom config if the user created one, otherwise use locale-aware defaults
  const customConfigPath = projectPath('config', 'server-setup.json');
  const config = fs.existsSync(customConfigPath)
    ? JSON.parse(fs.readFileSync(customConfigPath, 'utf-8'))
    : buildLocalizedDefaultConfig();

  const result = {
    rolesCreated: 0,
    rolesSkipped: 0,
    categoriesCreated: 0,
    categoriesSkipped: 0,
    channelsCreated: 0,
    channelsSkipped: 0,
    verificationSent: false,
    roleMenusSent: [],
    afkChannelSet: false,
    errors: [],
  };

  // ── 1. Create roles ─────────────────────────────────────────────────────
  console.log('\n🔧 [Setup] Phase 1: Roles');

  for (const roleCfg of config.roles) {
    const existing = guild.roles.cache.find(r => r.name === roleCfg.name);
    if (existing) {
      console.log(`  ⏭️  Role already exists: ${roleCfg.name}`);
      result.rolesSkipped++;
      continue;
    }

    try {
      const opts = {
        name: roleCfg.name,
        colors: { primaryColor: roleCfg.color || '#99aab5' },
        hoist: roleCfg.hoist || false,
        reason: 'Server setup by AdminBot',
      };

      if (roleCfg.permissions && roleCfg.permissions.length > 0) {
        opts.permissions = new PermissionsBitField(permStringsToFlags(roleCfg.permissions));
      }

      await guild.roles.create(opts);
      console.log(`  ✅ Created role: ${roleCfg.name}`);
      result.rolesCreated++;
    } catch (err) {
      const msg = `Role "${roleCfg.name}": ${err.message}`;
      console.error(`  ❌ ${msg}`);
      result.errors.push(msg);
    }
  }

  // Refresh cache after creating roles so we can reference them in permissions
  await guild.roles.fetch();

  // ── 2. Create categories and channels ───────────────────────────────────
  console.log('\n🔧 [Setup] Phase 2: Categories & Channels');

  // We'll need these roles for permission overrides
  const everyoneRole = guild.roles.everyone;
  const staffRoles = guild.roles.cache.filter(
    r => r.permissions.has(PermissionFlagsBits.Administrator) || r.permissions.has(PermissionFlagsBits.ManageMessages)
  );

  // Track channels that need auto-setup (verification / role menus)
  const autoSetupQueue = [];

  for (const catCfg of config.categories) {
    // Find or create category
    let category = guild.channels.cache.find(
      c => c.type === ChannelType.GuildCategory && c.name === catCfg.name
    );

    if (!category) {
      try {
        const catPerms = [];

        // If staffOnly, deny everyone and allow staff roles
        if (catCfg.staffOnly) {
          catPerms.push({
            id: everyoneRole.id,
            deny: [PermissionFlagsBits.ViewChannel],
          });
          for (const [, staffRole] of staffRoles) {
            catPerms.push({
              id: staffRole.id,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
            });
          }
        }

        category = await guild.channels.create({
          name: catCfg.name,
          type: ChannelType.GuildCategory,
          permissionOverwrites: catPerms,
          reason: 'Server setup by AdminBot',
        });
        console.log(`  ✅ Created category: ${catCfg.name}`);
        result.categoriesCreated++;
      } catch (err) {
        const msg = `Category "${catCfg.name}": ${err.message}`;
        console.error(`  ❌ ${msg}`);
        result.errors.push(msg);
        continue; // skip channels if category failed
      }
    } else {
      console.log(`  ⏭️  Category already exists: ${catCfg.name}`);
      result.categoriesSkipped++;
    }

    // Create channels inside this category
    for (const chCfg of catCfg.channels) {
      const channelType =
        chCfg.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;

      // Check if channel already exists in this category
      const existingCh = guild.channels.cache.find(
        c => c.name === chCfg.name && c.parentId === category.id
      );

      if (existingCh) {
        console.log(`    ⏭️  Channel already exists: ${chCfg.name}`);
        result.channelsSkipped++;

        // Ensure AFK channel is still set on the guild even if channel existed
        if (chCfg.afkChannel && existingCh.type === ChannelType.GuildVoice && guild.afkChannelId !== existingCh.id) {
          try {
            await guild.setAFKChannel(existingCh, 'Server setup by AdminBot');
            await guild.setAFKTimeout(600);
            result.afkChannelSet = true;
            console.log(`    ✅ Set existing channel as AFK: ${chCfg.name}`);
          } catch (err) {
            result.errors.push(`AFK channel setup: ${err.message}`);
          }
        }

        // Still queue auto-setup even for existing channels
        if (chCfg.autoSetup) {
          autoSetupQueue.push({ channel: existingCh, autoSetup: chCfg.autoSetup });
        }
        continue;
      }

      try {
        // Build permission overwrites
        const overwrites = [];

        if (catCfg.staffOnly) {
          // Inherit from category (staff only)
          overwrites.push({
            id: everyoneRole.id,
            deny: [PermissionFlagsBits.ViewChannel],
          });
          for (const [, staffRole] of staffRoles) {
            overwrites.push({
              id: staffRole.id,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
            });
          }
        } else if (chCfg.permissions) {
          // Custom per-channel permissions
          for (const [roleName, perms] of Object.entries(chCfg.permissions)) {
            let targetId;

            if (roleName === 'everyone') {
              targetId = everyoneRole.id;
            } else {
              const role = guild.roles.cache.find(r => r.name === roleName);
              if (!role) {
                console.warn(`    ⚠️  Role not found for permission: ${roleName}`);
                continue;
              }
              targetId = role.id;
            }

            const overwrite = { id: targetId };
            if (perms.allow) {
              overwrite.allow = perms.allow.map(p => PERM_MAP[p]).filter(Boolean);
            }
            if (perms.deny) {
              overwrite.deny = perms.deny.map(p => PERM_MAP[p]).filter(Boolean);
            }
            overwrites.push(overwrite);
          }
        }

        const newChannel = await guild.channels.create({
          name: chCfg.name,
          type: channelType,
          parent: category.id,
          topic: chCfg.topic || null,
          permissionOverwrites: overwrites,
          reason: 'Server setup by AdminBot',
        });

        console.log(`    ✅ Created channel: ${chCfg.name}`);
        result.channelsCreated++;

        // Set as guild AFK channel if flagged
        if (chCfg.afkChannel && newChannel.type === ChannelType.GuildVoice) {
          try {
            await guild.setAFKChannel(newChannel, 'Server setup by AdminBot');
            await guild.setAFKTimeout(600); // 10 minutes
            result.afkChannelSet = true;
            console.log(`    ✅ Set AFK channel: ${chCfg.name} (timeout: 10 min)`);
          } catch (err) {
            const afkMsg = `AFK channel setup: ${err.message}`;
            console.error(`    ❌ ${afkMsg}`);
            result.errors.push(afkMsg);
          }
        }

        // Queue auto-setup
        if (chCfg.autoSetup) {
          autoSetupQueue.push({ channel: newChannel, autoSetup: chCfg.autoSetup });
        }
      } catch (err) {
        const msg = `Channel "${chCfg.name}": ${err.message}`;
        console.error(`    ❌ ${msg}`);
        result.errors.push(msg);
      }
    }
  }

  // ── 3. Auto-setup: verification messages and role menus ─────────────────
  console.log('\n🔧 [Setup] Phase 3: Auto-setup (verification & role menus)');

  for (const { channel, autoSetup } of autoSetupQueue) {
    try {
      // Check if channel already has bot messages (don't send duplicates)
      const messages = await channel.messages.fetch({ limit: 10 });
      const botMessages = messages.filter(m => m.author.id === guild.members.me.id);

      if (botMessages.size > 0) {
        console.log(`    ⏭️  #${channel.name} already has bot messages, skipping auto-setup`);
        continue;
      }

      if (autoSetup === 'verification') {
        const verification = require('./verification');
        await verification.sendVerificationMessage(channel, guild.id);
        result.verificationSent = true;
        console.log(`    ✅ Sent verification message to #${channel.name}`);
      } else if (autoSetup.startsWith('roleMenu:')) {
        const menuType = autoSetup.split(':')[1];
        const roleMenus = require('./roleMenus');
        await roleMenus.sendRoleMenu(channel, menuType);
        result.roleMenusSent.push(channel.name);
        console.log(`    ✅ Sent ${menuType} role menu to #${channel.name}`);
      }
    } catch (err) {
      const msg = `Auto-setup #${channel.name}: ${err.message}`;
      console.error(`    ❌ ${msg}`);
      result.errors.push(msg);
    }
  }

  console.log('\n✅ [Setup] Complete!\n');
  return result;
}

module.exports = { runSetup, loadSetupConfig, buildLocalizedDefaultConfig };
