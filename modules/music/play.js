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
        // Check if queue is empty
        if (queue.songs.length === 0) {
            queue.playing = false;
            await this.cleanupQueue(queue);
            return;
        }

        queue.playing = true;
        const currentSong = queue.songs[0];

        // Clean up previous player events
        if (queue.player) {
            queue.player.removeAllListeners();
        }

        // Connection handling with retry logic
        try {
            if (!queue.connection || queue.connection.state.status === 'destroyed') {
                queue.connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: voiceChannel.guild.id,
                    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                });

                // Enhanced connection error handling
                queue.connection.on('error', error => {
                    console.error('Voice connection error:', error);
                    interaction.channel.send('❌ Voice connection error, attempting to reconnect...').catch(console.error);
                    this.handleConnectionError(interaction, queue, voiceChannel);
                });

                // Handle disconnection
                queue.connection.on('disconnect', () => {
                    console.log('Voice connection disconnected');
                    this.handleConnectionError(interaction, queue, voiceChannel);
                });

                queue.player = createAudioPlayer({
                    behaviors: {
                        noSubscriber: NoSubscriberBehavior.Pause,
                    },
                });

                // Subscribe with error handling
                try {
                    queue.connection.subscribe(queue.player);
                } catch (subscribeError) {
                    console.error('Subscription error:', subscribeError);
                    throw subscribeError;
                }
            }
        } catch (connectionError) {
            console.error('Voice connection failed:', connectionError);
            await interaction.channel.send('❌ Failed to connect to voice channel, retrying...').catch(console.error);
            setTimeout(() => this.playNextSong(interaction, queue, voiceChannel), 5000);
            return;
        }

        // Audio resource creation and playback
        try {
            const resource = createAudioResource(currentSong.path, {
                inputType: StreamType.Arbitrary,
                inlineVolume: true,
                metadata: {
                    title: currentSong.title,
                    guildId: interaction.guild.id
                }
            });

            // Play with timeout for potential hangs
            const playTimeout = setTimeout(() => {
                if (queue.player?.state.status === 'playing') return;
                console.error('Playback timeout');
                throw new Error('Playback timeout');
            }, 10000);

            queue.player.play(resource);
            clearTimeout(playTimeout);

            // Player event handlers
            queue.player.on('error', error => {
                console.error('Player error:', error);
                clearTimeout(playTimeout);
                interaction.channel.send(`❌ Error playing: ${currentSong.title}, skipping...`).catch(console.error);
                queue.songs.shift();
                setTimeout(() => this.playNextSong(interaction, queue, voiceChannel), 1000);
            });

            queue.player.on(AudioPlayerStatus.Idle, () => {
                clearTimeout(playTimeout);
                queue.songs.shift();
                setTimeout(() => this.playNextSong(interaction, queue, voiceChannel), 500);
            });

            // Status monitoring
            this.monitorPlaybackStatus(queue, interaction);

            // Send now playing message
            await interaction.channel.send(`🎶 Now playing: **${currentSong.title}**`).catch(console.error);

        } catch (playbackError) {
            console.error('Playback failed:', playbackError);
            queue.songs.shift();
            setTimeout(() => this.playNextSong(interaction, queue, voiceChannel), 1000);
        }

    } catch (error) {
        console.error('Playback system error:', error);
        await this.handleCriticalError(interaction, queue);
    }
}

// Helper methods
async handleConnectionError(interaction, queue, voiceChannel) {
    console.log('Handling connection error...');
    await this.cleanupQueue(queue);
    setTimeout(() => {
        if (voiceChannel.members.has(interaction.client.user.id)) {
            this.playNextSong(interaction, queue, voiceChannel);
        }
    }, 5000);
}

async handleCriticalError(interaction, queue) {
    queue.playing = false;
    await this.cleanupQueue(queue);
    interaction.client.queues.delete(interaction.guild.id);
    await interaction.channel.send('❌ Music playback stopped due to an error').catch(console.error);
}

async cleanupQueue(queue) {
    try {
        if (queue.player) {
            queue.player.removeAllListeners();
            queue.player.stop();
        }
        if (queue.connection) {
            queue.connection.removeAllListeners();
            if (queue.connection.state.status !== 'destroyed') {
                queue.connection.destroy();
            }
            queue.connection = null;
        }
    } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError);
    }
}

monitorPlaybackStatus(queue, interaction) {
    const checkInterval = setInterval(() => {
        if (!queue.playing || !queue.connection) {
            clearInterval(checkInterval);
            return;
        }

        // Check if connection is still valid
        if (queue.connection.state.status === 'destroyed' || 
            queue.connection.state.status === 'disconnected') {
            console.log('Connection status check failed:', queue.connection.state.status);
            clearInterval(checkInterval);
            this.handleConnectionError(interaction, queue, queue.connection.joinConfig.channelId);
            return;
        }

        // Check if player is stuck
        if (queue.player.state.status === 'playing') {
            const lastStateChange = Date.now() - queue.player.state.resource.playbackDuration;
            if (lastStateChange > 30000) { // 30 seconds without progress
                console.log('Player seems stuck, restarting...');
                clearInterval(checkInterval);
                this.handleConnectionError(interaction, queue, queue.connection.joinConfig.channelId);
            }
        }
    }, 10000); // Check every 10 seconds
}};
