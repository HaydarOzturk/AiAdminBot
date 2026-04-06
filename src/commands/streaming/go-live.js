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

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { t } = require('../../utils/locale');
const { all, run } = require('../../utils/database');
const { checkAllPlatforms } = require('../../systems/streamingChecker');
const { findAnnouncementChannel, buildLiveMessage } = require('../../systems/streamAnnouncer');

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

    // Get the stream owner's links (fallback: also check the command user's links)
    let links = all(
      'SELECT * FROM streaming_links WHERE guild_id = ? AND user_id = ?',
      [guild.id, ownerId]
    );

    // If stream owner has no links, check if the person running the command has links
    if ((!links || links.length === 0) && member.id !== ownerId) {
      links = all(
        'SELECT * FROM streaming_links WHERE guild_id = ? AND user_id = ?',
        [guild.id, member.id]
      );
      // Migrate these links to the stream owner so future lookups work
      if (links && links.length > 0) {
        for (const link of links) {
          run(
            `UPDATE streaming_links SET user_id = ? WHERE guild_id = ? AND user_id = ? AND platform = ?`,
            [ownerId, guild.id, member.id, link.platform]
          );
        }
      }
    }

    if (!links || links.length === 0) {
      return interaction.editReply({ content: t('streaming.noLinks', {}, g) });
    }

    // Check all platforms in parallel
    const results = await checkAllPlatforms(links);
    const liveResults = results.filter(r => r.isLive);

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

    // ── Build the embed using shared builder (respects saved draft templates) ──

    // Find the "main" live stream for the title (prefer YouTube > Twitch > Kick)
    const mainLive = liveResults.find(r => r.platform === 'youtube')
      || liveResults.find(r => r.platform === 'twitch')
      || liveResults.find(r => r.platform === 'kick')
      || liveResults[0];

    // Build a streamActivity-like object for buildLiveMessage
    const streamActivity = {
      url: mainLive?.liveUrl || mainLive?.url || '',
      details: mainLive?.title || '',
      state: '',
      name: mainLive?.label || 'Live Stream',
      assets: null,
    };

    const messagePayload = await buildLiveMessage(ownerMember, streamActivity, guild.id, results);
    const { embeds, components } = messagePayload;

    // Check if there's already an active announcement to update
    const { activeAnnouncements } = require('../../systems/streamAnnouncer');
    const existingAnnouncement = activeAnnouncements.get(guild.id);

    if (existingAnnouncement) {
      // Update existing announcement
      try {
        const existingChannel = guild.channels.cache.get(existingAnnouncement.channelId);
        if (existingChannel) {
          const existingMsg = await existingChannel.messages.fetch(existingAnnouncement.messageId).catch(() => null);
          if (existingMsg) {
            await existingMsg.edit({
              content: `🔴 **${ownerName}** ${t('streaming.isLiveNow', {}, g)}`,
              embeds,
              components,
            });
            await interaction.editReply({
              content: `✅ ${t('streaming.announcementUpdated', { channel: existingChannel.name }, g) || `Announcement updated in #${existingChannel.name}!`}`,
            });
            return;
          }
        }
      } catch {
        // Existing message not found — send new one below
      }
    }

    // Send new announcement
    const sentMsg = await announcementChannel.send({
      content: `🔴 **${ownerName}** ${t('streaming.isLiveNow', {}, g)}`,
      embeds,
      components,
    });

    // Track it so future /go-live calls can update it
    activeAnnouncements.set(guild.id, {
      messageId: sentMsg.id,
      channelId: announcementChannel.id,
    });

    // Ephemeral reply to command user
    const liveNames = liveResults.map(r => r.label).join(', ') || t('streaming.linkOnlyMode', {}, g);
    await interaction.editReply({
      content: t('streaming.announcementSent', { platforms: liveNames, channel: announcementChannel.name }, g),
    });
  },
};
