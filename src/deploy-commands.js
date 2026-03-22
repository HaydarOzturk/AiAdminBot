/**
 * Deploy (register) slash commands with Discord
 * Run: npm run deploy
 *
 * Always registers GLOBAL commands (work on every server).
 * Also auto-registers to every server the bot is already in
 * for instant availability (no 1-hour wait).
 */

require('dotenv').config();

const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(commandsPath);

for (const folder of commandFolders) {
  const folderPath = path.join(commandsPath, folder);
  if (!fs.statSync(folderPath).isDirectory()) continue;

  const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    const command = require(path.join(folderPath, file));
    if ('data' in command) {
      commands.push(command.data.toJSON());
      console.log(`  📝 Loaded: /${command.data.name}`);
    }
  }
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`\n🔄 Deploying ${commands.length} slash commands...\n`);

    // 1. Always register globally (covers future servers)
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log(`🌐 Registered ${commands.length} global commands.`);
    console.log(`   (New servers may take up to 1 hour to see these)\n`);

    // 2. Also register to every server the bot is currently in (instant)
    const guilds = await rest.get(Routes.userGuilds());
    console.log(`⚡ Pushing commands instantly to ${guilds.length} server(s)...`);

    let success = 0;
    let failed = 0;

    for (const guild of guilds) {
      try {
        await rest.put(
          Routes.applicationGuildCommands(process.env.CLIENT_ID, guild.id),
          { body: commands }
        );
        console.log(`   ✅ ${guild.name}`);
        success++;
      } catch (err) {
        console.log(`   ⚠️  ${guild.name}: ${err.message}`);
        failed++;
      }
    }

    console.log(`\n✅ Done! ${success} server(s) updated instantly, ${failed} skipped.`);
    console.log(`   Commands will appear on new servers within ~1 hour.`);
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
})();
