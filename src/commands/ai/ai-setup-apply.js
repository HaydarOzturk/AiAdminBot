const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { hasPermission } = require('../../utils/permissions');
const { createEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/locale');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ai-setup-apply')
    .setDescription('Apply AI-generated setup plan to server (Owner only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const g = interaction.guild?.id;
    if (!hasPermission(interaction.member, 'setup-server')) {
      return interaction.reply({
        content: t('setup.ownerOnly', {}, g),
        flags: MessageFlags.Ephemeral,
      });
    }

    // Check if AI-generated config exists
    const { loadGeneratedConfig } = require('../../systems/aiSetup');
    const setupConfig = loadGeneratedConfig();

    if (!setupConfig) {
      return interaction.reply({
        content: '❌ AI setup plan not found. Create one first with `/ai-setup`.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    try {
      // Use the serverSetup system but with the AI-generated config
      const {
        ChannelType,
        PermissionFlagsBits: PFlags,
        PermissionsBitField,
      } = require('discord.js');

      const PERM_MAP = {
        ViewChannel: PFlags.ViewChannel,
        SendMessages: PFlags.SendMessages,
        ReadMessageHistory: PFlags.ReadMessageHistory,
        AddReactions: PFlags.AddReactions,
        AttachFiles: PFlags.AttachFiles,
        EmbedLinks: PFlags.EmbedLinks,
        Connect: PFlags.Connect,
        Speak: PFlags.Speak,
        ManageMessages: PFlags.ManageMessages,
        KickMembers: PFlags.KickMembers,
        MuteMembers: PFlags.MuteMembers,
        DeafenMembers: PFlags.DeafenMembers,
        MoveMembers: PFlags.MoveMembers,
        ManageNicknames: PFlags.ManageNicknames,
        ModerateMembers: PFlags.ModerateMembers,
        Administrator: PFlags.Administrator,
      };

      const guild = interaction.guild;
      const result = {
        rolesCreated: 0, rolesSkipped: 0,
        categoriesCreated: 0, categoriesSkipped: 0,
        channelsCreated: 0, channelsSkipped: 0,
        verificationSent: false,
        errors: [],
      };

      // ── 1. Create roles ───────────────────────────────────────────────
      for (const roleCfg of setupConfig.roles) {
        const existing = guild.roles.cache.find(r => r.name === roleCfg.name);
        if (existing) { result.rolesSkipped++; continue; }

        try {
          const opts = {
            name: roleCfg.name,
            colors: { primaryColor: roleCfg.color || '#99aab5' },
            hoist: roleCfg.hoist || false,
            reason: 'AI Setup by AdminBot',
          };

          if (roleCfg.permissions && roleCfg.permissions.length > 0) {
            let bits = 0n;
            for (const p of roleCfg.permissions) { if (PERM_MAP[p]) bits |= PERM_MAP[p]; }
            opts.permissions = new PermissionsBitField(bits);
          }

          await guild.roles.create(opts);
          result.rolesCreated++;
        } catch (err) {
          result.errors.push(`Rol "${roleCfg.name}": ${err.message}`);
        }
      }

      await guild.roles.fetch();

      // ── 2. Create categories & channels ────────────────────────────────
      const everyoneRole = guild.roles.everyone;
      const staffRoles = guild.roles.cache.filter(
        r => r.name === 'Admin' || r.name === 'Moderator'
      );

      const autoSetupQueue = [];

      for (const catCfg of setupConfig.categories) {
        let category = guild.channels.cache.find(
          c => c.type === ChannelType.GuildCategory && c.name === catCfg.name
        );

        if (!category) {
          try {
            const catPerms = [];
            if (catCfg.staffOnly) {
              catPerms.push({ id: everyoneRole.id, deny: [PFlags.ViewChannel] });
              for (const [, sr] of staffRoles) {
                catPerms.push({ id: sr.id, allow: [PFlags.ViewChannel, PFlags.SendMessages] });
              }
            }

            category = await guild.channels.create({
              name: catCfg.name,
              type: ChannelType.GuildCategory,
              permissionOverwrites: catPerms,
              reason: 'AI Setup by AdminBot',
            });
            result.categoriesCreated++;
          } catch (err) {
            result.errors.push(`Kategori "${catCfg.name}": ${err.message}`);
            continue;
          }
        } else {
          result.categoriesSkipped++;
        }

        for (const chCfg of catCfg.channels) {
          const chType = chCfg.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;

          const existingCh = guild.channels.cache.find(
            c => c.name === chCfg.name && c.parentId === category.id
          );

          if (existingCh) {
            result.channelsSkipped++;
            if (chCfg.autoSetup) autoSetupQueue.push({ channel: existingCh, autoSetup: chCfg.autoSetup });
            continue;
          }

          try {
            const overwrites = [];

            if (catCfg.staffOnly) {
              overwrites.push({ id: everyoneRole.id, deny: [PFlags.ViewChannel] });
              for (const [, sr] of staffRoles) {
                overwrites.push({ id: sr.id, allow: [PFlags.ViewChannel, PFlags.SendMessages] });
              }
            } else if (chCfg.permissions) {
              for (const [roleName, perms] of Object.entries(chCfg.permissions)) {
                let targetId;
                if (roleName === 'everyone') targetId = everyoneRole.id;
                else {
                  const role = guild.roles.cache.find(r => r.name === roleName);
                  if (!role) continue;
                  targetId = role.id;
                }
                const ow = { id: targetId };
                if (perms.allow) ow.allow = perms.allow.map(p => PERM_MAP[p]).filter(Boolean);
                if (perms.deny) ow.deny = perms.deny.map(p => PERM_MAP[p]).filter(Boolean);
                overwrites.push(ow);
              }
            }

            const newCh = await guild.channels.create({
              name: chCfg.name,
              type: chType,
              parent: category.id,
              topic: chCfg.topic || null,
              permissionOverwrites: overwrites,
              reason: 'AI Setup by AdminBot',
            });
            result.channelsCreated++;

            if (chCfg.autoSetup) autoSetupQueue.push({ channel: newCh, autoSetup: chCfg.autoSetup });
          } catch (err) {
            result.errors.push(`Kanal "${chCfg.name}": ${err.message}`);
          }
        }
      }

      // ── 3. Auto-setup (verification) ──────────────────────────────────
      for (const { channel, autoSetup } of autoSetupQueue) {
        try {
          const messages = await channel.messages.fetch({ limit: 10 });
          const botMsgs = messages.filter(m => m.author.id === guild.members.me.id);
          if (botMsgs.size > 0) continue;

          if (autoSetup === 'verification') {
            const verification = require('../../systems/verification');
            await verification.sendVerificationMessage(channel, guild.id);
            result.verificationSent = true;
          }
        } catch (err) {
          result.errors.push(`Auto-setup #${channel.name}: ${err.message}`);
        }
      }

      // ── Summary embed ─────────────────────────────────────────────────
      const fields = [
        { name: '✅ Roles', value: `${result.rolesCreated} created, ${result.rolesSkipped} already existed` },
        { name: '✅ Categories', value: `${result.categoriesCreated} created, ${result.categoriesSkipped} already existed` },
        { name: '✅ Channels', value: `${result.channelsCreated} created, ${result.channelsSkipped} already existed` },
      ];

      if (result.verificationSent) {
        fields.push({ name: t('setup.verification', {}, g), value: t('setup.verificationSent', {}, g) });
      }

      if (result.errors.length > 0) {
        fields.push({ name: t('setup.warnings', {}, g), value: result.errors.slice(0, 5).join('\n') });
      }

      const embed = createEmbed({
        title: '🤖 AI Setup Plan Applied!',
        description: t('setup.setupCompleteSummary', {}, g),
        color: result.errors.length > 0 ? 'warning' : 'success',
        fields,
        timestamp: true,
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('AI setup apply failed:', error);
      await interaction.editReply({ content: '❌ Setup failed: ' + error.message });
    }
  },
};
