const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createEmbed } = require('../../utils/embedBuilder');
const { hasPermission } = require('../../utils/permissions');
const { t } = require('../../utils/locale');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Configure advanced auto-moderation')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName('enable').setDescription('Enable auto-moderation for this server')
    )
    .addSubcommand(sub =>
      sub.setName('disable').setDescription('Disable auto-moderation')
    )
    .addSubcommand(sub =>
      sub.setName('status').setDescription('Show current automod settings')
    )
    .addSubcommand(sub =>
      sub.setName('toggle').setDescription('Toggle a specific automod feature')
        .addStringOption(opt =>
          opt.setName('feature').setDescription('Feature to toggle').setRequired(true)
            .addChoices(
              { name: 'Anti-Spam', value: 'anti_spam' },
              { name: 'Anti-Raid', value: 'anti_raid' },
              { name: 'Anti-Mention Spam', value: 'anti_mention_spam' },
              { name: 'Anti-Caps', value: 'anti_caps' },
              { name: 'Anti-Invites', value: 'anti_invites' },
              { name: 'Progressive Punishments', value: 'progressive_punishments' }
            )
        )
    )
    .addSubcommand(sub =>
      sub.setName('config').setDescription('Configure automod thresholds')
        .addIntegerOption(opt =>
          opt.setName('spam-threshold').setDescription('Messages before spam trigger (default: 5)').setMinValue(3).setMaxValue(15)
        )
        .addIntegerOption(opt =>
          opt.setName('spam-window').setDescription('Seconds to check for spam (default: 5)').setMinValue(3).setMaxValue(30)
        )
        .addIntegerOption(opt =>
          opt.setName('max-mentions').setDescription('Max mentions before trigger (default: 5)').setMinValue(2).setMaxValue(20)
        )
        .addIntegerOption(opt =>
          opt.setName('max-caps').setDescription('Max caps percentage (default: 70)').setMinValue(50).setMaxValue(100)
        )
        .addIntegerOption(opt =>
          opt.setName('raid-threshold').setDescription('Joins before raid alert (default: 10)').setMinValue(3).setMaxValue(30)
        )
        .addIntegerOption(opt =>
          opt.setName('raid-window').setDescription('Seconds to check for raid (default: 30)').setMinValue(10).setMaxValue(120)
        )
    ),

  async execute(interaction) {
    const g = interaction.guild.id;

    if (!hasPermission(interaction.member, 'automod')) {
      return interaction.reply({ content: t('general.noPermission', {}, g), flags: MessageFlags.Ephemeral });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'enable') {
      db.run(
        `INSERT INTO automod_settings (guild_id, anti_spam, anti_raid, anti_mention_spam, anti_caps, anti_invites, progressive_punishments)
         VALUES (?, 1, 1, 1, 1, 1, 1)
         ON CONFLICT(guild_id) DO UPDATE SET anti_spam = 1, anti_raid = 1, anti_mention_spam = 1, anti_caps = 1, anti_invites = 1`,
        [g]
      );

      const embed = createEmbed({
        title: t('automod.enabled', {}, g),
        description: t('automod.enabledDesc', {}, g),
        color: 'success',
        timestamp: true,
      });
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'disable') {
      db.run('DELETE FROM automod_settings WHERE guild_id = ?', [g]);
      const embed = createEmbed({
        title: t('automod.disabled', {}, g),
        color: 'danger',
        timestamp: true,
      });
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'status') {
      const settings = db.get('SELECT * FROM automod_settings WHERE guild_id = ?', [g]);

      if (!settings) {
        return interaction.reply({
          content: t('automod.notEnabled', {}, g),
          flags: MessageFlags.Ephemeral,
        });
      }

      const on = '✅';
      const off = '❌';

      const embed = createEmbed({
        title: t('automod.statusTitle', {}, g),
        color: 'primary',
        fields: [
          { name: t('automod.antiSpam', {}, g), value: `${settings.anti_spam ? on : off} (${settings.spam_threshold || 5} msgs / ${settings.spam_window || 5}s)`, inline: true },
          { name: t('automod.antiRaid', {}, g), value: `${settings.anti_raid ? on : off} (${settings.raid_threshold || 10} joins / ${settings.raid_window || 30}s)`, inline: true },
          { name: t('automod.antiMentionSpam', {}, g), value: `${settings.anti_mention_spam ? on : off} (max ${settings.max_mentions || 5})`, inline: true },
          { name: t('automod.antiCaps', {}, g), value: `${settings.anti_caps ? on : off} (${settings.max_caps_percent || 70}%)`, inline: true },
          { name: t('automod.antiInvites', {}, g), value: settings.anti_invites ? on : off, inline: true },
          { name: t('automod.progressive', {}, g), value: settings.progressive_punishments ? on : off, inline: true },
        ],
        timestamp: true,
      });

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'toggle') {
      const feature = interaction.options.getString('feature');

      // Ensure settings exist
      db.run(
        `INSERT INTO automod_settings (guild_id) VALUES (?) ON CONFLICT(guild_id) DO NOTHING`,
        [g]
      );

      const current = db.get('SELECT * FROM automod_settings WHERE guild_id = ?', [g]);
      const newValue = current[feature] ? 0 : 1;

      db.run(`UPDATE automod_settings SET ${feature} = ? WHERE guild_id = ?`, [newValue, g]);

      const embed = createEmbed({
        title: t('automod.featureToggled', {}, g),
        description: `**${feature.replace(/_/g, ' ')}**: ${newValue ? '✅ Enabled' : '❌ Disabled'}`,
        color: newValue ? 'success' : 'danger',
        timestamp: true,
      });

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'config') {
      // Ensure settings exist
      db.run(`INSERT INTO automod_settings (guild_id) VALUES (?) ON CONFLICT(guild_id) DO NOTHING`, [g]);

      const updates = {};
      const spamThreshold = interaction.options.getInteger('spam-threshold');
      const spamWindow = interaction.options.getInteger('spam-window');
      const maxMentions = interaction.options.getInteger('max-mentions');
      const maxCaps = interaction.options.getInteger('max-caps');
      const raidThreshold = interaction.options.getInteger('raid-threshold');
      const raidWindow = interaction.options.getInteger('raid-window');

      if (spamThreshold) updates.spam_threshold = spamThreshold;
      if (spamWindow) updates.spam_window = spamWindow;
      if (maxMentions) updates.max_mentions = maxMentions;
      if (maxCaps) updates.max_caps_percent = maxCaps;
      if (raidThreshold) updates.raid_threshold = raidThreshold;
      if (raidWindow) updates.raid_window = raidWindow;

      if (Object.keys(updates).length === 0) {
        return interaction.reply({ content: t('automod.noChanges', {}, g), flags: MessageFlags.Ephemeral });
      }

      const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      const values = [...Object.values(updates), g];
      db.run(`UPDATE automod_settings SET ${setClauses} WHERE guild_id = ?`, values);

      const embed = createEmbed({
        title: t('automod.configUpdated', {}, g),
        description: Object.entries(updates).map(([k, v]) => `**${k.replace(/_/g, ' ')}**: ${v}`).join('\n'),
        color: 'success',
        timestamp: true,
      });

      return interaction.reply({ embeds: [embed] });
    }
  },
};
