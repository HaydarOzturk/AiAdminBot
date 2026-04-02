const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const { createEmbed } = require('../../utils/embedBuilder');
const { hasPermission } = require('../../utils/permissions');
const { t } = require('../../utils/locale');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('starboard')
    .setDescription('Configure the starboard')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName('enable').setDescription('Enable starboard')
        .addChannelOption(opt =>
          opt.setName('channel').setDescription('Starboard channel').addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand(sub =>
      sub.setName('disable').setDescription('Disable starboard')
    )
    .addSubcommand(sub =>
      sub.setName('config').setDescription('Configure starboard settings')
        .addIntegerOption(opt =>
          opt.setName('threshold').setDescription('Stars needed (default: 3)').setMinValue(1).setMaxValue(25)
        )
        .addStringOption(opt =>
          opt.setName('emoji').setDescription('Reaction emoji (default: ⭐)')
        )
        .addBooleanOption(opt =>
          opt.setName('self-star').setDescription('Allow self-starring? (default: no)')
        )
    )
    .addSubcommand(sub =>
      sub.setName('status').setDescription('Show starboard settings')
    ),

  async execute(interaction) {
    const g = interaction.guild.id;

    if (!hasPermission(interaction.member, 'starboard')) {
      return interaction.reply({ content: t('general.noPermission', {}, g), flags: MessageFlags.Ephemeral });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'enable') {
      const channel = interaction.options.getChannel('channel') || interaction.channel;

      db.run(
        `INSERT INTO starboard_settings (guild_id, enabled, channel_id, threshold, emoji, self_star)
         VALUES (?, 1, ?, 3, '⭐', 0)
         ON CONFLICT(guild_id) DO UPDATE SET enabled = 1, channel_id = ?`,
        [g, channel.id, channel.id]
      );

      const embed = createEmbed({
        title: t('starboard.enabled', {}, g),
        description: t('starboard.enabledDesc', { channel: `<#${channel.id}>` }, g),
        color: 'success',
        timestamp: true,
      });
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'disable') {
      db.run('UPDATE starboard_settings SET enabled = 0 WHERE guild_id = ?', [g]);
      return interaction.reply({
        embeds: [createEmbed({ title: t('starboard.disabled', {}, g), color: 'danger', timestamp: true })],
      });
    }

    if (sub === 'config') {
      const threshold = interaction.options.getInteger('threshold');
      const emoji = interaction.options.getString('emoji');
      const selfStar = interaction.options.getBoolean('self-star');

      db.run(`INSERT INTO starboard_settings (guild_id) VALUES (?) ON CONFLICT(guild_id) DO NOTHING`, [g]);

      const updates = [];
      const values = [];

      if (threshold !== null) { updates.push('threshold = ?'); values.push(threshold); }
      if (emoji !== null) { updates.push('emoji = ?'); values.push(emoji); }
      if (selfStar !== null) { updates.push('self_star = ?'); values.push(selfStar ? 1 : 0); }

      if (updates.length === 0) {
        return interaction.reply({ content: t('automod.noChanges', {}, g), flags: MessageFlags.Ephemeral });
      }

      values.push(g);
      db.run(`UPDATE starboard_settings SET ${updates.join(', ')} WHERE guild_id = ?`, values);

      return interaction.reply({
        embeds: [createEmbed({ title: t('starboard.configUpdated', {}, g), color: 'success', timestamp: true })],
      });
    }

    if (sub === 'status') {
      const settings = db.get('SELECT * FROM starboard_settings WHERE guild_id = ?', [g]);

      if (!settings) {
        return interaction.reply({ content: t('starboard.notEnabled', {}, g), flags: MessageFlags.Ephemeral });
      }

      const embed = createEmbed({
        title: t('starboard.statusTitle', {}, g),
        color: 'warning',
        fields: [
          { name: t('general.active', {}, g), value: settings.enabled ? '✅' : '❌', inline: true },
          { name: 'Channel', value: settings.channel_id ? `<#${settings.channel_id}>` : '-', inline: true },
          { name: 'Threshold', value: `${settings.threshold || 3}`, inline: true },
          { name: 'Emoji', value: settings.emoji || '⭐', inline: true },
          { name: 'Self-star', value: settings.self_star ? '✅' : '❌', inline: true },
        ],
        timestamp: true,
      });
      return interaction.reply({ embeds: [embed] });
    }
  },
};
