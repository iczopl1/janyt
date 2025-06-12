const { SlashCommandBuilder } = require('discord.js');
const Playlist = require('../../models/Playlist');
const { search } = require('play-dl');

async function findSong(query) {
    try {
        // If it's a URL, return it directly
        if (query.match(/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/)) {
            return {
                title: query, // You might want to fetch the actual title
                url: query,
                duration: 0, // Default to 0 if unknown
                path: 'youtube' // Add required path field
            };
        }
        
        // Search for the song if it's not a URL
        const results = await search(query, { limit: 1 });
        if (results.length === 0) {
            throw new Error('No results found');
        }
        
        return {
            title: results[0].title,
            url: results[0].url,
            duration: results[0].durationInSec || 0, // Ensure this is a number
            path: 'youtube' // Add required path field
        };
    } catch (error) {
        console.error('Error finding song:', error);
        throw error;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playlist-add')
        .setDescription('Add a song to your playlist')
        .addStringOption(option =>
            option.setName('playlist')
                .setDescription('Name of your playlist')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('song')
                .setDescription('YouTube URL or search query')
                .setRequired(true)),
    
    async execute(interaction) {
        const playlistName = interaction.options.getString('playlist');
        const songQuery = interaction.options.getString('song');
        const userId = interaction.user.id;

        try {
            const playlist = await Playlist.findOne({ userId, name: playlistName });
            if (!playlist) {
                return interaction.reply({ 
                    content: `Playlist "${playlistName}" not found!`, 
                    flags: 'Ephemeral'
                });
            }

            const songData = await findSong(songQuery);
            
            const songExists = playlist.songs.some(song => song.url === songData.url);
            if (songExists) {
                return interaction.reply({ 
                    content: `This song is already in your playlist "${playlistName}"!`, 
                    flags: 'Ephemeral'
                });
            }

            playlist.songs.push({
                title: songData.title,
                url: songData.url,
                duration: songData.duration,
                path: songData.path, // Add the required path field
                addedAt: new Date()
            });

            await playlist.save();
            await interaction.reply(`✅ Added **${songData.title}** to **${playlistName}**`);
        } catch (error) {
            console.error('Error adding song to playlist:', error);
            await interaction.reply({ 
                content: 'Failed to add song to playlist. Please try again.', 
                flags: 'Ephemeral'
            });
        }
    }
};
