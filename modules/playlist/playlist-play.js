
const { SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource } = require('@discordjs/voice');
const Playlist = require('../../models/Playlist');
const  downloadYouTubeVideo  = require('../../utils/yt-download');
const fs = require('fs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playlist-play')
        .setDescription('Play a playlist')
        .addStringOption(option =>
            option.setName('playlist')
                .setDescription('Name of the playlist to play')
                .setRequired(true)),
    
    async execute(interaction) {
        const playlistName = interaction.options.getString('name');
        const userId = interaction.user.id;
        const guildId = interaction.guild.id;
        const voiceChannel = interaction.member.voice.channel;
        console.log(playlistName)
        if (!playlistName) {
            return interaction.reply({
                content: '❌ Please provide a valid playlist name!',
                flags: 'Ephemeral'
            });
        }

        if (!voiceChannel) {
            return interaction.reply({ 
                content: '❗ You must be in a voice channel!', 
                flags: 'Ephemeral'
            });
        }

        await interaction.deferReply();

        try {
            // Check database connection
            if (!interaction.client.db) {
                throw new Error('Database not connected');
            }

            // Find the playlist with case-insensitive search
            const playlist = await Playlist.findOne({
                userId,
                name: { $regex: new RegExp(`^${playlistName}$`, 'i') }
            });

            if (!playlist) {
                return interaction.editReply({
                    content: `❌ Playlist "${playlistName}" not found!`,
                    flags: 'Ephemeral'
                });
            }

            if (!playlist.songs || playlist.songs.length === 0) {
                return interaction.editReply({
                    content: `❌ Playlist "${playlist.name}" is empty!`,
                    flags: 'Ephemeral'
                });
            }

            // Initialize queue system
            if (!interaction.client.queues) {
                interaction.client.queues = new Map();
            }

            if (!interaction.client.queues.get(guildId)) {
                interaction.client.queues.set(guildId, {
                    songs: [],
                    connection: null,
                    player: null,
                    playing: false,
                    currentSong: null,
                    tempFiles: []
                });
            }

            const queue = interaction.client.queues.get(guildId);
            const collection = interaction.client.db.collection("downloaded_songs");
            const invalidSongs = [];

            // Process each song in the playlist
            for (const song of playlist.songs) {
                try {
                    // Skip if already in queue
                    if (queue.songs.some(s => s.url === song.url)) continue;

                    let songData = await collection.findOne({ url: song.url });

                    if (!songData && song.path === 'youtube') {
                        try {
                            const downloadResult = await downloadYouTubeVideo(song.url);
                            songData = {
                                title: downloadResult.title,
                                url: song.url,
                                path: downloadResult.filepath,
                            };
                            
                            // Update the playlist with downloaded info
                            song.title = downloadResult.title;
                            song.path = downloadResult.filepath;
                            await playlist.save();
                          
                        } catch (downloadError) {
                            console.error(`Failed to download ${song.url}:`, downloadError);
                            invalidSongs.push(song.title || song.url);
                            continue;
                        }
                    }

                    if (songData) {
                        queue.songs.push({
                            title: songData.title,
                            url: songData.url,
                            path: songData.path,
                            duration: songData.duration
                        });
                    }
                    if (!queue.playing) {
                    await this.playNextSong(interaction, queue, voiceChannel);
                    }
                } catch (error) {
                    console.error(`Error processing song ${song.url}:`, error);
                    invalidSongs.push(song.title || song.url);
                }
            }

            // Handle invalid songs
            if (invalidSongs.length > 0) {
                await interaction.followUp({
                    content: `⚠️ Couldn't process ${invalidSongs.length} songs:\n` +
                            invalidSongs.slice(0, 5).join('\n') +
                            (invalidSongs.length > 5 ? `\n...and ${invalidSongs.length - 5} more` : ''),
                    flags: 'Ephemeral'
                });
            }

            if (queue.songs.length === 0) {
                return interaction.editReply({
                    content: '❌ No valid songs could be played from this playlist!',
                    flags: 'Ephemeral'
                });
            }

            await interaction.editReply(`🎵 Added ${queue.songs.length} songs from **${playlist.name}** to queue`);

            if (!queue.playing) {
                await this.playNextSong(interaction, queue, voiceChannel);
            }
        } catch (error) {
            console.error('Error in playlist-play:', error);
            await interaction.editReply({
                content: '❌ An error occurred while processing your playlist',
                flags: 'Ephemeral'
            });
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
}
};
