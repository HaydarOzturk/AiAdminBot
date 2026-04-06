/**
 * Discord.js mock factories for testing
 *
 * Creates plain objects mimicking Discord.js structures.
 * Interactions record replies in _replies for assertions.
 */

const {
  TEST_GUILD_ID, TEST_USER_ID, TEST_BOT_ID, TEST_OWNER_ID, TEST_CHANNEL_ID,
} = require('./fixtures');

function createMockUser(overrides = {}) {
  return {
    id: overrides.id || TEST_USER_ID,
    tag: overrides.tag || 'TestUser#0001',
    username: overrides.username || 'TestUser',
    bot: overrides.bot || false,
    displayAvatarURL: () => 'https://example.com/avatar.png',
    send: async () => ({}),
    toString: () => `<@${overrides.id || TEST_USER_ID}>`,
    ...overrides,
  };
}

function createMockMember(overrides = {}) {
  const user = overrides.user || createMockUser(overrides);
  const guild = overrides.guild || createMockGuild();

  const roleCache = createCollectionLike(overrides.roles || new Map());
  const permsList = overrides.permissions || [];

  // Extract known fields so they don't override computed props
  const { permissions: _p, user: _u, guild: _g, roles: _r, ...rest } = overrides;

  return {
    id: user.id,
    user,
    guild,
    displayName: overrides.displayName || user.username,
    roles: {
      cache: roleCache,
      add: async () => {},
      remove: async () => {},
    },
    permissions: {
      has: (perm) => permsList.includes(perm),
    },
    moderatable: overrides.moderatable ?? true,
    timeout: async () => {},
    kick: async () => {},
    ban: async () => {},
    ...rest,
  };
}

function createCollectionLike(map) {
  const col = new Map(map);
  col.map = (fn) => [...col.values()].map(fn);
  col.filter = (fn) => {
    const filtered = createCollectionLike(new Map());
    for (const [k, v] of col) {
      if (fn(v, k)) filtered.set(k, v);
    }
    return filtered;
  };
  col.some = (fn) => [...col.values()].some(fn);
  col.find = (fn) => [...col.values()].find(fn);
  col.first = () => [...col.values()][0] || null;
  col.size = col.size;
  return col;
}

function createMockGuild(overrides = {}) {
  const membersCache = createCollectionLike(overrides.membersCache || new Map());
  const channelsCache = createCollectionLike(overrides.channelsCache || new Map());
  const rolesCache = createCollectionLike(overrides.rolesCache || new Map());

  return {
    id: overrides.id || TEST_GUILD_ID,
    name: overrides.name || 'Test Guild',
    ownerId: overrides.ownerId || TEST_OWNER_ID,
    memberCount: overrides.memberCount || 50,
    members: {
      cache: membersCache,
      fetch: async (id) => membersCache.get(id) || null,
    },
    channels: {
      cache: channelsCache,
      create: async (opts) => ({ id: '999', name: opts.name }),
    },
    roles: {
      cache: rolesCache,
      create: async (opts) => ({ id: '999', name: opts.name }),
    },
    iconURL: () => null,
    ...overrides,
  };
}

function createMockChannel(overrides = {}) {
  return {
    id: overrides.id || TEST_CHANNEL_ID,
    name: overrides.name || 'general',
    send: async (data) => ({ id: '999', ...data }),
    isTextBased: () => true,
    ...overrides,
  };
}

function createMockInteraction(overrides = {}) {
  const replies = [];
  const followUps = [];
  let replied = false;
  let deferred = false;

  const guild = overrides.guild || createMockGuild();
  const member = overrides.member || createMockMember({ guild });
  const user = member.user;

  return {
    guild,
    member,
    user,
    channel: overrides.channel || createMockChannel(),
    commandName: overrides.commandName || 'test',
    client: overrides.client || {
      ws: { ping: 42 },
      user: { id: TEST_BOT_ID, username: 'AiAdminBot' },
    },
    options: {
      getUser: (name) => overrides.optionValues?.[name] || null,
      getMember: (name) => overrides.optionValues?.[`${name}_member`] || null,
      getString: (name) => overrides.optionValues?.[name] || null,
      getInteger: (name) => overrides.optionValues?.[name] ?? null,
      getNumber: (name) => overrides.optionValues?.[name] ?? null,
      getBoolean: (name) => overrides.optionValues?.[name] ?? null,
      getSubcommand: () => overrides.subcommand || null,
      getChannel: (name) => overrides.optionValues?.[name] || null,
      getRole: (name) => overrides.optionValues?.[name] || null,
      ...overrides.options,
    },
    reply: async (data) => {
      replied = true;
      replies.push(data);
      return { createdTimestamp: Date.now(), ...data };
    },
    editReply: async (data) => { replies.push(data); },
    followUp: async (data) => { followUps.push(data); },
    deferReply: async () => { deferred = true; },
    isChatInputCommand: () => overrides.isChatInput ?? true,
    isAutocomplete: () => overrides.isAutocomplete ?? false,
    isButton: () => overrides.isButton ?? false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    customId: overrides.customId || '',
    locale: overrides.locale || 'en-US',

    // Expose for assertions
    _replies: replies,
    _followUps: followUps,
    get _replied() { return replied; },
    get _deferred() { return deferred; },
  };
}

function createMockMessage(overrides = {}) {
  const guild = overrides.guild || createMockGuild();
  const author = overrides.author || createMockUser();
  const member = overrides.member || createMockMember({ user: author, guild });

  return {
    id: overrides.id || '888888888888888888',
    author,
    guild,
    member,
    channel: overrides.channel || createMockChannel(),
    content: overrides.content || 'Hello world',
    mentions: {
      users: { size: overrides.mentionCount || 0 },
      roles: { size: 0 },
      everyone: overrides.mentionsEveryone || false,
    },
    delete: async () => {},
    reply: async (data) => ({ id: '999', ...data }),
    client: overrides.client || {
      user: { id: TEST_BOT_ID },
    },
    createdTimestamp: overrides.createdTimestamp || Date.now(),
    ...overrides,
  };
}

module.exports = {
  createMockUser,
  createMockMember,
  createMockGuild,
  createMockChannel,
  createMockInteraction,
  createMockMessage,
};
