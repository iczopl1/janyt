const { SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource } = require('@discordjs/voice');
const path = require('path');
const downloadYouTubeVideo = require('../../utils/yt-download');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song from YouTube')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song name or YouTube URL')
                .setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply();
        
        try {
            // Validate voice channel
            const voiceChannel = interaction.member.voice.channel;
            if (!voiceChannel) {
                return interaction.editReply('❗ You must be in a voice channel!');
            }

            // Initialize queue system
            const guildId = interaction.guild.id;
            if (!interaction.client.queues) {
                interaction.client.queues = new Map();
            }
            
            if (!interaction.client.queues.has(guildId)) {
                interaction.client.queues.set(guildId, {
                    songs: [],
                    connection: null,
                    player: null,
                    playing: false
                });
            }

            const queue = interaction.client.queues.get(guildId);
            const query = interaction.options.getString('query');

            // Check database connection
            if (!interaction.client.db) {
                throw new Error('Database not connected');
            }

            const collection = interaction.client.db.collection("downloaded_songs");
            let songData = null;

            // Search database (try URL first, then title)
            if (query.includes('youtube.com') || query.includes('youtu.be')) {
                songData = await collection.findOne({ url: query });
            }
            
            if (!songData) {
                songData = await collection.findOne({ 
                    title: { $regex: new RegExp(query, 'i') } 
                });
            }

            if (songData) {
                // Song found in database
                queue.songs.push({
                    title: songData.title,
                    url: songData.url,
                    path: songData.path
                });
                
                await interaction.editReply(`🎵 Queued: **${songData.title}**`);
            } else {
                // Download from YouTube
                const downloadResult = await downloadYouTubeVideo(query, interaction.client.db);
                queue.songs.push({
                    title: downloadResult.title,
                    url: downloadResult.url,
                    path: downloadResult.filepath
                });
                await interaction.editReply(`🎵 Queued: **${downloadResult.title}**`);
            }

            // Start playback if not already playing
            if (!queue.playing) {
                await this.playNextSong(interaction, queue, voiceChannel);
            }

        } catch (error) {
            console.error('Play command error:', error);
            await interaction.editReply(`❌ Error: ${error.message}`);
        }
    },

    async playNextSong(interaction, queue, voiceChannel) {
        try {
            if (queue.songs.length === 0) {
                queue.playing = false;
                return;
            }

            queue.playing = true;
            const currentSong = queue.songs[0];

            // Create or reuse voice connection
            if (!queue.connection) {
                queue.connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: voiceChannel.guild.id,
                    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                });
                queue.player = createAudioPlayer();
                queue.connection.subscribe(queue.player);
            }

            // Create audio resource and play
            const resource = createAudioResource(currentSong.path);
            queue.player.play(resource);

            // Set up event handlers
            queue.player.on('error', error => {
                console.error('Player error:', error);
                interaction.channel.send(`❌ Error playing: ${currentSong.title}`).catch(console.error);
            });

            queue.player.on('idle', () => {
                queue.songs.shift();
                this.playNextSong(interaction, queue, voiceChannel);
            });

        } catch (error) {
            console.error('Playback error:', error);
            queue.playing = false;
            
            // Clean up resources
            if (queue.connection) {
                queue.connection.destroy();
            }
            interaction.client.queues.delete(interaction.guild.id);
            
            await interaction.channel.send('❌ Error playing the song').catch(console.error);
        }
    }
};
