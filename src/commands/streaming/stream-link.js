/**
 * /stream-link — Add, remove, or list streaming platform links.
 *
 * Subcommands:
 *   /stream-link add <platform> <url>
 *   /stream-link remove <platform>
 *   /stream-link list
 *
 * Links are always stored under the stream owner (STREAM_OWNER_ID or guild owner).
 * The command can be used by: stream owner, guild owner, or debug owner.
 */

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { createEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/locale');
const { run, all } = require('../../utils/database');
const { PLATFORMS, extractKickSlug, extractTwitchLogin, parseYouTubeInput } = require('../../systems/streamingChecker');

const PLATFORM_CHOICES = Object.entries(PLATFORMS).map(([value, meta]) => ({
  name: meta.label,
  value,
}));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stream-link')
    .setDescription('Manage streaming platform links')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add a streaming platform link')
        .addStringOption(opt =>
          opt.setName('platform')
            .setDescription('Streaming platform')
            .setRequired(true)
            .addChoices(...PLATFORM_CHOICES)
        )
        .addStringOption(opt =>
          opt.setName('url')
            .setDescription('Your channel URL or username')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a streaming platform link')
        .addStringOption(opt =>
          opt.setName('platform')
            .setDescription('Platform to remove')
            .setRequired(true)
            .addChoices(...PLATFORM_CHOICES)
        )
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all streaming platform links')
    ),

  async execute(interaction) {
    const g = interaction.guild?.id;
    const guild = interaction.guild;
    const member = interaction.member;
    const sub = interaction.options.getSubcommand();

    // Who can use this
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

    // All links are stored under the stream owner's user ID
    const ownerId = streamOwnerId || guild.ownerId;

    if (sub === 'add') {
      const platform = interaction.options.getString('platform');
      const urlInput = interaction.options.getString('url');
      const meta = PLATFORMS[platform];

      // Extract handle and build canonical URL
      let handle = urlInput;
      let canonicalUrl = urlInput;

      if (platform === 'kick') {
        handle = extractKickSlug(urlInput);
        canonicalUrl = `https://kick.com/${handle}`;
      } else if (platform === 'twitch') {
        handle = extractTwitchLogin(urlInput);
        canonicalUrl = `https://twitch.tv/${handle}`;
      } else if (platform === 'youtube' || platform === 'youtube-shorts') {
        const parsed = parseYouTubeInput(urlInput);
        handle = parsed.value;
        canonicalUrl = parsed.type === 'id'
          ? `https://youtube.com/channel/${handle}`
          : `https://youtube.com/@${handle}`;
      } else {
        // TikTok, Instagram, Facebook — just store the URL as-is
        handle = urlInput;
        canonicalUrl = urlInput.startsWith('http') ? urlInput : `https://${urlInput}`;
      }

      run(
        `INSERT INTO streaming_links (guild_id, user_id, platform, platform_handle, platform_url)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, user_id, platform) DO UPDATE SET
           platform_handle = excluded.platform_handle,
           platform_url = excluded.platform_url,
           added_at = CURRENT_TIMESTAMP`,
        [guild.id, ownerId, platform, handle, canonicalUrl]
      );

      const embed = createEmbed({
        title: t('streaming.linkAddedTitle', {}, g),
        description: t('streaming.linkAddedDesc', { platform: meta.label, url: canonicalUrl }, g),
        color: 'success',
        timestamp: true,
      });

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

    } else if (sub === 'remove') {
      const platform = interaction.options.getString('platform');
      const meta = PLATFORMS[platform];

      run(
        'DELETE FROM streaming_links WHERE guild_id = ? AND user_id = ? AND platform = ?',
        [guild.id, ownerId, platform]
      );

      const embed = createEmbed({
        title: t('streaming.linkRemovedTitle', {}, g),
        description: t('streaming.linkRemovedDesc', { platform: meta.label }, g),
        color: 'warning',
        timestamp: true,
      });

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

    } else if (sub === 'list') {
      const links = all(
        'SELECT * FROM streaming_links WHERE guild_id = ? AND user_id = ?',
        [guild.id, ownerId]
      );

      if (!links || links.length === 0) {
        return interaction.reply({
          content: t('streaming.noLinks', {}, g),
          flags: MessageFlags.Ephemeral,
        });
      }

      const list = links.map(link => {
        const meta = PLATFORMS[link.platform] || { emoji: '📺', label: link.platform };
        const liveTag = meta.canDetectLive ? '' : ` *(${t('streaming.linkOnly', {}, g)})*`;
        return `${meta.emoji} **${meta.label}**${liveTag} — ${link.platform_url}`;
      }).join('\n');

      const embed = createEmbed({
        title: t('streaming.linkListTitle', {}, g),
        description: list,
        color: 'info',
        timestamp: true,
      });

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },
};
