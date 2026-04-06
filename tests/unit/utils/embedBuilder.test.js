const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createEmbed, COLORS } = require('../../../src/utils/embedBuilder');

describe('embedBuilder', () => {
  describe('COLORS', () => {
    it('has all expected color mappings', () => {
      assert.equal(COLORS.primary, 0x5865f2);
      assert.equal(COLORS.success, 0x57f287);
      assert.equal(COLORS.danger, 0xed4245);
      assert.equal(COLORS.warning, 0xfee75c);
      assert.equal(COLORS.info, 0x00b4d8);
      assert.equal(COLORS.purple, 0xa855f7);
      assert.equal(COLORS.orange, 0xf0883e);
    });
  });

  describe('createEmbed', () => {
    it('creates embed with title and description', () => {
      const embed = createEmbed({
        title: 'Test Title',
        description: 'Test Desc',
      });

      assert.equal(embed.data.title, 'Test Title');
      assert.equal(embed.data.description, 'Test Desc');
    });

    it('uses primary color by default', () => {
      const embed = createEmbed({ title: 'Test' });
      assert.equal(embed.data.color, COLORS.primary);
    });

    it('maps named colors correctly', () => {
      const embed = createEmbed({ title: 'Test', color: 'danger' });
      assert.equal(embed.data.color, COLORS.danger);
    });

    it('falls back to primary for unknown color', () => {
      const embed = createEmbed({ title: 'Test', color: 'nonexistent' });
      assert.equal(embed.data.color, COLORS.primary);
    });

    it('adds fields in order', () => {
      const embed = createEmbed({
        title: 'Test',
        fields: [
          { name: 'Field1', value: 'Value1' },
          { name: 'Field2', value: 'Value2' },
        ],
      });

      assert.equal(embed.data.fields.length, 2);
      assert.equal(embed.data.fields[0].name, 'Field1');
      assert.equal(embed.data.fields[1].name, 'Field2');
    });

    it('defaults fields to inline', () => {
      const embed = createEmbed({
        title: 'Test',
        fields: [{ name: 'F', value: 'V' }],
      });
      assert.equal(embed.data.fields[0].inline, true);
    });

    it('sets footer when provided', () => {
      const embed = createEmbed({ title: 'T', footer: 'Foot' });
      assert.equal(embed.data.footer.text, 'Foot');
    });

    it('sets timestamp when requested', () => {
      const embed = createEmbed({ title: 'T', timestamp: true });
      assert.ok(embed.data.timestamp);
    });

    it('handles missing optional fields without throwing', () => {
      assert.doesNotThrow(() => {
        createEmbed({});
      });
    });

    it('converts field values to string', () => {
      const embed = createEmbed({
        title: 'Test',
        fields: [{ name: 'Num', value: 42 }],
      });
      assert.equal(embed.data.fields[0].value, '42');
    });
  });
});
