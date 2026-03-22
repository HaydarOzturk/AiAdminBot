const { Collection } = require('discord.js');
const allCommands = require('../commands');

/**
 * Load all commands from the static registry
 * @param {import('discord.js').Client} client
 */
function loadCommands(client) {
  client.commands = new Collection();

  for (const command of allCommands) {
    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
      console.log(`  ✅ Loaded command: /${command.data.name}`);
    } else {
      console.warn(`  ⚠️ Skipped a command: missing "data" or "execute" export`);
    }
  }

  console.log(`📦 Loaded ${client.commands.size} commands total.\n`);
}

module.exports = { loadCommands };
