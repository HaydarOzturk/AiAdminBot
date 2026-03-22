const fs = require('fs');
const path = require('path');
const { chat, isConfigured } = require('../utils/openrouter');
const { createEmbed } = require('../utils/embedBuilder');
const { t, channelName } = require('../utils/locale');

// Active interview sessions: guildId -> { userId, messages[], step, config }
const activeSessions = new Map();

function buildSystemPrompt(language) {
  const lang = language === 'tr' ? 'Turkish' : 'English';
  return `You are a Discord server setup assistant for AiAdminBot — an AI-powered Discord administration bot. You help server owners configure their server through a friendly conversation.

IMPORTANT: You MUST respond in ${lang} language at all times.

You are part of AiAdminBot which has these features that will be set up automatically:
- Verification system: new members go to verification channel, click a button to verify, get verified role
- Role menus: color roles (single select), game roles, platform roles — all with buttons
- Moderation: /warn, /mute, /kick, /ban, /timeout, /clear, /warnings, /mod-history — with permission hierarchy (Owner > Admin > Moderator)
- Logging: log channels for message edits/deletes, join/leave, punishments, role changes, channel changes, bans
- Leveling/XP: users earn 15-25 XP per message (60s cooldown), level-up announcements, tier roles with auto-assignment
- AI Chat: a channel where members can chat with AI
- AI Moderation: auto-detects toxic messages, spam, threats
- Auto log cleanup every 72 hours

Your job is to interview the server owner step by step and build a server configuration.

Follow this interview flow:
1. Ask what kind of community/server this is (gaming, streaming, education, social, etc.)
2. Ask what channels they want (suggest common ones based on their community type). Explain that verification, role selection, log channels, and AI chat channels are created automatically.
3. Ask about moderation strictness (relaxed, moderate, strict)
4. Ask if they want a leveling/XP system and what the tier names and colors should be
5. Ask about any special roles they want (beyond the default Admin, Moderator, Verified, Unverified)
6. Summarize the full configuration and ask for confirmation

IMPORTANT RULES:
- Ask ONE question at a time, don't overwhelm the user
- ALWAYS respond in ${lang}
- After each answer, acknowledge it briefly and move to the next question
- When you have enough info (after confirmation), output the final config as a JSON block wrapped in \`\`\`json ... \`\`\` tags
- Keep your responses short and conversational
- If the user says "skip" or similar, use sensible defaults for a gaming community
- The JSON should follow this structure:
{
  "serverType": "gaming|streaming|social|education|other",
  "language": "${language === 'tr' ? 'tr' : 'en'}",
  "categories": [{"name": "Category Name", "channels": [{"name": "channel-name", "type": "text|voice"}]}],
  "moderationLevel": "relaxed|moderate|strict",
  "leveling": {"enabled": true/false, "tiers": [{"name": "Tier", "minLevel": 0, "color": "#hex"}]},
  "customRoles": [{"name": "Role", "color": "#hex"}]
}`;
}

/**
 * Start a new AI setup interview session
 * @param {import('discord.js').CommandInteraction} interaction
 * @param {string} [language='en'] - 'tr' or 'en'
 */
async function startInterview(interaction, language = 'en') {
  if (!isConfigured()) {
    return interaction.reply({
      content: t('setup.aiNotConfigured'),
      flags: require('discord.js').MessageFlags.Ephemeral,
    });
  }

  const guildId = interaction.guild.id;

  // Check for existing session
  if (activeSessions.has(guildId)) {
    return interaction.reply({
      content: t('setup.sessionAlreadyActive'),
      flags: require('discord.js').MessageFlags.Ephemeral,
    });
  }

  const systemPrompt = buildSystemPrompt(language);

  // Create session
  activeSessions.set(guildId, {
    userId: interaction.user.id,
    channelId: interaction.channel.id,
    messages: [],
    language,
    systemPrompt,
    step: 0,
    startedAt: Date.now(),
  });

  await interaction.deferReply();

  const greeting = language === 'tr'
    ? 'Merhaba! Discord sunucumu kurmak istiyorum. Bana yardım eder misin?'
    : 'Hello! I want to set up my Discord server. Can you help me?';

  try {
    // Get initial greeting from AI
    const session = activeSessions.get(guildId);
    const response = await chat(
      [{ role: 'user', content: greeting }],
      { systemPrompt, maxTokens: 512, temperature: 0.7 }
    );

    session.messages.push(
      { role: 'user', content: greeting },
      { role: 'assistant', content: response }
    );

    const embed = createEmbed({
      title: t('setup.aiSetupTitle'),
      description: response,
      color: 'primary',
      footer: t('setup.aiSetupFooter'),
      timestamp: true,
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error('AI setup start error:', err.message);
    activeSessions.delete(guildId);
    await interaction.editReply({ content: t('setup.aiConnectionFailed', { error: err.message }) });
  }
}

/**
 * Handle a follow-up message in an active interview
 * @param {import('discord.js').Message} message
 * @returns {boolean} true if the message was handled
 */
async function handleMessage(message) {
  if (!message.guild) return false;

  const session = activeSessions.get(message.guild.id);
  if (!session) return false;

  // Only the user who started the interview can respond
  if (message.author.id !== session.userId) return false;
  if (message.channel.id !== session.channelId) return false;

  // Add user message to history
  session.messages.push({ role: 'user', content: message.content });

  await message.channel.sendTyping();

  try {
    const response = await chat(session.messages, {
      systemPrompt: session.systemPrompt || buildSystemPrompt('en'),
      maxTokens: 1024,
      temperature: 0.7,
    });

    session.messages.push({ role: 'assistant', content: response });

    // Check if the response contains a final JSON config
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);

    if (jsonMatch) {
      // Interview complete — parse config and save
      try {
        const generatedConfig = JSON.parse(jsonMatch[1]);

        // Clean text (remove the JSON block for display)
        const cleanResponse = response.replace(/```json[\s\S]*?```/, '').trim();

        const embed = createEmbed({
          title: t('setup.planReady'),
          description: cleanResponse || t('setup.planGenerated'),
          color: 'success',
          fields: [
            { name: t('setup.serverType'), value: generatedConfig.serverType || '-', inline: true },
            { name: t('setup.language'), value: generatedConfig.language || '-', inline: true },
            { name: t('setup.moderation'), value: generatedConfig.moderationLevel || '-', inline: true },
            { name: t('setup.categoryCount'), value: `${generatedConfig.categories?.length || 0}`, inline: true },
            { name: t('setup.levelingSystem'), value: generatedConfig.leveling?.enabled ? t('general.yes') : t('general.no'), inline: true },
          ],
          footer: t('setup.applyPlan'),
          timestamp: true,
        });

        await message.reply({ embeds: [embed] });

        // Save to file
        const configPath = path.join(__dirname, '..', '..', 'config', 'ai-generated-setup.json');
        fs.writeFileSync(configPath, JSON.stringify(generatedConfig, null, 2));

        console.log('✅ AI-generated setup config saved to config/ai-generated-setup.json');

        // Clean up session
        activeSessions.delete(message.guild.id);
      } catch (parseErr) {
        // JSON parsing failed — AI gave bad JSON, continue conversation
        await message.reply(response.length <= 2000 ? response : response.slice(0, 1997) + '...');
      }
    } else {
      // Normal conversation response
      if (response.length <= 2000) {
        const embed = createEmbed({
          title: t('setup.aiSetupTitle'),
          description: response,
          color: 'primary',
          footer: t('setup.aiSetupCancelFooter'),
        });
        await message.reply({ embeds: [embed] });
      } else {
        await message.reply(response.slice(0, 1997) + '...');
      }
    }
  } catch (err) {
    console.error('AI setup chat error:', err.message);
    await message.reply(t('setup.aiResponseFailed'));
  }

  return true;
}

/**
 * Cancel an active interview
 * @param {string} guildId
 * @returns {boolean}
 */
function cancelInterview(guildId) {
  if (activeSessions.has(guildId)) {
    activeSessions.delete(guildId);
    return true;
  }
  return false;
}

/**
 * Check if there's an active interview for a guild
 * @param {string} guildId
 * @returns {boolean}
 */
function hasActiveSession(guildId) {
  return activeSessions.has(guildId);
}

/**
 * Load the AI-generated config and convert it to server-setup format
 * so it can be applied with the existing serverSetup.runSetup() logic.
 * @returns {object|null} Server setup config, or null if no file exists
 */
function loadGeneratedConfig() {
  const configPath = path.join(__dirname, '..', '..', 'config', 'ai-generated-setup.json');
  if (!fs.existsSync(configPath)) return null;

  const aiConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  // Convert AI config format → server-setup.json format
  const adminRole = t('roles.admin');
  const modRole = t('roles.moderator');
  const verifiedRole = t('roles.verified');
  const unverifiedRole = t('roles.unverified');

  const setupConfig = {
    roles: [
      { name: adminRole, color: '#e67e22', hoist: true, permissions: ['Administrator'], position: 'high' },
      { name: modRole, color: '#2ecc71', hoist: true, permissions: ['ManageMessages', 'KickMembers', 'MuteMembers', 'ModerateMembers'], position: 'high' },
      { name: verifiedRole, color: '#3498db', hoist: false, permissions: [], position: 'low' },
      { name: unverifiedRole, color: '#95a5a6', hoist: false, permissions: [], position: 'bottom' },
    ],
    categories: [],
  };

  // Add custom roles from AI config
  if (aiConfig.customRoles && Array.isArray(aiConfig.customRoles)) {
    for (const role of aiConfig.customRoles) {
      setupConfig.roles.push({
        name: role.name,
        color: role.color || '#99aab5',
        hoist: false,
        permissions: [],
        position: 'low',
      });
    }
  }

  // Add leveling tier roles
  if (aiConfig.leveling?.enabled && aiConfig.leveling?.tiers) {
    for (const tier of aiConfig.leveling.tiers) {
      setupConfig.roles.push({
        name: tier.name,
        color: tier.color || '#99aab5',
        hoist: false,
        permissions: [],
        position: 'low',
        note: `Leveling tier (min level ${tier.minLevel})`,
      });
    }
  }

  // Default permission templates for verified/unverified access
  const verifiedOnly = {
    everyone: { deny: ['ViewChannel'] },
    [unverifiedRole]: { deny: ['ViewChannel'] },
    [verifiedRole]: { allow: ['ViewChannel', 'SendMessages'] },
  };

  const readOnly = {
    everyone: { deny: ['SendMessages', 'ViewChannel'] },
    [verifiedRole]: { allow: ['ViewChannel', 'ReadMessageHistory'] },
  };

  const staffOnly = true;

  // Always add a verification category
  setupConfig.categories.push({
    name: channelName('cat-verification'),
    channels: [
      {
        name: channelName('rules'),
        type: 'text',
        topic: t('setup.rulesTopic') !== 'setup.rulesTopic' ? t('setup.rulesTopic') : 'Server rules',
        permissions: { everyone: { deny: ['SendMessages'], allow: ['ViewChannel'] } },
      },
      {
        name: channelName('verification'),
        type: 'text',
        topic: t('setup.verificationTopic') !== 'setup.verificationTopic' ? t('setup.verificationTopic') : 'Click the verify button!',
        autoSetup: 'verification',
        permissions: {
          everyone: { deny: ['SendMessages', 'ViewChannel'] },
          [unverifiedRole]: { allow: ['ViewChannel', 'ReadMessageHistory'] },
        },
      },
    ],
  });

  // Convert AI categories
  if (aiConfig.categories && Array.isArray(aiConfig.categories)) {
    for (const cat of aiConfig.categories) {
      const channels = [];

      if (cat.channels && Array.isArray(cat.channels)) {
        for (const ch of cat.channels) {
          const channelDef = {
            name: ch.name,
            type: ch.type || 'text',
          };

          if (ch.type === 'voice') {
            channelDef.permissions = {
              everyone: { deny: ['ViewChannel'] },
              [unverifiedRole]: { deny: ['ViewChannel'] },
              [verifiedRole]: { allow: ['ViewChannel', 'Connect', 'Speak'] },
            };
          } else {
            channelDef.permissions = verifiedOnly;
          }

          channels.push(channelDef);
        }
      }

      setupConfig.categories.push({
        name: cat.name,
        channels,
      });
    }
  }

  // Always add ai-chat channel (in the last user-facing category or create a new one)
  const aiChatChannelName = channelName('ai-chat');
  const hasAiChat = setupConfig.categories.some(cat =>
    cat.channels?.some(ch => ch.name === aiChatChannelName || ch.name === 'ai-sohbet' || ch.name === 'ai-chat')
  );

  if (!hasAiChat) {
    // Find the chat/general category and append, or create one
    const chatCat = setupConfig.categories.find(cat =>
      cat.name.includes('SOHBET') || cat.name.includes('CHAT') || cat.name.includes('💬')
    );

    const aiChannel = {
      name: aiChatChannelName,
      type: 'text',
      permissions: {
        everyone: { deny: ['ViewChannel'] },
        [unverifiedRole]: { deny: ['ViewChannel'] },
        [verifiedRole]: { allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
      },
    };

    if (chatCat) {
      chatCat.channels.push(aiChannel);
    } else {
      // Add as its own category
      setupConfig.categories.push({
        name: '🤖 AI',
        channels: [aiChannel],
      });
    }
  }

  // Always add log channels
  setupConfig.categories.push({
    name: channelName('cat-logs'),
    staffOnly,
    channels: [
      { name: channelName('message-log'), type: 'text', topic: 'Deleted and edited messages' },
      { name: channelName('join-leave-log'), type: 'text', topic: 'Member join/leave logs' },
      { name: channelName('punishment-log'), type: 'text', topic: 'Warning, mute, kick, ban logs' },
      { name: channelName('role-log'), type: 'text', topic: 'Role change logs' },
      { name: channelName('ban-log'), type: 'text', topic: 'Ban logs' },
    ],
  });

  return setupConfig;
}

/**
 * Run the default server setup with localized channel names.
 * This skips the AI interview and directly applies the recommended config.
 * @param {import('discord.js').CommandInteraction} interaction
 * @param {string} language - Locale code (tr, en, de, es, fr, pt, ru, ar)
 */
async function runDefaultSetup(interaction, language) {
  await interaction.deferReply();

  try {
    // Temporarily set LOCALE so channelName() reads the right locale file
    const originalLocale = process.env.LOCALE;
    process.env.LOCALE = language;

    // Reload locale for the target language
    const { loadLocale } = require('../utils/locale');
    loadLocale();

    const { runSetup, buildLocalizedDefaultConfig } = require('./serverSetup');

    // Build a localized config and run setup with it
    const localizedConfig = buildLocalizedDefaultConfig();

    // Save as a temporary config file so runSetup can use it
    const tempConfigPath = path.join(__dirname, '..', '..', 'config', 'server-setup.json');
    const hadExistingConfig = fs.existsSync(tempConfigPath);
    let existingConfigBackup = null;

    if (hadExistingConfig) {
      existingConfigBackup = fs.readFileSync(tempConfigPath, 'utf-8');
    }

    // Write the localized config
    fs.writeFileSync(tempConfigPath, JSON.stringify(localizedConfig, null, 2));

    // Run setup
    const result = await runSetup(interaction.guild);

    // Restore original config if there was one, otherwise clean up
    if (hadExistingConfig && existingConfigBackup) {
      fs.writeFileSync(tempConfigPath, existingConfigBackup);
    } else {
      fs.unlinkSync(tempConfigPath);
    }

    // Restore original locale
    process.env.LOCALE = originalLocale || 'tr';
    loadLocale();

    // Build summary
    const langNames = {
      tr: 'Türkçe', en: 'English', de: 'Deutsch', es: 'Español',
      fr: 'Français', pt: 'Português', ru: 'Русский', ar: 'العربية',
    };

    const fields = [
      { name: t('setup.language'), value: langNames[language] || language, inline: true },
      { name: t('setup.roles'), value: t('setup.created-skipped', { created: result.rolesCreated, skipped: result.rolesSkipped }), inline: false },
      { name: t('setup.categories'), value: t('setup.created-skipped', { created: result.categoriesCreated, skipped: result.categoriesSkipped }), inline: false },
      { name: t('setup.channels'), value: t('setup.created-skipped', { created: result.channelsCreated, skipped: result.channelsSkipped }), inline: false },
    ];

    if (result.verificationSent) {
      fields.push({ name: t('setup.verification'), value: t('setup.verificationSent') });
    }
    if (result.roleMenusSent.length > 0) {
      fields.push({ name: t('setup.roleMenus'), value: result.roleMenusSent.map(c => `#${c}`).join(', ') });
    }
    if (result.errors.length > 0) {
      fields.push({ name: t('setup.warnings'), value: result.errors.slice(0, 5).join('\n') });
    }

    const embed = createEmbed({
      title: t('setup.defaultSetupComplete'),
      description: t('setup.defaultSetupCompleteDesc'),
      color: result.errors.length > 0 ? 'warning' : 'success',
      fields,
      timestamp: true,
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Default setup failed:', error);
    await interaction.editReply({ content: t('setup.defaultSetupFailed', { error: error.message }) });
  }
}

module.exports = { startInterview, handleMessage, cancelInterview, hasActiveSession, loadGeneratedConfig, runDefaultSetup };
