const allEvents = require('../events');

/**
 * Load all event listeners from the static registry
 * @param {import('discord.js').Client} client
 */
function loadEvents(client) {
  let eventCount = 0;

  for (const exported of allEvents) {
    // Support files that export an array of events (e.g. channelEvents.js)
    const events = Array.isArray(exported) ? exported : [exported];

    for (const event of events) {
      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
      } else {
        client.on(event.name, (...args) => event.execute(...args));
      }

      console.log(`  ✅ Loaded event: ${event.name}${event.once ? ' (once)' : ''}`);
      eventCount++;
    }
  }

  console.log(`📦 Loaded ${eventCount} events total.\n`);
}

module.exports = { loadEvents };
