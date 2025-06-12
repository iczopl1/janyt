const { SlashCommandBuilder } = require('discord.js');
const { Playlist } = require('../../models/Playlist');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playlist-remove')
        .setDescription('Remove a song from your playlist')
        .addStringOption(option =>
            option.setName('playlist')
                .setDescription('Name of your playlist')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('position')
                .setDescription('Position number of the song to remove')
                .setRequired(true)),
    
    async execute(interaction) {
        const playlistName = interaction.options.getString('playlist');
        const position = interaction.options.getInteger('position') - 1;
        const userId = interaction.user.id;

        try {
            const playlist = await Playlist.findOne({ userId, name: playlistName });
            if (!playlist) {
                return interaction.reply({ content: "Playlist not found!", ephemeral: true });
            }

            if (position < 0 || position >= playlist.songs.length) {
                return interaction.reply({ content: "Invalid song position!", ephemeral: true });
            }

            const removedSong = playlist.songs.splice(position, 1)[0];
            await playlist.save();
            
            await interaction.reply(`✅ Removed **${removedSong.title}** from **${playlistName}**`);
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: 'Failed to remove song from playlist', ephemeral: true });
        }
    }
};
