const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop the music and clear the queue'),
    
    async execute(interaction) {
        const queue = interaction.client.queues?.get(interaction.guild.id);
        
        if (!queue) {
            return interaction.reply('No music is playing!');
        }

        queue.player.stop();
        queue.connection.destroy();
        interaction.client.queues.delete(interaction.guild.id);
        
        await interaction.reply('Stopped the music and cleared the queue!');
    }
};
