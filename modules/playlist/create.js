const { SlashCommandBuilder } = require('discord.js');
const Playlist = require('../../models/Playlist');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playlist-create')
        .setDescription('Create a new playlist')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Name of your playlist')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('description')
                .setDescription('Description of your playlist')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('public')
                .setDescription('Make playlist public')
                .setRequired(false)),
    
    async execute(interaction) {
        const name = interaction.options.getString('name');
        const description = interaction.options.getString('description') || '';
        const isPublic = interaction.options.getBoolean('public') || false;
        const userId = interaction.user.id;
        const guildId = interaction.guild.id;

        try {
            // Check if playlist already exists
            const existingPlaylist = await Playlist.findOne({ userId, name });
            if (existingPlaylist) {
                return interaction.reply({ 
                    content: `You already have a playlist named "${name}"!`, 
                    ephemeral: true 
                });
            }

            // Create new playlist
            const newPlaylist = new Playlist({
                userId,
                guildId,
                name,
                description,
                isPublic,
                songs: []
            });

            await newPlaylist.save();
            await interaction.reply(`✅ Created playlist **${name}**!`);
        } catch (error) {
            console.error(error);
            await interaction.reply({ 
                content: 'Failed to create playlist', 
                ephemeral: true 
            });
        }
    }
};
