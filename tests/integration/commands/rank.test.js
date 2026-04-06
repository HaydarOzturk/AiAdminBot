const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, cleanupTestDatabase } = require('../../helpers/mockDatabase');
const { createMockInteraction, createMockUser, createMockMember, createMockGuild } = require('../../helpers/mockDiscord');
const { TEST_GUILD_ID, TEST_USER_ID } = require('../../helpers/fixtures');

process.env.LOCALE = 'en';
const { loadLocale } = require('../../../src/utils/locale');

describe('/rank command', () => {
  before(async () => {
    loadLocale();
    await setupTestDatabase();
  });
  beforeEach(() => cleanupTestDatabase());

  const rankCmd = require('../../../src/commands/leveling/rank');
  const leveling = require('../../../src/systems/leveling');

  it('has correct command data', () => {
    assert.equal(rankCmd.data.name, 'rank');
  });

  it('shows level 0 for new user', async () => {
    const guild = createMockGuild({ id: TEST_GUILD_ID });
    const member = createMockMember({ id: TEST_USER_ID, guild });

    const interaction = createMockInteraction({
      commandName: 'rank',
      guild,
      member,
      optionValues: {},
    });

    await rankCmd.execute(interaction);

    assert.ok(interaction._replies.length >= 1);
    const reply = interaction._replies[0];
    assert.ok(reply.embeds);

    const embed = reply.embeds[0];
    // Should show level 0
    const levelField = embed.data.fields.find(f =>
      f.value === '0'
    );
    assert.ok(levelField, 'Should show level 0 for new user');
  });

  it('shows correct data after XP award', async () => {
    // Award some XP first
    leveling.awardXp(TEST_USER_ID, TEST_GUILD_ID, 50);

    const guild = createMockGuild({ id: TEST_GUILD_ID });
    const member = createMockMember({ id: TEST_USER_ID, guild });

    const interaction = createMockInteraction({
      commandName: 'rank',
      guild,
      member,
      optionValues: {},
    });

    await rankCmd.execute(interaction);

    const embed = interaction._replies[0].embeds[0];
    // Should show xp 50 / 100
    const xpField = embed.data.fields.find(f =>
      f.value.includes('50')
    );
    assert.ok(xpField, 'Should show 50 XP');
  });

  it('can view another user rank', async () => {
    const otherUser = createMockUser({ id: '999999999999999999', username: 'OtherUser' });
    leveling.awardXp('999999999999999999', TEST_GUILD_ID, 200);

    const guild = createMockGuild({ id: TEST_GUILD_ID });
    const member = createMockMember({ id: TEST_USER_ID, guild });

    const interaction = createMockInteraction({
      commandName: 'rank',
      guild,
      member,
      optionValues: { user: otherUser },
    });

    await rankCmd.execute(interaction);

    const embed = interaction._replies[0].embeds[0];
    assert.ok(embed.data.title.includes('OtherUser'));
  });
});
