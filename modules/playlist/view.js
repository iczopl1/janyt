const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Playlist = require('../../models/Playlist');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playlist-view')
        .setDescription('View songs in a playlist')
        .addStringOption(option =>
            option.setName('playlist')
                .setDescription('Name of the playlist')
                .setRequired(true)),
    
    async execute(interaction) {
        const playlistName = interaction.options.getString('playlist');
        const userId = interaction.user.id;

        try {
            const playlist = await Playlist.findOne({ userId, name: playlistName });
            if (!playlist) {
                return interaction.reply({ 
                    content: `Playlist "${playlistName}" not found!`, 
                    ephemeral: true 
                });
            }

            const embed = new EmbedBuilder()
                .setTitle(playlist.name)
                .setDescription(playlist.description || 'No description')
                .setColor('#0099ff')
                .setFooter({ text: `${playlist.songs.length} songs` });

            if (playlist.songs.length > 0) {
                const songsList = playlist.songs.slice(0, 10).map((song, index) => 
                    `${index + 1}. [${song.title}](${song.url}) (${formatDuration(song.duration)})`
                ).join('\n');

                embed.addFields({
                    name: 'Songs',
                    value: songsList
                });

                if (playlist.songs.length > 10) {
                    embed.addFields({
                        name: '\u200b',
                        value: `...and ${playlist.songs.length - 10} more songs`
                    });
                }
            } else {
                embed.addFields({
                    name: 'Songs',
                    value: 'This playlist is empty'
                });
            }

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await interaction.reply({ 
                content: 'Failed to view playlist', 
                ephemeral: true 
            });
        }
    }
};

function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
}
