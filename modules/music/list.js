const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('list')
        .setDescription('Show the current music queue'),
    
    async execute(interaction) {
        const queue = interaction.client.queues?.get(interaction.guild.id);
        
        if (!queue || queue.songs.length === 0) {
            return interaction.reply('The queue is empty!');
        }

        const embed = new EmbedBuilder()
            .setTitle('Music Queue')
            .setColor('#0099ff')
            .setDescription(queue.songs.map((song, index) => 
                `${index + 1}. **${song.title}** - Requested by <@${song.requestedBy}>`
            ).join('\n'))
            .addFields({
                name: 'Now Playing',
                value: `**${queue.songs[0].title}**`
            });

        await interaction.reply({ embeds: [embed] });
    }
};
