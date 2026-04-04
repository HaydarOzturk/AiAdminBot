/**
 * Static command registry — all commands are explicitly required here
 * so that pkg can bundle them at compile time (no dynamic require).
 */
module.exports = [
  // AI
  require('./ai/ai-chat'),
  require('./ai/ai-memory'),
  require('./ai/ai-setup'),
  require('./ai/ai-setup-apply'),
  require('./ai/ai-setup-cancel'),
  require('./ai/ai-agent'),

  // Knowledge
  require('./knowledge/what-did-i-miss'),
  require('./knowledge/knowledge'),

  // Leveling
  require('./leveling/award'),
  require('./leveling/leaderboard'),
  require('./leveling/rank'),
  require('./leveling/reset-xp'),

  // Community
  require('./community/starboard'),
  require('./community/poll'),
  require('./community/giveaway'),
  require('./community/custom-command'),

  // Moderation
  require('./moderation/automod'),
  require('./moderation/ban'),
  require('./moderation/blocklist'),
  require('./moderation/clear'),
  require('./moderation/kick'),
  require('./moderation/mod-history'),
  require('./moderation/mod-stats'),
  require('./moderation/case'),
  require('./moderation/mute'),
  require('./moderation/timeout'),
  require('./moderation/warn'),
  require('./moderation/warnings'),

  // Roles
  require('./roles/give-role'),
  require('./roles/remove-role'),
  require('./roles/publish-roles'),

  // Streaming
  require('./streaming/go-live'),
  require('./streaming/stream-link'),

  // Setup
  require('./setup/afk-setup'),
  require('./setup/fix-permissions'),
  require('./setup/language'),
  require('./setup/setup'),
  require('./setup/template-export'),
  require('./setup/template-import'),
  require('./setup/server-reset'),

  // Utility
  require('./utility/help'),
  require('./utility/ping'),
  require('./utility/suggest'),
  require('./utility/sync'),

  // Verification
  require('./verification/verify'),
];
