const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { createEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/locale');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('server-reset')
    .setDescription('Delete all channels and roles to start fresh (Owner only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt
        .setName('mode')
        .setDescription('What to reset')
        .setRequired(true)
        .addChoices(
          { name: 'Channels only', value: 'channels' },
          { name: 'Roles only', value: 'roles' },
          { name: 'Everything (channels + roles)', value: 'all' },
        )
    ),

  async execute(interaction) {
    // Owner only — level 4
    if (!hasPermission(interaction.member, 'setup-server')) {
      return interaction.reply({
        content: t('setup.ownerOnly'),
        flags: MessageFlags.Ephemeral,
      });
    }

    const mode = interaction.options.getString('mode');
    const guild = interaction.guild;

    // Count what will be deleted
    const channelCount = guild.channels.cache.size;
    const roleCount = guild.roles.cache.filter(r => r.id !== guild.id && !r.managed).size;
    const memberCount = guild.memberCount;

    const modeLabel = mode === 'channels'
      ? t('serverReset.channelsOnly')
      : mode === 'roles'
        ? t('serverReset.rolesOnly')
        : t('serverReset.everything');

    // Preview embed
    const embed = createEmbed({
      title: t('serverReset.confirmTitle'),
      description: t('serverReset.confirmDescription'),
      color: 'danger',
      fields: [
        { name: t('serverReset.mode'), value: modeLabel, inline: true },
        { name: t('serverReset.membersKept'), value: `${memberCount}`, inline: true },
      ],
      timestamp: true,
    });

    if (mode === 'channels' || mode === 'all') {
      embed.addFields({ name: t('serverReset.channelsToDelete'), value: `${channelCount}`, inline: true });
    }
    if (mode === 'roles' || mode === 'all') {
      embed.addFields({ name: t('serverReset.rolesToDelete'), value: `${roleCount}`, inline: true });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('server_reset_confirm')
        .setLabel(t('serverReset.confirmButton'))
        .setStyle(ButtonStyle.Danger)
        .setEmoji('⚠️'),
      new ButtonBuilder()
        .setCustomId('server_reset_cancel')
        .setLabel(t('serverReset.cancelButton'))
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('❌'),
    );

    const reply = await interaction.reply({
      embeds: [embed],
      components: [row],
      flags: MessageFlags.Ephemeral,
    });

    // Wait for confirmation
    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 30000, // 30 seconds — short window for dangerous action
    });

    collector.on('collect', async i => {
      collector.stop();

      if (i.customId === 'server_reset_cancel') {
        return i.update({
          content: t('serverReset.cancelled'),
          embeds: [],
          components: [],
        });
      }

      // ── CONFIRMED — start deletion ─────────────────────────────────
      await i.update({
        content: t('serverReset.inProgress'),
        embeds: [],
        components: [],
      });

      let deletedChannels = 0;
      let deletedRoles = 0;
      let errors = 0;

      // Delete channels
      if (mode === 'channels' || mode === 'all') {
        for (const [, channel] of guild.channels.cache) {
          try {
            await channel.delete(`Server reset by ${interaction.user.tag}`);
            deletedChannels++;
          } catch (err) {
            // Some system channels can't be deleted
            console.warn(`⚠️ Could not delete channel ${channel.name}: ${err.message}`);
            errors++;
          }
        }
      }

      // Delete roles (skip @everyone and managed/bot roles)
      if (mode === 'roles' || mode === 'all') {
        const deletableRoles = guild.roles.cache
          .filter(r => r.id !== guild.id && !r.managed && r.position < guild.members.me.roles.highest.position)
          .sort((a, b) => a.position - b.position); // Delete lowest first

        for (const [, role] of deletableRoles) {
          try {
            await role.delete(`Server reset by ${interaction.user.tag}`);
            deletedRoles++;
          } catch (err) {
            console.warn(`⚠️ Could not delete role ${role.name}: ${err.message}`);
            errors++;
          }
        }
      }

      // Since channels were deleted, we need a new channel to send the result
      // Create a temporary "general" channel
      let resultChannel = null;
      if (mode === 'channels' || mode === 'all') {
        try {
          resultChannel = await guild.channels.create({
            name: 'general',
            reason: 'Server reset — created default channel for results',
          });
        } catch {
          // Can't create a channel — no way to report results
        }
      }

      const resultEmbed = createEmbed({
        title: t('serverReset.completeTitle'),
        color: errors > 0 ? 'warning' : 'success',
        fields: [
          { name: t('serverReset.channelsDeleted'), value: `${deletedChannels}`, inline: true },
          { name: t('serverReset.rolesDeleted'), value: `${deletedRoles}`, inline: true },
          { name: t('serverReset.errors'), value: `${errors}`, inline: true },
          { name: t('serverReset.membersKept'), value: `${memberCount}`, inline: true },
        ],
        footer: t('serverReset.completeFooter'),
        timestamp: true,
      });

      if (resultChannel) {
        await resultChannel.send({ embeds: [resultEmbed] });
      }

      console.log(`🔥 Server reset in ${guild.name}: ${deletedChannels} channels, ${deletedRoles} roles deleted, ${errors} errors`);
    });

    collector.on('end', (collected, reason) => {
      if (reason === 'time') {
        interaction.editReply({
          content: t('serverReset.timedOut'),
          embeds: [],
          components: [],
        }).catch(() => {});
      }
    });
  },
};
