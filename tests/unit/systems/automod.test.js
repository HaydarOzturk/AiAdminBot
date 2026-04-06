const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, cleanupTestDatabase } = require('../../helpers/mockDatabase');
const { createMockMessage } = require('../../helpers/mockDiscord');
const { TEST_USER_ID, TEST_GUILD_ID } = require('../../helpers/fixtures');

// Setup locale before automod
process.env.LOCALE = 'en';
const { loadLocale } = require('../../../src/utils/locale');

describe('automod', () => {
  before(async () => {
    loadLocale();
    await setupTestDatabase();
  });
  beforeEach(() => cleanupTestDatabase());

  // These are internal functions — require the module to access them
  // Since they're not all exported, we test through getAutomodSettings + checkMessage
  const automod = require('../../../src/systems/automod');
  const db = require('../../../src/utils/database');

  // Helper to create automod settings in DB
  function enableAutomod(overrides = {}) {
    db.run(
      `INSERT INTO automod_settings (guild_id, anti_spam, anti_raid, anti_mention_spam, anti_caps, anti_invites, progressive_punishments, spam_threshold, spam_window, max_mentions, max_caps_percent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        TEST_GUILD_ID,
        overrides.anti_spam ?? 1,
        overrides.anti_raid ?? 0,
        overrides.anti_mention_spam ?? 1,
        overrides.anti_caps ?? 1,
        overrides.anti_invites ?? 1,
        overrides.progressive ?? 1,
        overrides.spam_threshold ?? 5,
        overrides.spam_window ?? 5,
        overrides.max_mentions ?? 5,
        overrides.max_caps_percent ?? 70,
      ]
    );
  }

  describe('getAutomodSettings()', () => {
    it('returns null for unconfigured guild', () => {
      const settings = automod.getAutomodSettings('unconfigured');
      assert.equal(settings, null);
    });

    it('returns settings object for configured guild', () => {
      enableAutomod();
      const settings = automod.getAutomodSettings(TEST_GUILD_ID);

      assert.ok(settings);
      assert.equal(settings.antiSpam, true);
      assert.equal(settings.antiMentionSpam, true);
      assert.equal(settings.antiCaps, true);
      assert.equal(settings.antiInvites, true);
      assert.equal(settings.spamThreshold, 5);
      assert.equal(settings.maxMentions, 5);
      assert.equal(settings.maxCapsPercent, 70);
    });

    it('returns false for disabled features', () => {
      enableAutomod({ anti_spam: 0, anti_caps: 0 });
      const settings = automod.getAutomodSettings(TEST_GUILD_ID);

      assert.equal(settings.antiSpam, false);
      assert.equal(settings.antiCaps, false);
      assert.equal(settings.antiInvites, true); // still enabled
    });
  });

  describe('getPunishment() — exported', () => {
    it('returns warn for 0 prior infractions', () => {
      const p = automod.getPunishment(0);
      assert.equal(p.action, 'warn');
      assert.equal(p.duration, 0);
    });

    it('returns 5min timeout for 1 prior infraction', () => {
      const p = automod.getPunishment(1);
      assert.equal(p.action, 'timeout');
      assert.equal(p.duration, 5 * 60 * 1000);
    });

    it('returns 30min timeout for 2 prior infractions', () => {
      const p = automod.getPunishment(2);
      assert.equal(p.action, 'timeout');
      assert.equal(p.duration, 30 * 60 * 1000);
    });

    it('returns 24h timeout for 3+ prior infractions', () => {
      const p = automod.getPunishment(3);
      assert.equal(p.action, 'timeout');
      assert.equal(p.duration, 24 * 60 * 60 * 1000);
    });
  });

  describe('addInfraction + getInfractionCount — exported', () => {
    it('starts with 0 infractions for clean user', () => {
      const count = automod.getInfractionCount(TEST_USER_ID, TEST_GUILD_ID);
      assert.equal(count, 0);
    });

    it('counts infractions added via exported function', () => {
      automod.addInfraction(TEST_USER_ID, TEST_GUILD_ID, 'spam', 'test spam');
      automod.addInfraction(TEST_USER_ID, TEST_GUILD_ID, 'ai_toxicity', 'AI-detected');

      const count = automod.getInfractionCount(TEST_USER_ID, TEST_GUILD_ID);
      assert.equal(count, 2);
    });

    it('tracks infractions from both automod and AI sources', () => {
      // Simulate automod catching spam
      automod.addInfraction(TEST_USER_ID, TEST_GUILD_ID, 'spam', 'rapid fire');
      // Simulate AI moderation catching toxicity
      automod.addInfraction(TEST_USER_ID, TEST_GUILD_ID, 'ai_toxicity', 'AI flagged');

      const count = automod.getInfractionCount(TEST_USER_ID, TEST_GUILD_ID);
      assert.equal(count, 2);

      // Progressive punishment should escalate
      const p = automod.getPunishment(count);
      assert.equal(p.action, 'timeout');
      assert.equal(p.duration, 30 * 60 * 1000); // 30 min for 2nd offense
    });
  });

  describe('checkSpam() via internal tracker', () => {
    // checkSpam is not exported directly, but we can test
    // the full checkMessage flow or test getAutomodSettings
    // For now, we validate the settings are read correctly
    it('settings control spam threshold', () => {
      enableAutomod({ spam_threshold: 3, spam_window: 10 });
      const settings = automod.getAutomodSettings(TEST_GUILD_ID);
      assert.equal(settings.spamThreshold, 3);
      assert.equal(settings.spamWindow, 10);
    });
  });

  describe('invite regex detection', () => {
    // Test the regex pattern used for invite detection
    const INVITE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/\S+/gi;

    it('matches discord.gg links', () => {
      assert.ok(INVITE_REGEX.test('discord.gg/test'));
    });

    it('matches discord.com/invite links', () => {
      INVITE_REGEX.lastIndex = 0;
      assert.ok(INVITE_REGEX.test('https://discord.com/invite/abc123'));
    });

    it('matches discordapp.com/invite links', () => {
      INVITE_REGEX.lastIndex = 0;
      assert.ok(INVITE_REGEX.test('https://discordapp.com/invite/xyz'));
    });

    it('does not match regular URLs', () => {
      INVITE_REGEX.lastIndex = 0;
      assert.ok(!INVITE_REGEX.test('https://google.com'));
    });

    it('does not match plain text', () => {
      INVITE_REGEX.lastIndex = 0;
      assert.ok(!INVITE_REGEX.test('Hello world'));
    });
  });

  describe('caps detection logic', () => {
    // Replicate the caps detection logic for unit testing
    function checkCapsLogic(content, maxPercent = 70) {
      if (content.length < 10) return false;
      const letters = content.replace(/[^a-zA-ZÀ-ÿ]/g, '');
      if (letters.length < 8) return false;
      const upperCount = (content.match(/[A-ZÀ-Ý]/g) || []).length;
      const percent = (upperCount / letters.length) * 100;
      return percent >= maxPercent;
    }

    it('ignores short messages', () => {
      assert.equal(checkCapsLogic('HI'), false);
    });

    it('ignores messages with few letters', () => {
      assert.equal(checkCapsLogic('123456789!'), false);
    });

    it('flags 100% caps message', () => {
      assert.equal(checkCapsLogic('THIS IS ALL CAPS MESSAGE'), true);
    });

    it('allows normal mixed case', () => {
      assert.equal(checkCapsLogic('This is a normal message with mixed case'), false);
    });

    it('respects threshold percentage', () => {
      // "AAAA BBBB cccc dddd" - 8 upper / 16 letters = 50%
      assert.equal(checkCapsLogic('AAAA BBBB cccc dddd', 50), true);
      assert.equal(checkCapsLogic('AAAA BBBB cccc dddd', 60), false);
    });
  });
});
