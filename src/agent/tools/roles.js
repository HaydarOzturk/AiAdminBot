const { findRole, notFoundMsg } = require('../fuzzyMatch');

module.exports = [
  {
    name: 'give_role',
    description: 'Give a role to a user',
    category: 'roles',
    requiredPermission: 2,
    destructive: false,
    parameters: {
      userId: { type: 'string', description: 'User ID or mention', required: true },
      roleName: { type: 'string', description: 'Role name', required: true },
    },
    async execute(guild, invoker, params) {
      const member = await guild.members.fetch(params.userId).catch(() => null);
      if (!member) return { success: false, message: 'User not found' };

      const { match: role, suggestions } = findRole(guild, params.roleName);
      if (!role) return { success: false, message: notFoundMsg('Role', params.roleName, suggestions) };

      await member.roles.add(role);
      return { success: true, message: `Gave role "${role.name}" to ${member.user.tag}` };
    },
  },
  {
    name: 'remove_role',
    description: 'Remove a role from a user',
    category: 'roles',
    requiredPermission: 2,
    destructive: false,
    parameters: {
      userId: { type: 'string', description: 'User ID or mention', required: true },
      roleName: { type: 'string', description: 'Role name', required: true },
    },
    async execute(guild, invoker, params) {
      const member = await guild.members.fetch(params.userId).catch(() => null);
      if (!member) return { success: false, message: 'User not found' };

      const { match: role, suggestions } = findRole(guild, params.roleName);
      if (!role) return { success: false, message: notFoundMsg('Role', params.roleName, suggestions) };

      await member.roles.remove(role);
      return { success: true, message: `Removed role "${role.name}" from ${member.user.tag}` };
    },
  },
  {
    name: 'create_role',
    description: 'Create a new role',
    category: 'roles',
    requiredPermission: 3,
    destructive: false,
    parameters: {
      name: { type: 'string', description: 'Role name', required: true },
      color: { type: 'string', description: 'Hex color (e.g., #FF5733)', required: false },
    },
    async execute(guild, invoker, params) {
      const options = { name: params.name, reason: 'Created by AI Agent' };
      if (params.color) options.color = params.color;
      const role = await guild.roles.create(options);
      return { success: true, message: `Created role "${role.name}"` };
    },
  },
];
