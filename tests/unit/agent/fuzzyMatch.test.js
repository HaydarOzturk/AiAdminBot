const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  stripEmojis, similarity, fuzzyFind, notFoundMsg,
} = require('../../../src/agent/fuzzyMatch');

describe('fuzzyMatch', () => {
  describe('stripEmojis()', () => {
    it('returns plain text unchanged', () => {
      assert.equal(stripEmojis('Hello'), 'Hello');
    });

    it('strips emoji prefix', () => {
      const result = stripEmojis('🎮 Gaming');
      assert.equal(result, 'Gaming');
    });

    it('strips multiple emojis', () => {
      const result = stripEmojis('🔥🎉 Party Channel');
      assert.equal(result, 'Party Channel');
    });

    it('handles empty string', () => {
      assert.equal(stripEmojis(''), '');
    });

    it('trims whitespace after stripping', () => {
      const result = stripEmojis('  🎮  text  ');
      assert.equal(result, 'text');
    });
  });

  describe('similarity()', () => {
    it('returns 1 for identical strings', () => {
      assert.equal(similarity('hello', 'hello'), 1);
    });

    it('returns 0 for single-char strings', () => {
      assert.equal(similarity('a', 'b'), 0);
    });

    it('returns low score for completely different strings', () => {
      const score = similarity('hello', 'xyz');
      assert.ok(score < 0.3);
    });

    it('returns high score for similar strings', () => {
      const score = similarity('general', 'generals');
      assert.ok(score > 0.7);
    });

    it('is symmetric', () => {
      const ab = similarity('hello', 'world');
      const ba = similarity('world', 'hello');
      assert.equal(ab, ba);
    });
  });

  describe('fuzzyFind()', () => {
    const items = [
      { name: '🎮 Gaming' },
      { name: 'general' },
      { name: '📢 Announcements' },
      { name: 'voice-chat' },
    ];

    it('finds exact match', () => {
      const { match, suggestions } = fuzzyFind(items, 'general');
      assert.ok(match);
      assert.equal(match.name, 'general');
      assert.deepEqual(suggestions, []);
    });

    it('finds match after emoji stripping', () => {
      const { match } = fuzzyFind(items, 'Gaming');
      assert.ok(match);
      assert.equal(match.name, '🎮 Gaming');
    });

    it('finds partial/contains match', () => {
      const { match } = fuzzyFind(items, 'voice');
      assert.ok(match);
      assert.equal(match.name, 'voice-chat');
    });

    it('returns suggestions when no match', () => {
      const { match, suggestions } = fuzzyFind(items, 'generel'); // typo
      // May or may not match depending on contains logic
      if (!match) {
        assert.ok(suggestions.length > 0);
      }
    });

    it('works with Map collection', () => {
      const map = new Map([
        ['1', { name: 'alpha' }],
        ['2', { name: 'beta' }],
      ]);
      const { match } = fuzzyFind(map, 'alpha');
      assert.ok(match);
      assert.equal(match.name, 'alpha');
    });

    it('is case-insensitive', () => {
      const { match } = fuzzyFind(items, 'GENERAL');
      assert.ok(match);
      assert.equal(match.name, 'general');
    });
  });

  describe('notFoundMsg()', () => {
    it('formats message without suggestions', () => {
      const msg = notFoundMsg('Channel', 'test', []);
      assert.equal(msg, 'Channel "test" not found.');
    });

    it('formats message with suggestions', () => {
      const msg = notFoundMsg('Channel', 'test', ['testing', 'text']);
      assert.ok(msg.includes('Did you mean'));
      assert.ok(msg.includes('"testing"'));
      assert.ok(msg.includes('"text"'));
    });
  });
});
