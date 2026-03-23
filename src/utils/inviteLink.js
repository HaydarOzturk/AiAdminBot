/**
 * Generate the OAuth2 invite link for the bot.
 * Uses the bot's Client ID (from env or from the logged-in client).
 *
 * Permissions integer 8 = Administrator (simplest for a full admin bot).
 * Adjust if you want a more restrictive permission set.
 */

const REQUIRED_PERMISSIONS = '8'; // Administrator

/**
 * Get the bot's invite URL
 * @param {import('discord.js').Client} [client] - Optional Discord client to read ID from
 * @returns {string|null} The invite URL, or null if no client ID available
 */
function getInviteLink(client) {
  const clientId = process.env.CLIENT_ID || (client && client.user ? client.user.id : null);
  if (!clientId) return null;

  return `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot+applications.commands&permissions=${REQUIRED_PERMISSIONS}`;
}

module.exports = { getInviteLink };
