require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

// Replace with your own values
const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.MAIN_GUILD_ID;

// Define your commands
const commands = [
  new SlashCommandBuilder()
    .setName('syncbans')
    .setDescription('Sync this server’s ban list across all other servers'),
].map(command => command.toJSON());

// Deploy the commands
const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log(`🛰️ Deploying commands to guild ${guildId}...`);
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands }
    );
    console.log('✅ Successfully deployed guild commands!');
  } catch (error) {
    console.error('❌ Error deploying commands:', error);
  }
})();