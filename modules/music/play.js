const { SlashCommandBuilder } = require('discord.js');
const path = require('path');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType, NoSubscriberBehavior } = require('@discordjs/voice');
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
            // Clean up if no more songs
            if (queue.connection) {
                queue.connection.destroy();
                queue.connection = null;
            }
            return;
        }

        queue.playing = true;
        const currentSong = queue.songs[0];

        // Clean up previous player events to avoid memory leaks
        if (queue.player) {
            queue.player.removeAllListeners();
        }

        // Create or reuse voice connection
        if (!queue.connection) {
            try {
                queue.connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: voiceChannel.guild.id,
                    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                });
                
                // Handle potential voice connection errors
                queue.connection.on('error', error => {
                    console.error('Voice connection error:', error);
                    interaction.channel.send('❌ Voice connection error').catch(console.error);
                });
                
                queue.player = createAudioPlayer({
                    behaviors: {
                        noSubscriber: NoSubscriberBehavior.Pause,
                    },
                });
                queue.connection.subscribe(queue.player);
            } catch (error) {
                console.error('Voice connection failed:', error);
                throw error;
            }
        }

        // Create audio resource and play
        try {
            const resource = createAudioResource(currentSong.path, {
                inputType: StreamType.Arbitrary,
                inlineVolume: true
            });
            
            queue.player.play(resource);

            // Set up event handlers
            queue.player.on('error', error => {
                console.error('Player error:', error);
                interaction.channel.send(`❌ Error playing: ${currentSong.title}`).catch(console.error);
                // Attempt to play next song on error
                queue.songs.shift();
                this.playNextSong(interaction, queue, voiceChannel);
            });

            queue.player.on(AudioPlayerStatus.Idle, () => {
                queue.songs.shift();
                this.playNextSong(interaction, queue, voiceChannel);
            });

            // Send now playing message
            await interaction.channel.send(`🎶 Now playing: **${currentSong.title}**`).catch(console.error);

        } catch (error) {
            console.error('Playback failed:', error);
            queue.songs.shift();
            this.playNextSong(interaction, queue, voiceChannel);
        }

    } catch (error) {
        console.error('Playback error:', error);
        queue.playing = false;
        
        // Clean up resources
        if (queue.connection) {
            queue.connection.destroy();
            queue.connection = null;
        }
        if (queue.player) {
            queue.player.removeAllListeners();
            queue.player.stop();
        }
        
        interaction.client.queues.delete(interaction.guild.id);
        
        await interaction.channel.send('❌ Error playing the song').catch(console.error);
    }
}
};
