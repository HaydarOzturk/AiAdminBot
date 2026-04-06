const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// Setup locale before permissions (it lazily requires locale)
process.env.LOCALE = 'en';
const { loadLocale } = require('../../../src/utils/locale');

const { createMockMember, createMockGuild } = require('../../helpers/mockDiscord');
const { TEST_OWNER_ID } = require('../../helpers/fixtures');

describe('permissions', () => {
  before(() => { loadLocale(); });

  // Lazy require to ensure locale is loaded first
  const { getPermissionLevel, hasPermission, getRequiredLevel } = require('../../../src/utils/permissions');

  describe('getPermissionLevel', () => {
    it('returns 4 for guild owner', () => {
      const guild = createMockGuild({ ownerId: TEST_OWNER_ID });
      const member = createMockMember({
        id: TEST_OWNER_ID,
        user: { id: TEST_OWNER_ID, username: 'Owner', bot: false, tag: 'Owner#0001', displayAvatarURL: () => '', send: async () => ({}), toString: () => `<@${TEST_OWNER_ID}>` },
        guild,
        permissions: [],
      });
      assert.equal(getPermissionLevel(member), 4);
    });

    it('returns 4 for DEBUG_OWNER_ID', () => {
      const debugId = '999999999999999999';
      process.env.DEBUG_OWNER_ID = debugId;
      const guild = createMockGuild();
      const member = createMockMember({
        id: debugId,
        user: { id: debugId, username: 'Debug', bot: false, tag: 'Debug#0001', displayAvatarURL: () => '', send: async () => ({}), toString: () => '' },
        guild,
        permissions: [],
      });
      assert.equal(getPermissionLevel(member), 4);
      delete process.env.DEBUG_OWNER_ID;
    });

    it('returns 3 for Administrator permission', () => {
      const guild = createMockGuild();
      const member = createMockMember({
        guild,
        permissions: ['Administrator'],
      });
      assert.equal(getPermissionLevel(member), 3);
    });

    it('returns 3 for ManageGuild permission', () => {
      const guild = createMockGuild();
      const member = createMockMember({
        guild,
        permissions: ['ManageGuild'],
      });
      assert.equal(getPermissionLevel(member), 3);
    });

    it('returns 2 for BanMembers permission', () => {
      const guild = createMockGuild();
      const member = createMockMember({
        guild,
        permissions: ['BanMembers'],
      });
      assert.equal(getPermissionLevel(member), 2);
    });

    it('returns 2 for ManageMessages permission', () => {
      const guild = createMockGuild();
      const member = createMockMember({
        guild,
        permissions: ['ManageMessages'],
      });
      assert.equal(getPermissionLevel(member), 2);
    });

    it('returns 3 for role name containing admin', () => {
      const guild = createMockGuild();
      const roles = new Map([
        ['r1', { name: 'Server Admin', id: 'r1' }],
      ]);
      const member = createMockMember({
        guild,
        permissions: [],
        roles,
      });
      assert.equal(getPermissionLevel(member), 3);
    });

    it('returns 2 for role name containing mod', () => {
      const guild = createMockGuild();
      const roles = new Map([
        ['r1', { name: 'Moderator', id: 'r1' }],
      ]);
      const member = createMockMember({
        guild,
        permissions: [],
        roles,
      });
      assert.equal(getPermissionLevel(member), 2);
    });

    it('returns 0 for member with no permissions', () => {
      const guild = createMockGuild();
      const member = createMockMember({
        guild,
        permissions: [],
      });
      assert.equal(getPermissionLevel(member), 0);
    });
  });

  describe('getRequiredLevel', () => {
    it('returns 0 for unknown commands', () => {
      assert.equal(getRequiredLevel('nonexistent-command'), 0);
    });
  });
});
