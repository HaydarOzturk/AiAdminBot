const kb = require('../../systems/knowledgeBase');

module.exports = [
  {
    name: 'store_knowledge',
    description: 'Store a fact, rule, or piece of information in the server knowledge base',
    category: 'knowledge',
    requiredPermission: 2,
    destructive: false,
    parameters: {
      category: { type: 'string', description: 'Category: general, game, team, schedule, rule, faq', required: true },
      content: { type: 'string', description: 'The information to store', required: true },
      question: { type: 'string', description: 'For FAQ: the question this answers', required: false },
    },
    async execute(guild, invoker, params) {
      const validCategories = ['general', 'game', 'team', 'schedule', 'rule', 'faq'];
      const cat = validCategories.includes(params.category) ? params.category : 'general';
      const id = kb.addKnowledge(guild.id, cat, params.content, invoker.id, params.question || null);
      return { success: true, message: `Stored knowledge #${id} in category "${cat}"` };
    },
  },
  {
    name: 'search_knowledge',
    description: 'Search the server knowledge base using AI semantic matching',
    category: 'knowledge',
    requiredPermission: 0,
    destructive: false,
    parameters: {
      query: { type: 'string', description: 'Search query', required: true },
    },
    async execute(guild, invoker, params) {
      const results = await kb.searchKnowledge(guild.id, params.query);
      if (results.length === 0) return { success: true, message: 'No matching knowledge found.' };

      const lines = results.map(r => `[${r.category}] ${r.question ? `Q: ${r.question} → ` : ''}${r.content}`);
      return { success: true, message: lines.join('\n') };
    },
  },
  {
    name: 'search_messages',
    description: 'Search recent message history with AI understanding',
    category: 'knowledge',
    requiredPermission: 2,
    destructive: false,
    parameters: {
      query: { type: 'string', description: 'What to search for', required: true },
      userId: { type: 'string', description: 'Filter by user ID', required: false },
      channelId: { type: 'string', description: 'Filter by channel ID', required: false },
    },
    async execute(guild, invoker, params) {
      const result = await kb.searchMessages(guild.id, params.query, {
        userId: params.userId,
        channelId: params.channelId,
      });
      return { success: true, message: result || 'No messages found matching your search.' };
    },
  },
];
