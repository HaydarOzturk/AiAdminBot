const { ChannelType } = require('discord.js');

/**
 * Serialize a guild's structure into a portable JSON template.
 * Captures categories, channels, and roles (without sensitive permissions details).
 * @param {import('discord.js').Guild} guild
 * @returns {Object} Template object
 */
function exportTemplate(guild) {
  const template = {
    templateName: guild.name,
    templateVersion: '1.0',
    createdAt: new Date().toISOString(),
    locale: process.env.LOCALE || 'en',
    roles: [],
    categories: [],
    uncategorizedChannels: [],
  };

  // Export roles (skip @everyone, managed/bot roles)
  const sortedRoles = guild.roles.cache
    .filter(r => r.id !== guild.id && !r.managed)
    .sort((a, b) => b.position - a.position);

  for (const role of sortedRoles.values()) {
    template.roles.push({
      name: role.name,
      color: role.hexColor !== '#000000' ? role.hexColor : null,
      hoist: role.hoist,
      mentionable: role.mentionable,
      position: role.position,
    });
  }

  // Group channels by category
  const categories = guild.channels.cache
    .filter(c => c.type === ChannelType.GuildCategory)
    .sort((a, b) => a.position - b.position);

  for (const category of categories.values()) {
    const catData = {
      name: category.name,
      position: category.position,
      channels: [],
    };

    // Get children sorted by position
    const children = guild.channels.cache
      .filter(c => c.parentId === category.id)
      .sort((a, b) => a.position - b.position);

    for (const channel of children.values()) {
      catData.channels.push({
        name: channel.name,
        type: channelTypeToString(channel.type),
        topic: channel.topic || null,
        nsfw: channel.nsfw || false,
        rateLimitPerUser: channel.rateLimitPerUser || 0,
        position: channel.position,
      });
    }

    template.categories.push(catData);
  }

  // Uncategorized channels
  const uncategorized = guild.channels.cache
    .filter(c => !c.parentId && c.type !== ChannelType.GuildCategory)
    .sort((a, b) => a.position - b.position);

  for (const channel of uncategorized.values()) {
    template.uncategorizedChannels.push({
      name: channel.name,
      type: channelTypeToString(channel.type),
      topic: channel.topic || null,
    });
  }

  return template;
}

/**
 * Validate a template JSON object
 * @param {Object} template
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateTemplate(template) {
  const errors = [];

  if (!template || typeof template !== 'object') {
    return { valid: false, errors: ['Template is not a valid JSON object'] };
  }
  if (!template.templateVersion) {
    errors.push('Missing templateVersion');
  }
  if (!Array.isArray(template.categories) && !Array.isArray(template.roles)) {
    errors.push('Template must have at least categories or roles');
  }

  if (template.categories) {
    for (const cat of template.categories) {
      if (!cat.name) errors.push('Category missing name');
      if (cat.channels && !Array.isArray(cat.channels)) {
        errors.push(`Category "${cat.name}" has invalid channels array`);
      }
    }
  }

  if (template.roles) {
    for (const role of template.roles) {
      if (!role.name) errors.push('Role missing name');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Build a preview summary of what a template would create
 * @param {Object} template
 * @param {import('discord.js').Guild} guild
 * @returns {Object} Summary with counts
 */
function previewImport(template, guild) {
  const existingChannels = new Set(guild.channels.cache.map(c => c.name.toLowerCase()));
  const existingRoles = new Set(guild.roles.cache.map(r => r.name.toLowerCase()));

  let newRoles = 0;
  let existingRoleCount = 0;
  let newCategories = 0;
  let newChannels = 0;
  let existingChannelCount = 0;

  if (template.roles) {
    for (const role of template.roles) {
      if (existingRoles.has(role.name.toLowerCase())) existingRoleCount++;
      else newRoles++;
    }
  }

  if (template.categories) {
    for (const cat of template.categories) {
      if (!existingChannels.has(cat.name.toLowerCase())) newCategories++;
      if (cat.channels) {
        for (const ch of cat.channels) {
          if (existingChannels.has(ch.name.toLowerCase())) existingChannelCount++;
          else newChannels++;
        }
      }
    }
  }

  return {
    templateName: template.templateName || 'Unknown',
    locale: template.locale || '?',
    newRoles,
    existingRoleCount,
    newCategories,
    newChannels,
    existingChannelCount,
  };
}

/**
 * Import a template into a guild (creates only what's missing — idempotent).
 * @param {Object} template
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<{ rolesCreated: number, categoriesCreated: number, channelsCreated: number, errors: string[] }>}
 */
async function importTemplate(template, guild) {
  const results = { rolesCreated: 0, categoriesCreated: 0, channelsCreated: 0, errors: [] };

  // Create roles (bottom-up to maintain hierarchy)
  if (template.roles) {
    for (const roleData of [...template.roles].reverse()) {
      const existing = guild.roles.cache.find(r => r.name.toLowerCase() === roleData.name.toLowerCase());
      if (existing) continue;

      try {
        await guild.roles.create({
          name: roleData.name,
          color: roleData.color || undefined,
          hoist: roleData.hoist || false,
          mentionable: roleData.mentionable || false,
        });
        results.rolesCreated++;
      } catch (err) {
        results.errors.push(`Role "${roleData.name}": ${err.message}`);
      }
    }
  }

  // Create categories and their channels
  if (template.categories) {
    const { ChannelType: CT } = require('discord.js');

    for (const catData of template.categories) {
      let category = guild.channels.cache.find(
        c => c.type === CT.GuildCategory && c.name.toLowerCase() === catData.name.toLowerCase()
      );

      if (!category) {
        try {
          category = await guild.channels.create({
            name: catData.name,
            type: CT.GuildCategory,
          });
          results.categoriesCreated++;
        } catch (err) {
          results.errors.push(`Category "${catData.name}": ${err.message}`);
          continue;
        }
      }

      if (catData.channels) {
        for (const chData of catData.channels) {
          const existingCh = guild.channels.cache.find(
            c => c.name.toLowerCase() === chData.name.toLowerCase() && c.parentId === category.id
          );
          if (existingCh) continue;

          try {
            await guild.channels.create({
              name: chData.name,
              type: stringToChannelType(chData.type),
              parent: category.id,
              topic: chData.topic || undefined,
              nsfw: chData.nsfw || false,
              rateLimitPerUser: chData.rateLimitPerUser || 0,
            });
            results.channelsCreated++;
          } catch (err) {
            results.errors.push(`Channel "${chData.name}": ${err.message}`);
          }
        }
      }
    }
  }

  return results;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function channelTypeToString(type) {
  const map = {
    [ChannelType.GuildText]: 'text',
    [ChannelType.GuildVoice]: 'voice',
    [ChannelType.GuildAnnouncement]: 'announcement',
    [ChannelType.GuildStageVoice]: 'stage',
    [ChannelType.GuildForum]: 'forum',
  };
  return map[type] || 'text';
}

function stringToChannelType(str) {
  const map = {
    text: ChannelType.GuildText,
    voice: ChannelType.GuildVoice,
    announcement: ChannelType.GuildAnnouncement,
    stage: ChannelType.GuildStageVoice,
    forum: ChannelType.GuildForum,
  };
  return map[str] || ChannelType.GuildText;
}

module.exports = { exportTemplate, validateTemplate, previewImport, importTemplate };
