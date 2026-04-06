const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createMockInteraction } = require('../../helpers/mockDiscord');

describe('/ping command', () => {
  const pingCmd = require('../../../src/commands/utility/ping');

  it('has correct command data', () => {
    assert.equal(pingCmd.data.name, 'ping');
  });

  it('replies with pong and latency info', async () => {
    const interaction = createMockInteraction({
      commandName: 'ping',
    });
    // Add createdTimestamp for roundtrip calculation
    interaction.createdTimestamp = Date.now() - 50;

    await pingCmd.execute(interaction);

    // First reply is "Pinging...", then editReply with embed
    assert.ok(interaction._replies.length >= 1);
    assert.equal(interaction._replies[0].content, '🏓 Pinging...');

    // Second call (editReply) should have embed
    if (interaction._replies.length >= 2) {
      const editReply = interaction._replies[1];
      assert.ok(editReply.embeds);
      assert.equal(editReply.embeds.length, 1);
      assert.equal(editReply.embeds[0].data.title, '🏓 Pong!');
    }
  });
});
