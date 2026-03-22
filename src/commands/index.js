/**
 * Static command registry — all commands are explicitly required here
 * so that pkg can bundle them at compile time (no dynamic require).
 */
module.exports = [
  // AI
  require('./ai/ai-chat'),
  require('./ai/ai-setup'),
  require('./ai/ai-setup-apply'),
  require('./ai/ai-setup-cancel'),

  // Leveling
  require('./leveling/leaderboard'),
  require('./leveling/rank'),

  // Moderation
  require('./moderation/ban'),
  require('./moderation/clear'),
  require('./moderation/kick'),
  require('./moderation/mod-history'),
  require('./moderation/mute'),
  require('./moderation/timeout'),
  require('./moderation/warn'),
  require('./moderation/warnings'),

  // Roles
  require('./roles/give-role'),
  require('./roles/remove-role'),
  require('./roles/role-menu'),

  // Setup
  require('./setup/setup'),

  // Utility
  require('./utility/help'),
  require('./utility/ping'),

  // Verification
  require('./verification/verify'),
];
