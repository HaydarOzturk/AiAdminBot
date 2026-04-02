/**
 * Tool Registry for AI Agent
 *
 * Defines all available tools, their parameters, permissions, and handlers.
 * The registry is serialized into the Gemini system prompt so it knows what's available.
 */

const moderationTools = require('./tools/moderation');
const channelTools = require('./tools/channels');
const roleTools = require('./tools/roles');
const levelingTools = require('./tools/leveling');
const knowledgeTools = require('./tools/knowledge');
const serverTools = require('./tools/server');
const communityTools = require('./tools/community');

// All tools in a flat array
const ALL_TOOLS = [
  ...moderationTools,
  ...channelTools,
  ...roleTools,
  ...levelingTools,
  ...knowledgeTools,
  ...serverTools,
  ...communityTools,
];

/**
 * Get tools available to a user based on their permission level.
 * @param {number} permissionLevel - 0-4
 * @returns {Array} Filtered tool list
 */
function getToolsForPermission(permissionLevel) {
  return ALL_TOOLS.filter(tool => permissionLevel >= tool.requiredPermission);
}

/**
 * Find a tool by name.
 */
function getTool(name) {
  return ALL_TOOLS.find(t => t.name === name) || null;
}

/**
 * Serialize tool list for the Gemini system prompt.
 * @param {number} permissionLevel
 * @returns {string}
 */
function serializeForPrompt(permissionLevel) {
  const tools = getToolsForPermission(permissionLevel);

  return tools.map(tool => {
    const params = Object.entries(tool.parameters)
      .map(([name, meta]) => `  - ${name} (${meta.type}${meta.required ? ', required' : ''}): ${meta.description}`)
      .join('\n');

    const destructiveTag = tool.destructive ? ' [DESTRUCTIVE - requires confirmation]' : '';
    return `${tool.name}${destructiveTag}: ${tool.description}\n${params}`;
  }).join('\n\n');
}

module.exports = { ALL_TOOLS, getToolsForPermission, getTool, serializeForPrompt };
