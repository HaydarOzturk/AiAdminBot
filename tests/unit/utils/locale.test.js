const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, cleanupTestDatabase } = require('../../helpers/mockDatabase');

// Set locale before loading module
process.env.LOCALE = 'en';

describe('locale', () => {
  before(async () => {
    await setupTestDatabase();
  });
  beforeEach(() => cleanupTestDatabase());

  const { loadLocale, t, channelName, getAllAiChatNames, setGuildLocale, getLocale, getLocaleStrings } = require('../../../src/utils/locale');

  before(() => { loadLocale(); });

  describe('t()', () => {
    it('returns a translated string for a valid key', () => {
      const result = t('verification.successTitle');
      assert.equal(typeof result, 'string');
      assert.notEqual(result, 'verification.successTitle');
    });

    it('returns the key itself for a missing key', () => {
      const result = t('nonexistent.key.here');
      assert.equal(result, 'nonexistent.key.here');
    });

    it('replaces placeholders with values', () => {
      // Find a key that uses {user} or similar placeholder
      const result = t('verification.successDesc', { user: 'Ahmet' });
      assert.equal(typeof result, 'string');
      // If the template has {user}, it should be replaced
      assert.ok(!result.includes('{user}') || result === 'verification.successDesc');
    });
  });

  describe('channelName()', () => {
    it('returns a localized channel name', () => {
      const name = channelName('ai-chat');
      assert.equal(typeof name, 'string');
      assert.ok(name.length > 0);
    });

    it('falls back to id for unknown channel', () => {
      const name = channelName('nonexistent-channel-xyz');
      assert.equal(name, 'nonexistent-channel-xyz');
    });
  });

  describe('getAllAiChatNames()', () => {
    it('returns a Set', () => {
      const names = getAllAiChatNames();
      assert.ok(names instanceof Set);
    });

    it('contains default ai-chat names', () => {
      const names = getAllAiChatNames();
      assert.ok(names.has('ai-sohbet'));
      assert.ok(names.has('ai-chat'));
    });
  });

  describe('getLocale()', () => {
    it('returns default locale when no guild specified', () => {
      const locale = getLocale();
      assert.equal(locale, 'en');
    });
  });

  describe('setGuildLocale + getLocale', () => {
    it('persists guild locale through DB', () => {
      setGuildLocale('test-guild-1', 'de');
      const locale = getLocale('test-guild-1');
      assert.equal(locale, 'de');
    });
  });

  describe('getLocaleStrings()', () => {
    it('returns strings for a valid locale', () => {
      const strs = getLocaleStrings('en');
      assert.equal(typeof strs, 'object');
      assert.ok(strs.verification);
    });

    it('falls back for unknown locale', () => {
      const strs = getLocaleStrings('zz');
      assert.equal(typeof strs, 'object');
    });
  });
});
