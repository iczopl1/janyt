const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the current song'),
    
    async execute(interaction) {
        const queue = interaction.client.queues?.get(interaction.guild.id);
        
        if (!queue) {
            return interaction.reply('No music is playing!');
        }

        queue.player.stop();
        await interaction.reply('Skipped the current song!');
    }
};
