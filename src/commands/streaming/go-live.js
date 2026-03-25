/**
 * /go-live — Check registered streaming platforms and announce if live.
 *
 * Flow:
 *  1. Only the stream owner (STREAM_OWNER_ID), guild owner, or debug owner can use this
 *  2. Fetches the stream owner's links from the database
 *  3. Checks platforms with live-detection APIs (Kick, Twitch, YouTube) in parallel
 *  4. Posts a rich @everyone announcement with ALL platform links as buttons
 *  5. The announcement always shows the stream owner's name/avatar, not whoever ran the command
 */

const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { t } = require('../../utils/locale');
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

    // Who can use this: stream owner, guild owner, or debug owner
    const streamOwnerId = process.env.STREAM_OWNER_ID;
    const isStreamOwner = streamOwnerId && member.id === streamOwnerId;
    const isGuildOwner = member.id === guild.ownerId;
    const isDebugOwner = member.id === process.env.DEBUG_OWNER_ID;

    if (!isStreamOwner && !isGuildOwner && !isDebugOwner && !hasPermission(member, 'setup-server')) {
      return interaction.reply({
        content: t('streaming.ownerOnly', {}, g),
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (process.env.STREAMING_ENABLED === 'false') {
      return interaction.editReply({ content: t('streaming.disabled', {}, g) });
    }

    // Resolve the stream owner — the person whose links and identity we use
    const ownerId = streamOwnerId || guild.ownerId;
    let ownerMember;
    try {
      ownerMember = await guild.members.fetch(ownerId);
    } catch {
      return interaction.editReply({ content: t('streaming.ownerNotFound', {}, g) });
    }

    // Get the stream owner's links
    const links = all(
      'SELECT * FROM streaming_links WHERE guild_id = ? AND user_id = ?',
      [guild.id, ownerId]
    );

    if (!links || links.length === 0) {
      return interaction.editReply({ content: t('streaming.noLinks', {}, g) });
    }

    // Check all platforms in parallel
    const results = await checkAllPlatforms(links);
    const liveResults = results.filter(r => r.isLive);
    const detectableResults = results.filter(r => PLATFORMS[r.platform]?.canDetectLive);
    const anyDetectableLive = liveResults.some(r => PLATFORMS[r.platform]?.canDetectLive);

    // If no detectable platform is live, warn the user (link-only platforms are always included)
    if (detectableResults.length > 0 && !anyDetectableLive) {
      const platformList = detectableResults
        .map(r => `${r.emoji} **${r.label}**: ${t('streaming.offline', {}, g)}`)
        .join('\n');

      return interaction.editReply({
        content: `${t('streaming.notLive', {}, g)}\n\n${platformList}`,
      });
    }

    // ── Build and send announcement ──────────────────────────────────────

    const announcementChannel = findAnnouncementChannel(guild);
    if (!announcementChannel) {
      return interaction.editReply({ content: t('streaming.noChannel', {}, g) });
    }

    // Lock the channel: bot + guild owner only
    try {
      await announcementChannel.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: false, ViewChannel: true, ReadMessageHistory: true,
      }, { reason: 'Stream announcements — locked' });

      await announcementChannel.permissionOverwrites.edit(guild.ownerId, {
        SendMessages: true,
      }, { reason: 'Stream announcements — allow owner' });

      await announcementChannel.permissionOverwrites.edit(guild.members.me, {
        SendMessages: true, EmbedLinks: true,
      }, { reason: 'Stream announcements — allow bot' });
    } catch (err) {
      console.warn('Could not enforce announcement channel permissions:', err.message);
    }

    const ownerName = ownerMember.displayName || ownerMember.user.username;
    const ownerAvatar = ownerMember.user.displayAvatarURL({ dynamic: true, size: 256 });

    // ── Build the embed ──────────────────────────────────────────────────

    // Find the "main" live stream for the title (prefer YouTube > Twitch > Kick)
    const mainLive = liveResults.find(r => r.platform === 'youtube')
      || liveResults.find(r => r.platform === 'twitch')
      || liveResults.find(r => r.platform === 'kick')
      || liveResults[0];

    const streamTitle = mainLive?.title || '';

    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setAuthor({ name: `${ownerName} ${t('streaming.isLiveNow', {}, g)}`, iconURL: ownerAvatar })
      .setThumbnail(ownerAvatar)
      .setTimestamp();

    // Stream title as description if available
    if (streamTitle) {
      embed.setTitle(`📺 ${streamTitle}`);
    }

    embed.setDescription(t('streaming.goLiveDesc', { user: ownerName }, g));

    // Add live platforms with status
    const statusLines = results.map(r => {
      if (r.isLive) {
        const viewerStr = r.viewers > 0 ? ` • 👥 ${r.viewers}` : '';
        return `${r.emoji} **${r.label}** — 🔴 LIVE${viewerStr}`;
      } else if (PLATFORMS[r.platform]?.canDetectLive) {
        return `${r.emoji} **${r.label}** — ⚫ ${t('streaming.offline', {}, g)}`;
      } else {
        return `${r.emoji} **${r.label}**`;
      }
    });

    embed.addFields({
      name: t('streaming.platformStatus', {}, g),
      value: statusLines.join('\n'),
      inline: false,
    });

    // ── Build button rows (ALL platforms get a link button) ──────────────

    const allButtons = results.map(r =>
      new ButtonBuilder()
        .setLabel(r.isLive ? `🔴 ${r.label}` : r.label)
        .setStyle(ButtonStyle.Link)
        .setURL(r.isLive ? r.liveUrl : r.url)
        .setEmoji(r.emoji)
    );

    // Discord allows max 5 buttons per row
    const components = [];
    for (let i = 0; i < allButtons.length; i += 5) {
      components.push(new ActionRowBuilder().addComponents(...allButtons.slice(i, i + 5)));
    }

    // Send the announcement
    await announcementChannel.send({
      content: `@everyone\n🔴 **${ownerName}** ${t('streaming.isLiveNow', {}, g)}`,
      embeds: [embed],
      components,
    });

    // Ephemeral reply to command user
    const liveNames = liveResults.map(r => r.label).join(', ') || t('streaming.linkOnlyMode', {}, g);
    await interaction.editReply({
      content: t('streaming.announcementSent', { platforms: liveNames, channel: announcementChannel.name }, g),
    });
  },
};
