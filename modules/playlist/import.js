const { SlashCommandBuilder } = require('discord.js');
const Playlist = require('../../models/Playlist');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playlist-import')
        .setDescription('Import a playlist from a JSON file')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Name for the new playlist')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('JSON playlist file to import')
                .setRequired(true)),
    
    async execute(interaction) {
        const newPlaylistName = interaction.options.getString('name');
        const attachment = interaction.options.getAttachment('file');
        const userId = interaction.user.id;
        const guildId = interaction.guild.id;

        await interaction.deferReply();

        try {
            // Validate file type
            if (!attachment.name.endsWith('.json')) {
                return interaction.editReply({
                    content: 'Please upload a valid JSON file',
                    ephemeral: true
                });
            }

            // Check size limit (1MB)
            if (attachment.size > 1024 * 1024) {
                return interaction.editReply({
                    content: 'File size too large (max 1MB)',
                    ephemeral: true
                });
            }

            // Fetch and parse the JSON file
            const response = await fetch(attachment.url);
            const jsonData = await response.json();

            // Validate playlist structure
            if (!jsonData.name || !Array.isArray(jsonData.songs)) {
                return interaction.editReply({
                    content: 'Invalid playlist format',
                    ephemeral: true
                });
            }

            // Check if playlist name already exists
            const existingPlaylist = await Playlist.findOne({ userId, name: newPlaylistName });
            if (existingPlaylist) {
                return interaction.editReply({
                    content: `You already have a playlist named "${newPlaylistName}"!`,
                    ephemeral: true
                });
            }

            // Create new playlist with imported songs
            const importedSongs = jsonData.songs.map(song => ({
                title: song.title,
                url: song.url,
                path: '', // Will be populated when played
                duration: song.duration || 0,
                addedAt: new Date()
            }));

            const newPlaylist = new Playlist({
                userId,
                guildId,
                name: newPlaylistName,
                description: jsonData.description || `Imported from ${jsonData.name}`,
                songs: importedSongs,
                isPublic: jsonData.isPublic || false
            });

            await newPlaylist.save();

            await interaction.editReply(
                `✅ Successfully imported playlist **${newPlaylistName}** with ` +
                `${importedSongs.length} songs!`
            );

        } catch (error) {
            console.error(error);
            await interaction.editReply({ 
                content: 'Failed to import playlist. Make sure the file is valid JSON with the correct format.', 
                ephemeral: true 
            });
        }
    }
};
