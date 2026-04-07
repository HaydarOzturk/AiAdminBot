/**
 * /go-live — Check registered streaming platforms and announce if live.
 *
 * Flow:
 *  1. Only the stream owner (STREAM_OWNER_ID), guild owner, or debug owner can use this
 *  2. Fetches the stream owner's links from the database
 *  3. Calls streamManager.announceStream() which handles everything
 */

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { t } = require('../../utils/locale');
const { all, run } = require('../../utils/database');
const { checkAllPlatforms, invalidatePlatformCache } = require('../../systems/streamingChecker');
const { announceStream, getActiveAnnouncement, findAnnouncementChannel } = require('../../systems/streamManager');

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

    // Resolve the stream owner
    const ownerId = streamOwnerId || guild.ownerId;
    let ownerMember;
    try {
      ownerMember = await guild.members.fetch(ownerId);
    } catch {
      return interaction.editReply({ content: t('streaming.ownerNotFound', {}, g) });
    }

    // Get the stream owner's links
    let links = all(
      'SELECT * FROM streaming_links WHERE guild_id = ? AND user_id = ?',
      [guild.id, ownerId]
    );

    // If stream owner has no links, check if the command user has links and migrate
    if ((!links || links.length === 0) && member.id !== ownerId) {
      links = all(
        'SELECT * FROM streaming_links WHERE guild_id = ? AND user_id = ?',
        [guild.id, member.id]
      );
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

    // Check announcement channel exists
    const announcementChannel = findAnnouncementChannel(guild);
    if (!announcementChannel) {
      return interaction.editReply({ content: t('streaming.noChannel', {}, g) });
    }

    // Check platforms fresh and announce via the unified manager
    invalidatePlatformCache(guild.id);
    const results = await checkAllPlatforms(links);

    const msg = await announceStream(guild, { platformResults: results });

    if (msg) {
      const existing = getActiveAnnouncement(guild.id);
      const liveResults = results.filter(r => r.isLive);
      const liveNames = liveResults.map(r => r.label).join(', ') || t('streaming.linkOnlyMode', {}, g);

      // Check if we updated vs sent new
      if (existing && existing.messageId === msg.id) {
        await interaction.editReply({
          content: `✅ ${t('streaming.announcementUpdated', { channel: announcementChannel.name }, g) || `Announcement updated in #${announcementChannel.name}!`}`,
        });
      } else {
        await interaction.editReply({
          content: t('streaming.announcementSent', { platforms: liveNames, channel: announcementChannel.name }, g),
        });
      }
    } else {
      await interaction.editReply({
        content: t('streaming.announcementFailed', {}, g) || 'Failed to post announcement. Check bot permissions and announcement channel.',
      });
    }
  },
};
