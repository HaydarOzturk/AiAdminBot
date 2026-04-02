const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { createEmbed } = require('../../utils/embedBuilder');
const { t, channelName } = require('../../utils/locale');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('afk-setup')
    .setDescription('Create the AFK voice channel with no-speaking permissions (Owner/Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(opt =>
      opt.setName('timeout')
        .setDescription('AFK timeout in minutes (Discord native)')
        .addChoices(
          { name: '1 minute', value: 60 },
          { name: '5 minutes', value: 300 },
          { name: '15 minutes', value: 900 },
          { name: '30 minutes', value: 1800 },
          { name: '1 hour', value: 3600 },
        )
    ),

  async execute(interaction) {
    const g = interaction.guild?.id;
    const guild = interaction.guild;

    // Require admin level
    if (!hasPermission(interaction.member, 'setup-server')) {
      return interaction.reply({
        content: t('setup.ownerOnly', {}, g),
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    try {
      const timeoutSeconds = interaction.options.getInteger('timeout') || 300; // default 5 min
      const result = await createAfkChannel(guild, timeoutSeconds);

      const embed = createEmbed({
        title: result.created ? '💤 AFK Channel Created!' : '💤 AFK Channel',
        description: result.message,
        color: result.created ? 'success' : 'warning',
        fields: result.fields || [],
        timestamp: true,
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('AFK setup error:', err);
      await interaction.editReply({
        content: `❌ AFK setup failed: ${err.message}`,
      });
    }
  },
};

/**
 * Create the AFK voice channel on a guild.
 * Reusable — called by both slash command and API.
 * @param {import('discord.js').Guild} guild
 * @returns {{ created: boolean, message: string, fields?: Array, channelId?: string }}
 */
async function createAfkChannel(guild, timeoutSeconds = 300) {
  const g = guild.id;

  // Check if guild already has an AFK channel set
  if (guild.afkChannelId) {
    const existing = guild.channels.cache.get(guild.afkChannelId);
    if (existing) {
      return {
        created: false,
        message: `AFK channel already exists: **${existing.name}**\nGuild AFK timeout: **${guild.afkTimeout / 60} minutes**`,
        channelId: existing.id,
      };
    }
  }

  // Also check by name (maybe channel exists but isn't set as AFK)
  const afkName = channelName('afk', g);
  const existingByName = guild.channels.cache.find(
    c => c.type === ChannelType.GuildVoice && c.name.toLowerCase() === afkName.toLowerCase()
  );

  if (existingByName) {
    // Channel exists but not set as guild AFK — set it now
    await guild.setAFKChannel(existingByName, 'AFK setup by AdminBot');
    await guild.setAFKTimeout(timeoutSeconds);

    // Ensure Speak is denied for @everyone
    await existingByName.permissionOverwrites.edit(guild.roles.everyone, {
      Speak: false,
      ViewChannel: true,
      Connect: true,
    }, { reason: 'AFK setup — deny speaking' });

    return {
      created: false,
      message: `Found existing **${existingByName.name}** channel and configured it as the AFK channel.\nSpeaking: **Denied for everyone**\nTimeout: **${timeoutSeconds / 60} minutes**`,
      channelId: existingByName.id,
    };
  }

  // Create AFK category
  const catName = channelName('cat-afk', g);
  let category = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name === catName
  );

  if (!category) {
    category = await guild.channels.create({
      name: catName,
      type: ChannelType.GuildCategory,
      reason: 'AFK setup by AdminBot',
    });
  }

  // Create AFK voice channel with Speak denied
  const afkChannel = await guild.channels.create({
    name: afkName,
    type: ChannelType.GuildVoice,
    parent: category.id,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
        deny: [PermissionFlagsBits.Speak],
      },
    ],
    reason: 'AFK setup by AdminBot',
  });

  // Set as guild AFK channel with 10 min timeout
  await guild.setAFKChannel(afkChannel, 'AFK setup by AdminBot');
  await guild.setAFKTimeout(600);

  return {
    created: true,
    message: `Created **${afkChannel.name}** in **${category.name}**`,
    fields: [
      { name: 'Channel', value: `<#${afkChannel.id}>`, inline: true },
      { name: 'Speaking', value: '❌ Denied for everyone', inline: true },
      { name: 'AFK Timeout', value: `${timeoutSeconds / 60} minutes`, inline: true },
    ],
    channelId: afkChannel.id,
  };
}

// Export the helper for API use
module.exports.createAfkChannel = createAfkChannel;
