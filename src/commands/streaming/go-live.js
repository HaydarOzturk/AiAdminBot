/**
 * /go-live — Check registered streaming platforms and announce if live.
 *
 * When the streamer runs this command, the bot:
 *  1. Fetches their streaming links from the database
 *  2. Checks each platform in parallel for live status
 *  3. If any platform is live → posts @everyone announcement in the stream-announcements channel
 *  4. Sends a summary back to the user (ephemeral)
 *
 * Only the guild owner can use this command.
 */

const { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { t, channelName } = require('../../utils/locale');
const { all } = require('../../utils/database');
const { checkAllPlatforms, PLATFORMS } = require('../../systems/streamingChecker');
const { findAnnouncementChannel } = require('../../systems/streamAnnouncer');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('go-live')
    .setDescription('Check your streaming platforms and announce if you are live')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const g = interaction.guild?.id;
    const guild = interaction.guild;
    const member = interaction.member;

    // Only guild owner or debug owner can use this
    const isOwner = member.id === guild.ownerId || member.id === process.env.DEBUG_OWNER_ID;
    if (!isOwner && !hasPermission(member, 'setup-server')) {
      return interaction.reply({
        content: t('streaming.ownerOnly', {}, g),
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Check if streaming is enabled
    if (process.env.STREAMING_ENABLED === 'false') {
      return interaction.editReply({ content: t('streaming.disabled', {}, g) });
    }

    // Get the user's streaming links from the database
    const links = all(
      'SELECT * FROM streaming_links WHERE guild_id = ? AND user_id = ?',
      [guild.id, member.id]
    );

    if (!links || links.length === 0) {
      return interaction.editReply({ content: t('streaming.noLinks', {}, g) });
    }

    // Check all platforms in parallel
    const results = await checkAllPlatforms(links);
    const liveResults = results.filter(r => r.isLive);

    if (liveResults.length === 0) {
      // None are live — tell the user
      const platformList = results
        .map(r => `${r.emoji} **${r.label}**: ${t('streaming.offline', {}, g)}`)
        .join('\n');

      return interaction.editReply({
        content: `${t('streaming.notLive', {}, g)}\n\n${platformList}`,
      });
    }

    // ── Found live streams! Post announcement ──────────────────────────────

    const announcementChannel = findAnnouncementChannel(guild);
    if (!announcementChannel) {
      return interaction.editReply({ content: t('streaming.noChannel', {}, g) });
    }

    // Ensure channel is locked: only bot + guild owner can send messages
    try {
      await announcementChannel.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: false,
        ViewChannel: true,
        ReadMessageHistory: true,
      }, { reason: 'Stream announcements — locked to bot + owner' });

      // Allow guild owner
      await announcementChannel.permissionOverwrites.edit(guild.ownerId, {
        SendMessages: true,
      }, { reason: 'Stream announcements — allow owner' });

      // Allow bot itself
      await announcementChannel.permissionOverwrites.edit(guild.members.me, {
        SendMessages: true,
        EmbedLinks: true,
      }, { reason: 'Stream announcements — allow bot' });
    } catch (err) {
      // Non-fatal — permissions might already be correct or bot lacks ManageChannels
      console.warn('Could not enforce announcement channel permissions:', err.message);
    }

    const userName = member.displayName || member.user.username;

    // Build the announcement embed
    const embed = new EmbedBuilder()
      .setColor(0xFF0000) // Red for LIVE
      .setTitle(t('streaming.liveTitle', { user: userName }, g))
      .setDescription(t('streaming.goLiveDesc', { user: userName }, g))
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
      .setTimestamp();

    // Add a field for each live platform
    for (const live of liveResults) {
      const fieldValue = live.title
        ? `📺 **${live.title}**\n🔗 ${live.url}`
        : `🔗 ${live.url}`;

      embed.addFields({
        name: `${live.emoji} ${live.label}`,
        value: fieldValue,
        inline: false,
      });
    }

    // Also show non-live platforms (so people know all the links)
    const offlineResults = results.filter(r => !r.isLive);
    if (offlineResults.length > 0) {
      const offlineLinks = offlineResults
        .map(r => `${r.emoji} [${r.label}](${r.url})`)
        .join(' • ');

      embed.addFields({
        name: t('streaming.otherPlatforms', {}, g),
        value: offlineLinks,
        inline: false,
      });
    }

    // Build button row with links to live streams
    const buttons = liveResults.map(live =>
      new ButtonBuilder()
        .setLabel(`${live.label}`)
        .setStyle(ButtonStyle.Link)
        .setURL(live.url)
        .setEmoji(live.emoji)
    );

    const components = buttons.length > 0
      ? [new ActionRowBuilder().addComponents(...buttons)]
      : [];

    // Send the announcement with @everyone
    await announcementChannel.send({
      content: t('streaming.everyoneTag', { user: userName }, g),
      embeds: [embed],
      components,
    });

    // Reply to the user (ephemeral)
    const liveNames = liveResults.map(r => r.label).join(', ');
    await interaction.editReply({
      content: t('streaming.announcementSent', { platforms: liveNames, channel: announcementChannel.name }, g),
    });
  },
};
