
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
