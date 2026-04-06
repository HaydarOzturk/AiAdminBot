const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, cleanupTestDatabase } = require('../../helpers/mockDatabase');
const { createMockInteraction, createMockUser, createMockMember, createMockGuild } = require('../../helpers/mockDiscord');
const { TEST_GUILD_ID, TEST_USER_ID, TEST_MOD_ID } = require('../../helpers/fixtures');

process.env.LOCALE = 'en';
const { loadLocale } = require('../../../src/utils/locale');

describe('/warn command', () => {
  before(async () => {
    loadLocale();
    await setupTestDatabase();
  });
  beforeEach(() => cleanupTestDatabase());

  const warnCmd = require('../../../src/commands/moderation/warn');
  const db = require('../../../src/utils/database');

  it('has correct command data', () => {
    assert.equal(warnCmd.data.name, 'warn');
  });

  it('rejects users without permission', async () => {
    const guild = createMockGuild({ id: TEST_GUILD_ID });
    const member = createMockMember({
      id: TEST_USER_ID,
      guild,
      permissions: [],
    });

    const interaction = createMockInteraction({
      commandName: 'warn',
      guild,
      member,
      optionValues: {
        user: createMockUser({ id: '999' }),
        reason: 'test',
      },
    });

    await warnCmd.execute(interaction);

    assert.ok(interaction._replies.length >= 1);
    // Should be ephemeral (permission denied)
    const reply = interaction._replies[0];
    assert.ok(reply.flags);
  });

  it('warns a user and saves to database', async () => {
    const targetUser = createMockUser({ id: '777777777777777777', tag: 'Target#0001' });
    const guild = createMockGuild({ id: TEST_GUILD_ID });
    const targetMember = createMockMember({ user: targetUser, guild });
    guild.members.cache = new Map([['777777777777777777', targetMember]]);
    guild.members.fetch = async () => targetMember;

    const modMember = createMockMember({
      id: TEST_MOD_ID,
      guild,
      permissions: ['BanMembers'], // Level 2 — moderator
    });

    const interaction = createMockInteraction({
      commandName: 'warn',
      guild,
      member: modMember,
      optionValues: {
        user: targetUser,
        reason: 'spamming in chat',
      },
    });

    await warnCmd.execute(interaction);

    // Check DB
    const warning = db.get(
      'SELECT * FROM warnings WHERE user_id = ? AND guild_id = ?',
      ['777777777777777777', TEST_GUILD_ID]
    );
    assert.ok(warning, 'Warning should be saved to DB');
    assert.equal(warning.reason, 'spamming in chat');
    assert.equal(warning.moderator_id, TEST_MOD_ID);

    // Check mod_actions log
    const action = db.get(
      'SELECT * FROM mod_actions WHERE user_id = ? AND guild_id = ?',
      ['777777777777777777', TEST_GUILD_ID]
    );
    assert.ok(action, 'Mod action should be logged');
    assert.equal(action.action_type, 'warn');

    // Check reply has embed (not ephemeral = successful warn)
    assert.ok(interaction._replies.length >= 1);
    const reply = interaction._replies[0];
    assert.ok(reply.embeds, 'Reply should contain an embed');
  });

  it('prevents warning yourself', async () => {
    const guild = createMockGuild({ id: TEST_GUILD_ID });
    const selfUser = createMockUser({ id: TEST_MOD_ID });
    const member = createMockMember({
      id: TEST_MOD_ID,
      user: selfUser,
      guild,
      permissions: ['BanMembers'],
    });

    const interaction = createMockInteraction({
      commandName: 'warn',
      guild,
      member,
      optionValues: {
        user: selfUser, // warning yourself
        reason: 'self warn test',
      },
    });

    // Mock guild.members.fetch to return the member
    guild.members.fetch = async () => member;

    await warnCmd.execute(interaction);

    // Should be ephemeral rejection
    const reply = interaction._replies[0];
    assert.ok(reply.flags);

    // No warning in DB
    const warning = db.get(
      'SELECT * FROM warnings WHERE user_id = ? AND guild_id = ?',
      [TEST_MOD_ID, TEST_GUILD_ID]
    );
    assert.equal(warning, null);
  });

  it('prevents warning a bot', async () => {
    const botUser = createMockUser({ id: '888', bot: true, tag: 'Bot#0001' });
    const guild = createMockGuild({
      id: TEST_GUILD_ID,
      membersCache: new Map([
        ['888', createMockMember({ user: botUser })],
      ]),
    });

    const modMember = createMockMember({
      id: TEST_MOD_ID,
      guild,
      permissions: ['BanMembers'],
    });

    const interaction = createMockInteraction({
      commandName: 'warn',
      guild,
      member: modMember,
      optionValues: {
        user: botUser,
        reason: 'bot warn test',
      },
    });

    await warnCmd.execute(interaction);

    // Should be ephemeral rejection
    const reply = interaction._replies[0];
    assert.ok(reply.flags);
  });
});
