const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const { createEmbed } = require('../../utils/embedBuilder');
const { hasPermission } = require('../../utils/permissions');
const { t } = require('../../utils/locale');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ai-agent')
    .setDescription('Configure the AI admin agent')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName('enable').setDescription('Enable AI agent')
        .addChannelOption(opt =>
          opt.setName('channel').setDescription('Dedicated agent channel (or use @mention anywhere)').addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand(sub =>
      sub.setName('disable').setDescription('Disable AI agent')
    )
    .addSubcommand(sub =>
      sub.setName('status').setDescription('Show AI agent settings')
    )
    .addSubcommand(sub =>
      sub.setName('set-permission').setDescription('Set minimum permission level to use agent')
        .addIntegerOption(opt =>
          opt.setName('level').setDescription('Permission level (2=Mod, 3=Admin, 4=Owner)').setRequired(true)
            .addChoices(
              { name: 'Moderator (level 2)', value: 2 },
              { name: 'Admin (level 3)', value: 3 },
              { name: 'Owner (level 4)', value: 4 }
            )
        )
    ),

  async execute(interaction) {
    const g = interaction.guild.id;

    if (!hasPermission(interaction.member, 'ai-agent')) {
      return interaction.reply({ content: t('general.noPermission', {}, g), flags: MessageFlags.Ephemeral });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'enable') {
      const channel = interaction.options.getChannel('channel');

      db.run(
        `INSERT INTO agent_settings (guild_id, enabled, channel_id)
         VALUES (?, 1, ?)
         ON CONFLICT(guild_id) DO UPDATE SET enabled = 1, channel_id = ?`,
        [g, channel?.id || null, channel?.id || null]
      );

      const desc = channel
        ? t('agent.enabledWithChannel', { channel: `<#${channel.id}>` }, g)
        : t('agent.enabledMention', {}, g);

      const embed = createEmbed({
        title: t('agent.enabled', {}, g),
        description: desc,
        color: 'success',
        timestamp: true,
      });
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'disable') {
      db.run('UPDATE agent_settings SET enabled = 0 WHERE guild_id = ?', [g]);
      return interaction.reply({
        embeds: [createEmbed({ title: t('agent.disabled', {}, g), color: 'danger', timestamp: true })],
      });
    }

    if (sub === 'status') {
      const settings = db.get('SELECT * FROM agent_settings WHERE guild_id = ?', [g]);

      if (!settings || !settings.enabled) {
        return interaction.reply({ content: t('agent.notEnabled', {}, g), flags: MessageFlags.Ephemeral });
      }

      const permNames = { 2: 'Moderator', 3: 'Admin', 4: 'Owner' };
      const embed = createEmbed({
        title: t('agent.statusTitle', {}, g),
        color: 'primary',
        fields: [
          { name: t('general.active', {}, g), value: settings.enabled ? '✅' : '❌', inline: true },
          { name: t('agent.channel', {}, g), value: settings.channel_id ? `<#${settings.channel_id}>` : 'Mention only', inline: true },
          { name: t('agent.minPermission', {}, g), value: permNames[settings.min_permission_level] || 'Admin', inline: true },
        ],
        timestamp: true,
      });
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'set-permission') {
      const level = interaction.options.getInteger('level');
      db.run(`INSERT INTO agent_settings (guild_id, min_permission_level) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET min_permission_level = ?`, [g, level, level]);

      const permNames = { 2: 'Moderator', 3: 'Admin', 4: 'Owner' };
      return interaction.reply({
        embeds: [createEmbed({
          title: t('agent.permissionUpdated', {}, g),
          description: `${t('agent.minPermission', {}, g)}: **${permNames[level]}**`,
          color: 'success',
          timestamp: true,
        })],
      });
    }
  },
};
