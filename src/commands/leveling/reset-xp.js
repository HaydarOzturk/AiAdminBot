const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { createEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/locale');
const db = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reset-xp')
    .setDescription('Reset XP data (Owner only)')
    .addSubcommand(sub =>
      sub.setName('user')
        .setDescription('Reset a single user\'s XP')
        .addUserOption(opt =>
          opt.setName('target').setDescription('The user to reset').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('server')
        .setDescription('Reset ALL XP for the entire server')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const g = interaction.guild?.id;
    const sub = interaction.options.getSubcommand();

    // Only server owner or DEBUG_OWNER_ID
    const isOwner =
      interaction.user.id === interaction.guild.ownerId ||
      interaction.user.id === process.env.DEBUG_OWNER_ID;

    if (!isOwner) {
      return interaction.reply({
        content: t('resetXp.ownerOnly', {}, g),
        ephemeral: true,
      });
    }

    if (sub === 'user') {
      const target = interaction.options.getUser('target');

      db.run(
        'DELETE FROM levels WHERE user_id = ? AND guild_id = ?',
        [target.id, interaction.guild.id]
      );
      db.run(
        'DELETE FROM daily_xp WHERE user_id = ? AND guild_id = ?',
        [target.id, interaction.guild.id]
      );

      const embed = createEmbed({
        title: t('resetXp.userResetTitle', {}, g),
        description: t('resetXp.userResetDesc', { user: target.username }, g),
        color: 'warning',
        timestamp: true,
      });

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'server') {
      // Confirmation button
      const confirmBtn = new ButtonBuilder()
        .setCustomId('reset_xp_confirm')
        .setLabel(t('resetXp.confirmButton', {}, g))
        .setStyle(ButtonStyle.Danger);

      const cancelBtn = new ButtonBuilder()
        .setCustomId('reset_xp_cancel')
        .setLabel(t('resetXp.cancelButton', {}, g))
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

      const embed = createEmbed({
        title: t('resetXp.serverConfirmTitle', {}, g),
        description: t('resetXp.serverConfirmDesc', {}, g),
        color: 'danger',
        timestamp: true,
      });

      const reply = await interaction.reply({
        embeds: [embed],
        components: [row],
        flags: MessageFlags.Ephemeral,
      });

      try {
        const i = await reply.awaitMessageComponent({
          filter: btn => btn.user.id === interaction.user.id,
          time: 30000,
        });

        if (i.customId === 'reset_xp_confirm') {
          db.run('DELETE FROM levels WHERE guild_id = ?', [interaction.guild.id]);
          db.run('DELETE FROM daily_xp WHERE guild_id = ?', [interaction.guild.id]);

          const doneEmbed = createEmbed({
            title: t('resetXp.serverResetTitle', {}, g),
            description: t('resetXp.serverResetDesc', {}, g),
            color: 'warning',
            timestamp: true,
          });

          await i.update({ embeds: [doneEmbed], components: [] });
        } else {
          await i.update({
            content: t('resetXp.cancelled', {}, g),
            embeds: [],
            components: [],
          });
        }
      } catch {
        await interaction.editReply({
          content: t('resetXp.timeout', {}, g),
          embeds: [],
          components: [],
        });
      }
    }
  },
};
