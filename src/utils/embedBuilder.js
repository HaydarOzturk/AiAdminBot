const { EmbedBuilder } = require('discord.js');

const COLORS = {
  primary: 0x5865f2,
  success: 0x57f287,
  danger: 0xed4245,
  warning: 0xfee75c,
  orange: 0xf0883e,
  purple: 0xa855f7,
  info: 0x00b4d8,
};

/**
 * Create a styled embed quickly
 */
function createEmbed({ title, description, color = 'primary', fields = [], footer, thumbnail, timestamp = false }) {
  const embed = new EmbedBuilder()
    .setColor(COLORS[color] || COLORS.primary);

  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (footer) embed.setFooter({ text: footer });
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (timestamp) embed.setTimestamp();

  for (const field of fields) {
    embed.addFields({
      name: field.name,
      value: String(field.value),
      inline: field.inline ?? true,
    });
  }

  return embed;
}

module.exports = { createEmbed, COLORS };
