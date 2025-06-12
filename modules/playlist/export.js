const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const Playlist = require('../../models/Playlist');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playlist-export')
        .setDescription('Export a playlist to a shareable file')
        .addStringOption(option =>
            option.setName('playlist')
                .setDescription('Name of the playlist to export')
                .setRequired(true)),
    
    async execute(interaction) {
        const playlistName = interaction.options.getString('playlist');
        const userId = interaction.user.id;

        await interaction.deferReply();

        try {
            const playlist = await Playlist.findOne({ userId, name: playlistName });
            if (!playlist) {
                return interaction.editReply({ 
                    content: `Playlist "${playlistName}" not found!`, 
                    ephemeral: true 
                });
            }

            // Create export data structure
            const exportData = {
                name: playlist.name,
                description: playlist.description,
                isPublic: playlist.isPublic,
                songs: playlist.songs.map(song => ({
                    title: song.title,
                    url: song.url,
                    duration: song.duration
                })),
                exportedAt: new Date().toISOString(),
                exportedBy: interaction.user.tag,
                version: 1.0
            };

            // Convert to JSON and create attachment
            const json = JSON.stringify(exportData, null, 2);
            const buffer = Buffer.from(json, 'utf-8');
            const attachment = new AttachmentBuilder(buffer)
                .setName(`${playlist.name.replace(/[^a-z0-9]/gi, '_')}_playlist.json`)
                .setDescription(`Exported playlist: ${playlist.name}`);

            await interaction.editReply({
                content: `Here's your exported playlist **${playlist.name}**`,
                files: [attachment]
            });

        } catch (error) {
            console.error(error);
            await interaction.editReply({ 
                content: 'Failed to export playlist', 
                ephemeral: true 
            });
        }
    }
};
