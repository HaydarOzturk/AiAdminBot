const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, cleanupTestDatabase } = require('../../helpers/mockDatabase');
const { TEST_USER_ID, TEST_GUILD_ID } = require('../../helpers/fixtures');

// Setup locale before leveling (it uses loadConfig)
process.env.LOCALE = 'en';
const { loadLocale } = require('../../../src/utils/locale');

describe('leveling', () => {
  before(async () => {
    loadLocale();
    await setupTestDatabase();
  });
  beforeEach(() => cleanupTestDatabase());

  const {
    xpForLevel, totalXpForLevel, getTierForLevel,
    awardXp, getUserData, getLeaderboard,
  } = require('../../../src/systems/leveling');
  const db = require('../../../src/utils/database');

  describe('xpForLevel()', () => {
    it('returns 100 for level 0', () => {
      // 5*0 + 50*0 + 100 = 100
      assert.equal(xpForLevel(0), 100);
    });

    it('returns 155 for level 1', () => {
      // 5*1 + 50*1 + 100 = 155
      assert.equal(xpForLevel(1), 155);
    });

    it('returns 475 for level 5', () => {
      // 5*25 + 50*5 + 100 = 125 + 250 + 100 = 475
      assert.equal(xpForLevel(5), 475);
    });

    it('returns 1100 for level 10', () => {
      // 5*100 + 50*10 + 100 = 500 + 500 + 100 = 1100
      assert.equal(xpForLevel(10), 1100);
    });

    it('increases with level (monotonic)', () => {
      for (let i = 0; i < 20; i++) {
        assert.ok(xpForLevel(i + 1) > xpForLevel(i));
      }
    });
  });

  describe('totalXpForLevel()', () => {
    it('returns 0 for level 0', () => {
      assert.equal(totalXpForLevel(0), 0);
    });

    it('returns 100 for level 1', () => {
      // Need xpForLevel(0) = 100 to go from 0 to 1
      assert.equal(totalXpForLevel(1), 100);
    });

    it('returns 255 for level 2', () => {
      // 100 + 155 = 255
      assert.equal(totalXpForLevel(2), 255);
    });

    it('equals sum of xpForLevel(0..n-1)', () => {
      for (let level = 0; level <= 10; level++) {
        let sum = 0;
        for (let i = 0; i < level; i++) sum += xpForLevel(i);
        assert.equal(totalXpForLevel(level), sum);
      }
    });
  });

  describe('awardXp()', () => {
    it('creates user record if none exists', () => {
      awardXp(TEST_USER_ID, TEST_GUILD_ID, 10);

      const data = db.get(
        'SELECT * FROM levels WHERE user_id = ? AND guild_id = ?',
        [TEST_USER_ID, TEST_GUILD_ID]
      );
      assert.ok(data);
      assert.equal(data.xp, 10);
      assert.equal(data.level, 0);
    });

    it('accumulates XP without level-up', () => {
      awardXp(TEST_USER_ID, TEST_GUILD_ID, 10);
      awardXp(TEST_USER_ID, TEST_GUILD_ID, 20);

      const data = db.get(
        'SELECT * FROM levels WHERE user_id = ? AND guild_id = ?',
        [TEST_USER_ID, TEST_GUILD_ID]
      );
      assert.equal(data.xp, 30);
      assert.equal(data.level, 0);
    });

    it('handles level-up correctly', () => {
      // Level 0 needs 100 XP to level up
      const result = awardXp(TEST_USER_ID, TEST_GUILD_ID, 120);

      assert.equal(result.oldLevel, 0);
      assert.equal(result.newLevel, 1);
      assert.equal(result.xp, 20); // 120 - 100 = 20 remaining
    });

    it('handles multi-level-up', () => {
      // Level 0=100, Level 1=155 → total 255 for level 2
      const result = awardXp(TEST_USER_ID, TEST_GUILD_ID, 300);

      assert.equal(result.oldLevel, 0);
      assert.equal(result.newLevel, 2);
      assert.equal(result.xp, 45); // 300 - 100 - 155 = 45
    });

    it('returns tier info', () => {
      const result = awardXp(TEST_USER_ID, TEST_GUILD_ID, 10);
      // tier may be null if config has no tiers, or an object
      assert.ok('tier' in result);
      assert.ok('tierChanged' in result);
    });
  });

  describe('getUserData()', () => {
    it('returns zeroed defaults for unknown user', () => {
      const data = getUserData('unknown', TEST_GUILD_ID);
      assert.equal(data.xp, 0);
      assert.equal(data.level, 0);
      assert.equal(data.messages, 0);
      assert.equal(data.xpNeeded, 100);
      assert.equal(data.rank, null);
    });

    it('returns correct data after awarding XP', () => {
      awardXp(TEST_USER_ID, TEST_GUILD_ID, 50);
      const data = getUserData(TEST_USER_ID, TEST_GUILD_ID);

      assert.equal(data.xp, 50);
      assert.equal(data.level, 0);
      assert.equal(data.xpNeeded, 100);
      assert.equal(data.rank, 1); // Only user → rank 1
    });

    it('returns correct rank with multiple users', () => {
      awardXp('user_a', TEST_GUILD_ID, 200); // Level 1
      awardXp('user_b', TEST_GUILD_ID, 50);  // Level 0

      const dataA = getUserData('user_a', TEST_GUILD_ID);
      const dataB = getUserData('user_b', TEST_GUILD_ID);

      assert.equal(dataA.rank, 1);
      assert.equal(dataB.rank, 2);
    });
  });

  describe('getLeaderboard()', () => {
    it('returns empty array for guild with no users', () => {
      const lb = getLeaderboard(TEST_GUILD_ID);
      assert.deepEqual(lb, []);
    });

    it('orders by level DESC, xp DESC', () => {
      awardXp('user_a', TEST_GUILD_ID, 50);   // Level 0, 50 xp
      awardXp('user_b', TEST_GUILD_ID, 200);  // Level 1, 100 xp
      awardXp('user_c', TEST_GUILD_ID, 80);   // Level 0, 80 xp

      const lb = getLeaderboard(TEST_GUILD_ID);

      assert.equal(lb.length, 3);
      assert.equal(lb[0].user_id, 'user_b');  // Highest level
      assert.equal(lb[1].user_id, 'user_c');  // Same level, more xp
      assert.equal(lb[2].user_id, 'user_a');  // Same level, less xp
    });

    it('respects limit parameter', () => {
      awardXp('user_a', TEST_GUILD_ID, 10);
      awardXp('user_b', TEST_GUILD_ID, 20);
      awardXp('user_c', TEST_GUILD_ID, 30);

      const lb = getLeaderboard(TEST_GUILD_ID, 2);
      assert.equal(lb.length, 2);
    });
  });
});
