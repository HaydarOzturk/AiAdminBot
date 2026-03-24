const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { createEmbed } = require('../../utils/embedBuilder');
const { t, channelName } = require('../../utils/locale');
const { localesDir } = require('../../utils/paths');

/**
 * Collect every possible translated name for a channelNames key
 * across ALL locale files, so we can find the channel regardless
 * of which language was active when /setup ran.
 */
function getAllTranslations(localeKey) {
  const names = new Set();
  const dir = localesDir();

  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
        const keys = localeKey.split('.');
        let val = data;
        for (const k of keys) val = val?.[k];
        if (typeof val === 'string') names.add(val.toLowerCase());
      } catch { /* skip bad files */ }
    }
  } catch { /* dir missing */ }

  return names;
}

/**
 * Find a channel by checking every possible locale translation of its name.
 */
function findChannelByLocaleKey(guild, localeKey) {
  const possibleNames = getAllTranslations(localeKey);
  return guild.channels.cache.find(
    c => c.type === ChannelType.GuildText && possibleNames.has(c.name.toLowerCase())
  );
}

/**
 * Find a role by checking every possible locale translation.
 */
function findRoleByLocaleKey(guild, localeKey) {
  const possibleNames = getAllTranslations(localeKey);
  return guild.roles.cache.find(r => possibleNames.has(r.name.toLowerCase()));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('fix-permissions')
    .setDescription(t('fixPerms.commandDesc'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const g = interaction.guild?.id;
    // Owner-only guard
    if (interaction.user.id !== interaction.guild.ownerId) {
      return interaction.reply({
        content: t('setup.ownerOnly', {}, g),
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    const guild = interaction.guild;
    const everyoneRole = guild.roles.everyone;
    const verifiedRole = findRoleByLocaleKey(guild, 'roles.verified');
    const changes = [];
    const errors = [];

    // ── 1. Find or create the verification category ─────────────────────
    const catNames = getAllTranslations('channelNames.cat-verification');
    let verificationCategory = guild.channels.cache.find(
      c => c.type === ChannelType.GuildCategory && catNames.has(c.name.toLowerCase())
    );

    if (!verificationCategory) {
      try {
        verificationCategory = await guild.channels.create({
          name: channelName('cat-verification'),
          type: ChannelType.GuildCategory,
          reason: t('fixPerms.reason', {}, g),
        });
        changes.push(t('fixPerms.createdCategory', { name: verificationCategory.name }, g));
      } catch (err) {
        errors.push(t('fixPerms.failedCategory', { error: err.message }, g));
      }
    }

    // ── 2. Rules channel ────────────────────────────────────────────────
    let rulesChannel = findChannelByLocaleKey(guild, 'channelNames.rules');

    if (rulesChannel) {
      // Patch permissions on existing channel
      try {
        await rulesChannel.permissionOverwrites.edit(everyoneRole, {
          ViewChannel: true,
          ReadMessageHistory: true,
          SendMessages: false,
        });
        changes.push(t('fixPerms.fixedChannel', { name: rulesChannel.name }, g));
      } catch (err) {
        errors.push(t('fixPerms.failedChannel', { name: rulesChannel.name, error: err.message }, g));
      }
    } else if (verificationCategory) {
      // Create rules channel
      try {
        rulesChannel = await guild.channels.create({
          name: channelName('rules'),
          type: ChannelType.GuildText,
          parent: verificationCategory.id,
          topic: t('setup.rulesTopic', {}, g),
          permissionOverwrites: [
            {
              id: everyoneRole.id,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
              deny: [PermissionFlagsBits.SendMessages],
            },
          ],
          reason: t('fixPerms.reason', {}, g),
        });
        changes.push(t('fixPerms.createdChannel', { name: rulesChannel.name }, g));
      } catch (err) {
        errors.push(t('fixPerms.failedChannel', { name: channelName('rules'), error: err.message }, g));
      }
    }

    // ── 3. Verification channel ─────────────────────────────────────────
    let verifyChannel = findChannelByLocaleKey(guild, 'channelNames.verification');

    if (verifyChannel) {
      // Patch permissions on existing channel
      try {
        await verifyChannel.permissionOverwrites.edit(everyoneRole, {
          ViewChannel: true,
          ReadMessageHistory: true,
          SendMessages: false,
        });
        changes.push(t('fixPerms.fixedChannel', { name: verifyChannel.name }, g));
      } catch (err) {
        errors.push(t('fixPerms.failedChannel', { name: verifyChannel.name, error: err.message }, g));
      }

      // Hide verification channel from verified members
      if (verifiedRole) {
        try {
          await verifyChannel.permissionOverwrites.edit(verifiedRole, {
            ViewChannel: false,
          });
          changes.push(t('fixPerms.hiddenFromVerified', { name: verifyChannel.name }, g));
        } catch (err) {
          errors.push(t('fixPerms.failedRole', { name: verifyChannel.name, error: err.message }, g));
        }
      }
    } else if (verificationCategory) {
      // Create verification channel
      try {
        const overwrites = [
          {
            id: everyoneRole.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            deny: [PermissionFlagsBits.SendMessages],
          },
        ];

        if (verifiedRole) {
          overwrites.push({
            id: verifiedRole.id,
            deny: [PermissionFlagsBits.ViewChannel],
          });
        }

        verifyChannel = await guild.channels.create({
          name: channelName('verification'),
          type: ChannelType.GuildText,
          parent: verificationCategory.id,
          topic: t('setup.verificationTopic', {}, g),
          permissionOverwrites: overwrites,
          reason: t('fixPerms.reason', {}, g),
        });
        changes.push(t('fixPerms.createdChannel', { name: verifyChannel.name }, g));
      } catch (err) {
        errors.push(t('fixPerms.failedChannel', { name: channelName('verification'), error: err.message }, g));
      }
    }

    // ── 4. Send verification button if channel exists but has no bot message
    if (verifyChannel) {
      try {
        const messages = await verifyChannel.messages.fetch({ limit: 10 });
        const botMessages = messages.filter(m => m.author.id === guild.members.me.id);

        if (botMessages.size === 0) {
          const verification = require('../../systems/verification');
          await verification.sendVerificationMessage(verifyChannel, guild.id);
          changes.push(t('fixPerms.verificationSent', { name: verifyChannel.name }, g));
        }
      } catch (err) {
        errors.push(t('fixPerms.failedVerification', { error: err.message }, g));
      }
    }

    // ── 5. Build response ───────────────────────────────────────────────
    const fields = [];

    if (changes.length > 0) {
      fields.push({
        name: t('fixPerms.changesTitle', {}, g),
        value: changes.map(c => `✅ ${c}`).join('\n'),
      });
    }

    if (errors.length > 0) {
      fields.push({
        name: t('fixPerms.errorsTitle', {}, g),
        value: errors.map(e => `❌ ${e}`).join('\n'),
      });
    }

    if (changes.length === 0 && errors.length === 0) {
      fields.push({
        name: t('fixPerms.noChangesTitle', {}, g),
        value: t('fixPerms.noChangesDesc', {}, g),
      });
    }

    const embed = createEmbed({
      title: t('fixPerms.title', {}, g),
      description: t('fixPerms.description', {}, g),
      color: errors.length > 0 ? 'warning' : 'success',
      fields,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};
