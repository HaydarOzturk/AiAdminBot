const kb = require('../../systems/knowledgeBase');

module.exports = [
  {
    name: 'create_poll',
    description: 'Create a poll with options',
    category: 'community',
    requiredPermission: 2,
    destructive: false,
    parameters: {
      question: { type: 'string', description: 'Poll question', required: true },
      options: { type: 'string', description: 'Comma-separated options (2-5)', required: true },
      duration: { type: 'number', description: 'Duration in minutes (0 = no limit)', required: false },
    },
    async execute(guild, invoker, params) {
      // This tool returns data for the agent to use, but actual poll creation
      // needs a channel context. Return instructions for the orchestrator.
      const options = params.options.split(',').map(o => o.trim()).filter(o => o.length > 0).slice(0, 5);
      if (options.length < 2) return { success: false, message: 'Need at least 2 options' };

      return {
        success: true,
        message: `Poll ready: "${params.question}" with options: ${options.join(', ')}. Use /poll create to post it.`,
        data: { question: params.question, options, duration: params.duration || 0 },
      };
    },
  },
  {
    name: 'start_giveaway',
    description: 'Start a giveaway',
    category: 'community',
    requiredPermission: 3,
    destructive: false,
    parameters: {
      prize: { type: 'string', description: 'What are you giving away?', required: true },
      duration: { type: 'number', description: 'Duration in minutes', required: true },
      winners: { type: 'number', description: 'Number of winners (default 1)', required: false },
    },
    async execute(guild, invoker, params) {
      return {
        success: true,
        message: `Giveaway ready: "${params.prize}" for ${params.duration} minutes, ${params.winners || 1} winner(s). Use /giveaway start to launch it.`,
        data: { prize: params.prize, duration: params.duration, winners: params.winners || 1 },
      };
    },
  },
  {
    name: 'get_channel_summary',
    description: 'Get a summary of recent activity in a channel (what did I miss?)',
    category: 'community',
    requiredPermission: 0,
    destructive: false,
    parameters: {
      channelId: { type: 'string', description: 'Channel ID or name', required: false },
      hours: { type: 'number', description: 'Hours to look back (default 8, max 48)', required: false },
    },
    async execute(guild, invoker, params) {
      const hours = Math.min(48, params.hours || 8);
      let channelId = params.channelId;

      if (channelId && !channelId.match(/^\d+$/)) {
        const ch = guild.channels.cache.find(c => c.name === channelId);
        if (ch) channelId = ch.id;
        else return { success: false, message: `Channel "${params.channelId}" not found` };
      }

      const summary = await kb.getChannelSummary(guild.id, channelId || guild.systemChannelId, hours);
      return { success: true, message: summary || 'No activity found in that time period.' };
    },
  },
];
