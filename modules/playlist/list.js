const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Playlist = require('../../models/Playlist');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playlist-list')
        .setDescription('List all your playlists'),
    
    async execute(interaction) {
        const userId = interaction.user.id;

        try {
            const playlists = await Playlist.find({ userId }).sort({ createdAt: -1 });

            if (playlists.length === 0) {
                return interaction.reply({ 
                    content: "You don't have any playlists yet!", 
                    ephemeral: true 
                });
            }

            const embed = new EmbedBuilder()
                .setTitle('Your Playlists')
                .setColor('#0099ff');

            playlists.forEach(playlist => {
                embed.addFields({
                    name: playlist.name,
                    value: `${playlist.songs.length} songs | ${playlist.isPublic ? 'Public' : 'Private'}`,
                    inline: true
                });
            });

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await interaction.reply({ 
                content: 'Failed to list playlists', 
                ephemeral: true 
            });
        }
    }
};
