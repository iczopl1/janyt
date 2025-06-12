const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('List all available commands'),
  
  async execute(interaction) {
    const modulesPath = path.join(__dirname, '../..', 'modules');
    
    try {
      const moduleFolders = fs.readdirSync(modulesPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

      const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('Available Commands')
        .setDescription('Here are all the commands you can use:');

      // Scan each subfolder in /modules
      for (const folder of moduleFolders) {
        const commandsPath = path.join(modulesPath, folder);
        const commandFiles = fs.readdirSync(commandsPath)
          .filter(file => file.endsWith('.js'));

        for (const file of commandFiles) {
          const command = require(path.join(commandsPath, file));
          if (command.data) {
            embed.addFields({
              name: `/${command.data.name}`,
              value: command.data.description || 'No description provided',
              inline: true
            });
          }
        }
      }

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('Error loading help command:', error);
      await interaction.reply({ 
        content: '❌ Failed to load command list', 
        ephemeral: true 
      });
    }
  }
};

