const { ChannelType, PermissionsBitField } = require('discord.js');
const { findChannel, findCategory, findRole, notFoundMsg } = require('../fuzzyMatch');

// Common permission names mapped to discord.js flags
const PERM_MAP = {
  'view': 'ViewChannel',
  'viewchannel': 'ViewChannel',
  'send': 'SendMessages',
  'sendmessages': 'SendMessages',
  'read': 'ViewChannel',
  'write': 'SendMessages',
  'speak': 'Speak',
  'connect': 'Connect',
  'attach': 'AttachFiles',
  'attachfiles': 'AttachFiles',
  'embed': 'EmbedLinks',
  'embedlinks': 'EmbedLinks',
  'react': 'AddReactions',
  'addreactions': 'AddReactions',
  'mention': 'MentionEveryone',
  'mentioneveryone': 'MentionEveryone',
  'manage': 'ManageChannels',
  'managechannel': 'ManageChannels',
  'managechannels': 'ManageChannels',
  'managemessages': 'ManageMessages',
  'manageroles': 'ManageRoles',
  'readhistory': 'ReadMessageHistory',
  'readmessagehistory': 'ReadMessageHistory',
  'history': 'ReadMessageHistory',
  'voiceactivity': 'UseVAD',
  'vad': 'UseVAD',
  'stream': 'Stream',
  'video': 'Stream',
  'mute': 'MuteMembers',
  'mutemembers': 'MuteMembers',
  'deafen': 'DeafenMembers',
  'deafenmembers': 'DeafenMembers',
  'movemembers': 'MoveMembers',
  'move': 'MoveMembers',
  'priority': 'PrioritySpeaker',
  'priorityspeaker': 'PrioritySpeaker',
  'threads': 'CreatePublicThreads',
  'createthreads': 'CreatePublicThreads',
  'externalemoji': 'UseExternalEmojis',
  'useexternalemojis': 'UseExternalEmojis',
  'useslashcommands': 'UseApplicationCommands',
  'slashcommands': 'UseApplicationCommands',
};

/**
 * Resolve a permission name (user-friendly or exact) to a discord.js permission key.
 */
function resolvePermission(input) {
  const normalized = input.toLowerCase().replace(/[\s_-]/g, '');
  if (PERM_MAP[normalized]) return PERM_MAP[normalized];
  // Try direct match against PermissionsBitField.Flags
  const directMatch = Object.keys(PermissionsBitField.Flags).find(
    k => k.toLowerCase() === normalized
  );
  return directMatch || null;
}

/**
 * Format permission overwrites for display.
 */
function formatOverwrites(channel, guild) {
  const overwrites = channel.permissionOverwrites.cache;
  if (overwrites.size === 0) return 'No permission overwrites (inherits from category/server defaults)';

  const lines = [];
  for (const [id, overwrite] of overwrites) {
    const role = guild.roles.cache.get(id);
    const member = guild.members.cache.get(id);
    const name = role ? `@${role.name}` : member ? `@${member.displayName}` : id;

    const allowed = overwrite.allow.toArray();
    const denied = overwrite.deny.toArray();

    const parts = [];
    if (allowed.length > 0) parts.push(`Allow: ${allowed.join(', ')}`);
    if (denied.length > 0) parts.push(`Deny: ${denied.join(', ')}`);
    lines.push(`${name}: ${parts.join(' | ') || 'No changes'}`);
  }
  return lines.join('\n');
}

module.exports = [
  {
    name: 'create_text_channel',
    description: 'Create a text channel, optionally in a category',
    category: 'channels',
    requiredPermission: 3,
    destructive: false,
    parameters: {
      name: { type: 'string', description: 'Channel name', required: true },
      category: { type: 'string', description: 'Category name to place it in', required: false },
    },
    async execute(guild, invoker, params) {
      const options = { name: params.name, type: ChannelType.GuildText };
      if (params.category) {
        const { match: cat, suggestions } = findCategory(guild, params.category);
        if (!cat) return { success: false, message: notFoundMsg('Category', params.category, suggestions) };
        options.parent = cat.id;
      }
      const channel = await guild.channels.create(options);
      return { success: true, message: `Created text channel #${channel.name}` };
    },
  },
  {
    name: 'create_voice_channel',
    description: 'Create a voice channel, optionally in a category',
    category: 'channels',
    requiredPermission: 3,
    destructive: false,
    parameters: {
      name: { type: 'string', description: 'Channel name', required: true },
      category: { type: 'string', description: 'Category name', required: false },
    },
    async execute(guild, invoker, params) {
      const options = { name: params.name, type: ChannelType.GuildVoice };
      if (params.category) {
        const { match: cat, suggestions } = findCategory(guild, params.category);
        if (!cat) return { success: false, message: notFoundMsg('Category', params.category, suggestions) };
        options.parent = cat.id;
      }
      const channel = await guild.channels.create(options);
      return { success: true, message: `Created voice channel ${channel.name}` };
    },
  },
  {
    name: 'create_category',
    description: 'Create a channel category',
    category: 'channels',
    requiredPermission: 3,
    destructive: false,
    parameters: {
      name: { type: 'string', description: 'Category name', required: true },
    },
    async execute(guild, invoker, params) {
      const channel = await guild.channels.create({ name: params.name, type: ChannelType.GuildCategory });
      return { success: true, message: `Created category "${channel.name}"` };
    },
  },
  {
    name: 'delete_channel',
    description: 'Delete a channel',
    category: 'channels',
    requiredPermission: 3,
    destructive: true,
    parameters: {
      channelId: { type: 'string', description: 'Channel ID or name', required: true },
    },
    async execute(guild, invoker, params) {
      let channel = guild.channels.cache.get(params.channelId);
      if (!channel) {
        const { match, suggestions } = findChannel(guild, params.channelId);
        if (!match) return { success: false, message: notFoundMsg('Channel', params.channelId, suggestions) };
        channel = match;
      }
      const name = channel.name;
      await channel.delete('Deleted by AI Agent');
      return { success: true, message: `Deleted channel #${name}` };
    },
  },
  {
    name: 'move_channel',
    description: 'Move a channel to a different category',
    category: 'channels',
    requiredPermission: 3,
    destructive: false,
    parameters: {
      channel: { type: 'string', description: 'Channel name or ID to move', required: true },
      category: { type: 'string', description: 'Target category name to move the channel into', required: true },
    },
    async execute(guild, invoker, params) {
      let channel = guild.channels.cache.get(params.channel);
      if (!channel) {
        const { match, suggestions } = findChannel(guild, params.channel);
        if (!match) return { success: false, message: notFoundMsg('Channel', params.channel, suggestions) };
        channel = match;
      }

      const { match: category, suggestions } = findCategory(guild, params.category);
      if (!category) return { success: false, message: notFoundMsg('Category', params.category, suggestions) };

      await channel.setParent(category.id, { reason: 'Moved by AI Agent' });
      return { success: true, message: `Moved #${channel.name} to category "${category.name}"` };
    },
  },
  {
    name: 'rename_channel',
    description: 'Rename a channel',
    category: 'channels',
    requiredPermission: 3,
    destructive: false,
    parameters: {
      channel: { type: 'string', description: 'Channel name or ID to rename', required: true },
      newName: { type: 'string', description: 'New name for the channel', required: true },
    },
    async execute(guild, invoker, params) {
      let channel = guild.channels.cache.get(params.channel);
      if (!channel) {
        const { match, suggestions } = findChannel(guild, params.channel);
        if (!match) return { success: false, message: notFoundMsg('Channel', params.channel, suggestions) };
        channel = match;
      }

      const oldName = channel.name;
      await channel.setName(params.newName, 'Renamed by AI Agent');
      return { success: true, message: `Renamed #${oldName} to #${channel.name}` };
    },
  },
  {
    name: 'list_channels',
    description: 'List all server channels grouped by category',
    category: 'channels',
    requiredPermission: 0,
    destructive: false,
    parameters: {},
    async execute(guild) {
      const channels = guild.channels.cache
        .filter(c => c.type !== ChannelType.GuildCategory)
        .sort((a, b) => a.position - b.position);

      const grouped = {};
      channels.forEach(c => {
        const catName = c.parent?.name || 'No Category';
        if (!grouped[catName]) grouped[catName] = [];
        const type = c.type === ChannelType.GuildVoice ? '🔊' : '#';
        grouped[catName].push(`${type}${c.name}`);
      });

      const list = Object.entries(grouped).map(([cat, chs]) => `**${cat}**\n${chs.join(', ')}`).join('\n\n');
      return { success: true, message: list || 'No channels found' };
    },
  },
  {
    name: 'view_channel_permissions',
    description: 'View permission overwrites on a channel',
    category: 'channels',
    requiredPermission: 2,
    destructive: false,
    parameters: {
      channel: { type: 'string', description: 'Channel name or ID', required: true },
    },
    async execute(guild, invoker, params) {
      let channel = guild.channels.cache.get(params.channel);
      if (!channel) {
        const { match, suggestions } = findChannel(guild, params.channel);
        if (!match) return { success: false, message: notFoundMsg('Channel', params.channel, suggestions) };
        channel = match;
      }

      const perms = formatOverwrites(channel, guild);
      const parentInfo = channel.parent ? `\nCategory: ${channel.parent.name} (synced: ${channel.permissionsLocked ? 'yes' : 'no'})` : '';
      return { success: true, message: `**#${channel.name}** permissions:${parentInfo}\n${perms}` };
    },
  },
  {
    name: 'set_channel_permission',
    description: 'Set a permission for a role or user on a channel (allow, deny, or reset)',
    category: 'channels',
    requiredPermission: 3,
    destructive: false,
    parameters: {
      channel: { type: 'string', description: 'Channel name or ID', required: true },
      target: { type: 'string', description: 'Role name or user ID to set permission for (use "everyone" for @everyone)', required: true },
      permission: { type: 'string', description: 'Permission name (e.g. send, view, speak, connect, attach, react, readhistory, manage, embed)', required: true },
      action: { type: 'string', description: 'allow, deny, or reset', required: true },
    },
    async execute(guild, invoker, params) {
      // Resolve channel
      let channel = guild.channels.cache.get(params.channel);
      if (!channel) {
        const { match, suggestions } = findChannel(guild, params.channel);
        if (!match) return { success: false, message: notFoundMsg('Channel', params.channel, suggestions) };
        channel = match;
      }

      // Resolve target (role or user)
      let target;
      if (params.target.toLowerCase() === 'everyone' || params.target === '@everyone') {
        target = guild.roles.everyone;
      } else {
        // Try as role first
        const { match: role } = findRole(guild, params.target);
        if (role) {
          target = role;
        } else {
          // Try as user
          target = await guild.members.fetch(params.target).catch(() => null);
          if (!target) return { success: false, message: `Could not find role or user "${params.target}"` };
        }
      }

      // Resolve permission
      const permKey = resolvePermission(params.permission);
      if (!permKey) {
        const validPerms = [...new Set(Object.values(PERM_MAP))].sort().join(', ');
        return { success: false, message: `Unknown permission "${params.permission}". Valid: ${validPerms}` };
      }

      // Apply
      const action = params.action.toLowerCase();
      const overwrite = {};
      if (action === 'allow') {
        overwrite[permKey] = true;
      } else if (action === 'deny') {
        overwrite[permKey] = false;
      } else if (action === 'reset' || action === 'neutral') {
        overwrite[permKey] = null;
      } else {
        return { success: false, message: `Invalid action "${params.action}". Use: allow, deny, or reset` };
      }

      await channel.permissionOverwrites.edit(target.id || target, overwrite, { reason: 'Set by AI Agent' });
      const targetName = target.name || target.displayName || target.user?.tag || params.target;
      return { success: true, message: `Set **${permKey}** to **${action}** for **${targetName}** on #${channel.name}` };
    },
  },
  {
    name: 'copy_channel_permissions',
    description: 'Copy all permission overwrites from one channel to another',
    category: 'channels',
    requiredPermission: 3,
    destructive: false,
    parameters: {
      source: { type: 'string', description: 'Source channel name or ID to copy from', required: true },
      target: { type: 'string', description: 'Target channel name or ID to copy to', required: true },
    },
    async execute(guild, invoker, params) {
      // Resolve source
      let source = guild.channels.cache.get(params.source);
      if (!source) {
        const { match, suggestions } = findChannel(guild, params.source);
        if (!match) return { success: false, message: notFoundMsg('Source channel', params.source, suggestions) };
        source = match;
      }

      // Resolve target
      let target = guild.channels.cache.get(params.target);
      if (!target) {
        const { match, suggestions } = findChannel(guild, params.target);
        if (!match) return { success: false, message: notFoundMsg('Target channel', params.target, suggestions) };
        target = match;
      }

      // Copy overwrites
      const overwrites = source.permissionOverwrites.cache.map(o => ({
        id: o.id,
        allow: o.allow,
        deny: o.deny,
        type: o.type,
      }));

      await target.permissionOverwrites.set(overwrites, 'Permissions copied by AI Agent');
      return { success: true, message: `Copied permissions from #${source.name} to #${target.name} (${overwrites.length} overwrites)` };
    },
  },
  {
    name: 'sync_channel_permissions',
    description: 'Sync a channel\'s permissions with its parent category (reset to category defaults)',
    category: 'channels',
    requiredPermission: 3,
    destructive: false,
    parameters: {
      channel: { type: 'string', description: 'Channel name or ID to sync', required: true },
    },
    async execute(guild, invoker, params) {
      let channel = guild.channels.cache.get(params.channel);
      if (!channel) {
        const { match, suggestions } = findChannel(guild, params.channel);
        if (!match) return { success: false, message: notFoundMsg('Channel', params.channel, suggestions) };
        channel = match;
      }

      if (!channel.parent) {
        return { success: false, message: `#${channel.name} is not in a category — nothing to sync with` };
      }

      await channel.lockPermissions();
      return { success: true, message: `Synced #${channel.name} permissions with category "${channel.parent.name}"` };
    },
  },
  {
    name: 'lock_channel',
    description: 'Lock a channel — deny Send Messages for @everyone (quick lock)',
    category: 'channels',
    requiredPermission: 2,
    destructive: true,
    parameters: {
      channel: { type: 'string', description: 'Channel name or ID to lock', required: true },
      reason: { type: 'string', description: 'Reason for locking', required: false },
    },
    async execute(guild, invoker, params) {
      let channel = guild.channels.cache.get(params.channel);
      if (!channel) {
        const { match, suggestions } = findChannel(guild, params.channel);
        if (!match) return { success: false, message: notFoundMsg('Channel', params.channel, suggestions) };
        channel = match;
      }

      await channel.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: false,
        AddReactions: false,
      }, { reason: params.reason || 'Channel locked by AI Agent' });

      return { success: true, message: `Locked #${channel.name} — messages disabled for @everyone` };
    },
  },
  {
    name: 'unlock_channel',
    description: 'Unlock a channel — reset Send Messages for @everyone',
    category: 'channels',
    requiredPermission: 2,
    destructive: false,
    parameters: {
      channel: { type: 'string', description: 'Channel name or ID to unlock', required: true },
    },
    async execute(guild, invoker, params) {
      let channel = guild.channels.cache.get(params.channel);
      if (!channel) {
        const { match, suggestions } = findChannel(guild, params.channel);
        if (!match) return { success: false, message: notFoundMsg('Channel', params.channel, suggestions) };
        channel = match;
      }

      await channel.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: null,
        AddReactions: null,
      }, { reason: 'Channel unlocked by AI Agent' });

      return { success: true, message: `Unlocked #${channel.name} — messages re-enabled` };
    },
  },
  {
    name: 'create_invite',
    description: 'Create an invite link for a channel',
    category: 'channels',
    requiredPermission: 2,
    destructive: false,
    parameters: {
      channel: { type: 'string', description: 'Channel name or ID (defaults to first text channel)', required: false },
      maxAge: { type: 'number', description: 'Invite expiry in hours (0 = never, default 24)', required: false },
      maxUses: { type: 'number', description: 'Max uses (0 = unlimited, default 0)', required: false },
      temporary: { type: 'boolean', description: 'Temporary membership (kicked when they go offline, default false)', required: false },
    },
    async execute(guild, invoker, params) {
      let channel;
      if (params.channel) {
        channel = guild.channels.cache.get(params.channel);
        if (!channel) {
          const { match, suggestions } = findChannel(guild, params.channel);
          if (!match) return { success: false, message: notFoundMsg('Channel', params.channel, suggestions) };
          channel = match;
        }
      } else {
        // Default to first text channel or system channel
        channel = guild.systemChannel || guild.channels.cache.find(c => c.type === ChannelType.GuildText);
      }
      if (!channel) return { success: false, message: 'No suitable channel found to create invite' };

      const maxAge = (params.maxAge !== undefined ? params.maxAge : 24) * 3600; // convert hours to seconds
      const invite = await channel.createInvite({
        maxAge,
        maxUses: params.maxUses || 0,
        temporary: params.temporary || false,
        reason: 'Created by AI Agent',
      });

      const expiry = maxAge === 0 ? 'never' : `${params.maxAge || 24} hours`;
      const uses = invite.maxUses === 0 ? 'unlimited' : `${invite.maxUses} uses`;
      return { success: true, message: `**Invite link:** https://discord.gg/${invite.code}\nChannel: #${channel.name}\nExpires: ${expiry} | Uses: ${uses}` };
    },
  },
];
