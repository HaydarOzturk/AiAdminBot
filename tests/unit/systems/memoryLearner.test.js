const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, cleanupTestDatabase } = require('../../helpers/mockDatabase');
const { TEST_GUILD_ID, TEST_USER_ID, TEST_CHANNEL_ID } = require('../../helpers/fixtures');

process.env.LOCALE = 'en';
const { loadLocale } = require('../../../src/utils/locale');

describe('memoryLearner', () => {
  before(async () => {
    loadLocale();
    await setupTestDatabase();
  });
  beforeEach(() => cleanupTestDatabase());

  const {
    computeFullScore, extractNgrams, clusterMessages,
    getChannelWeight, getConfig,
  } = require('../../../src/systems/memoryLearner');
  const db = require('../../../src/utils/database');

  describe('getConfig()', () => {
    it('returns defaults for unconfigured guild', () => {
      const config = getConfig('unconfigured');
      assert.equal(config.reaction_weight, 1.0);
      assert.equal(config.reply_weight, 2.0);
      assert.equal(config.bot_mention_weight, 10.0);
      assert.equal(config.candidacy_threshold, 5.0);
      assert.equal(config.min_user_level, 1);
      assert.equal(config.extraction_enabled, false);
    });

    it('returns stored config for configured guild', () => {
      db.run(
        `INSERT INTO memory_config (guild_id, reaction_weight, min_user_level, extraction_enabled)
         VALUES (?, 2.5, 5, 1)`,
        [TEST_GUILD_ID]
      );

      const config = getConfig(TEST_GUILD_ID);
      assert.equal(config.reaction_weight, 2.5);
      assert.equal(config.min_user_level, 5);
      assert.equal(config.extraction_enabled, true);
    });
  });

  describe('getChannelWeight()', () => {
    it('returns +5 for announcement channels', () => {
      assert.equal(getChannelWeight('announcements', 'ch1', {}), 5.0);
      assert.equal(getChannelWeight('duyuru', 'ch1', {}), 5.0);
      assert.equal(getChannelWeight('rules', 'ch1', {}), 5.0);
    });

    it('returns +2 for general channels', () => {
      assert.equal(getChannelWeight('general', 'ch1', {}), 2.0);
      assert.equal(getChannelWeight('genel-sohbet', 'ch1', {}), 2.0);
    });

    it('returns -2 for meme/spam channels', () => {
      assert.equal(getChannelWeight('memes', 'ch1', {}), -2.0);
      assert.equal(getChannelWeight('off-topic', 'ch1', {}), -2.0);
    });

    it('returns 0 for unrecognized channels', () => {
      assert.equal(getChannelWeight('team-alpha', 'ch1', {}), 0.0);
    });

    it('uses explicit config over name matching', () => {
      const weights = { 'ch1': 7.5 };
      assert.equal(getChannelWeight('memes', 'ch1', weights), 7.5);
    });
  });

  describe('computeFullScore()', () => {
    it('scores reactions correctly', () => {
      const config = getConfig('test');
      const msg = { reaction_count: 5, reply_count: 0, bot_mentioned: 0, channel_id: 'ch1' };
      const score = computeFullScore(msg, 'random-channel', 3, config);
      // 5 * 1.0 + 0 + 0 (channel) + 3 (trust) = 8
      assert.equal(score, 8.0);
    });

    it('scores replies higher than reactions', () => {
      const config = getConfig('test');
      const msg = { reaction_count: 0, reply_count: 3, bot_mentioned: 0, channel_id: 'ch1' };
      const score = computeFullScore(msg, 'random-channel', 0, config);
      // 0 + 3 * 2.0 + 0 + 0 = 6
      assert.equal(score, 6.0);
    });

    it('gives bot mention bonus', () => {
      const config = getConfig('test');
      const msg = { reaction_count: 0, reply_count: 0, bot_mentioned: 1, channel_id: 'ch1' };
      const score = computeFullScore(msg, 'random-channel', 0, config);
      // 10.0 + 0 + 0 = 10
      assert.equal(score, 10.0);
    });

    it('adds channel bonus', () => {
      const config = getConfig('test');
      const msg = { reaction_count: 1, reply_count: 0, bot_mentioned: 0, channel_id: 'ch1' };
      const announcementScore = computeFullScore(msg, 'announcements', 0, config);
      const memeScore = computeFullScore(msg, 'memes', 0, config);
      // announcement: 1 + 5 = 6, meme: 1 + (-2) = -1
      assert.equal(announcementScore, 6.0);
      assert.equal(memeScore, -1.0);
    });

    it('caps user trust at 10', () => {
      const config = getConfig('test');
      const msg = { reaction_count: 0, reply_count: 0, bot_mentioned: 0, channel_id: 'ch1' };
      const score = computeFullScore(msg, 'random-channel', 50, config);
      assert.equal(score, 10.0); // capped at 10
    });
  });

  describe('extractNgrams()', () => {
    it('extracts 3-word ngrams', () => {
      const ngrams = extractNgrams('raid night is every tuesday at nine');
      assert.ok(ngrams.size > 0);
      assert.ok(ngrams.has('raid night every'));
    });

    it('strips URLs and mentions', () => {
      const ngrams = extractNgrams('check https://example.com and <@123456> for info about the raid');
      for (const ng of ngrams) {
        assert.ok(!ng.includes('http'));
        assert.ok(!ng.includes('<@'));
      }
    });

    it('filters stopwords', () => {
      const ngrams = extractNgrams('the raid is on tuesday');
      for (const ng of ngrams) {
        assert.ok(!ng.startsWith('the '));
      }
    });

    it('returns empty set for very short text', () => {
      const ngrams = extractNgrams('hi');
      // "hi" is only 2 chars, filtered by length > 2
      assert.equal(ngrams.size, 0);
    });
  });

  describe('clusterMessages()', () => {
    it('clusters messages with shared ngrams', () => {
      const messages = [
        { content: 'raid night is every tuesday at nine pm' },
        { content: 'our raid night every tuesday starts at nine' },
        { content: 'completely different topic about cooking' },
      ];

      const clusters = clusterMessages(messages);
      // First two should cluster together
      assert.ok(clusters.length <= 2);

      const bigCluster = clusters.find(c => c.length > 1);
      if (bigCluster) {
        assert.ok(bigCluster.some(m => m.content.includes('raid night')));
      }
    });

    it('keeps unique messages in their own cluster', () => {
      const messages = [
        { content: 'alpha topic completely unique sentence' },
        { content: 'beta different entirely separate subject' },
      ];

      const clusters = clusterMessages(messages);
      assert.equal(clusters.length, 2);
    });
  });

  describe('decay system', () => {
    it('decay reduces score', () => {
      const initial = 1.0;
      const rate = 0.993;
      const after = initial * rate;
      assert.ok(after < initial);
      assert.ok(after > 0.99);
    });

    it('memory halves in ~24 days', () => {
      const rate = 0.993;
      const cyclesPerDay = 4; // 6-hour cycles
      const days = 24;
      const finalScore = Math.pow(rate, cyclesPerDay * days);
      // Should be roughly 0.5
      assert.ok(finalScore > 0.4);
      assert.ok(finalScore < 0.6);
    });

    it('reinforcement boosts score', () => {
      const decayed = 0.5;
      const reinforced = Math.min(decayed + 0.3, 1.0);
      assert.equal(reinforced, 0.8);
    });

    it('reinforcement caps at 1.0', () => {
      const high = 0.9;
      const reinforced = Math.min(high + 0.3, 1.0);
      assert.equal(reinforced, 1.0);
    });
  });

  describe('DB: message_scores table', () => {
    it('tracks reaction counts via upsert', () => {
      // Insert a message_log entry first
      db.run(
        'INSERT INTO message_log (guild_id, channel_id, user_id, user_name, content, discord_message_id) VALUES (?, ?, ?, ?, ?, ?)',
        [TEST_GUILD_ID, TEST_CHANNEL_ID, TEST_USER_ID, 'TestUser', 'test message', 'disc_msg_1']
      );
      const logEntry = db.get('SELECT id FROM message_log WHERE discord_message_id = ?', ['disc_msg_1']);

      // First reaction
      db.run(
        `INSERT INTO message_scores (message_log_id, guild_id, channel_id, user_id, reaction_count)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(message_log_id) DO UPDATE SET reaction_count = reaction_count + 1`,
        [logEntry.id, TEST_GUILD_ID, TEST_CHANNEL_ID, TEST_USER_ID]
      );

      // Second reaction
      db.run(
        `INSERT INTO message_scores (message_log_id, guild_id, channel_id, user_id, reaction_count)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(message_log_id) DO UPDATE SET reaction_count = reaction_count + 1`,
        [logEntry.id, TEST_GUILD_ID, TEST_CHANNEL_ID, TEST_USER_ID]
      );

      const score = db.get('SELECT * FROM message_scores WHERE message_log_id = ?', [logEntry.id]);
      assert.equal(score.reaction_count, 2);
    });
  });

  describe('DB: ai_memories auto-learning columns', () => {
    it('stores auto-learned memory with source field', () => {
      db.run(
        `INSERT INTO ai_memories (guild_id, key, value, taught_by, source, confidence, decay_score)
         VALUES (?, 'test key', 'Test memory', 'auto-learner', 'auto', 0.85, 1.0)`,
        [TEST_GUILD_ID]
      );

      const mem = db.get(
        "SELECT * FROM ai_memories WHERE guild_id = ? AND source = 'auto'",
        [TEST_GUILD_ID]
      );
      assert.ok(mem);
      assert.equal(mem.source, 'auto');
      assert.equal(mem.confidence, 0.85);
      assert.equal(mem.decay_score, 1.0);
    });

    it('counts manual and auto pools separately', () => {
      db.run(
        `INSERT INTO ai_memories (guild_id, key, value, taught_by, source) VALUES (?, 'manual1', 'manual memory', 'user1', 'manual')`,
        [TEST_GUILD_ID]
      );
      db.run(
        `INSERT INTO ai_memories (guild_id, key, value, taught_by, source) VALUES (?, 'auto1', 'auto memory', 'auto-learner', 'auto')`,
        [TEST_GUILD_ID]
      );

      const manualCount = db.get(
        "SELECT COUNT(*) as cnt FROM ai_memories WHERE guild_id = ? AND (source = 'manual' OR source IS NULL)",
        [TEST_GUILD_ID]
      );
      const autoCount = db.get(
        "SELECT COUNT(*) as cnt FROM ai_memories WHERE guild_id = ? AND source = 'auto'",
        [TEST_GUILD_ID]
      );

      assert.equal(manualCount.cnt, 1);
      assert.equal(autoCount.cnt, 1);
    });
  });
});
