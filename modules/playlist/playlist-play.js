
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
                // Clean up downloaded files
                queue.tempFiles.forEach(file => {
                    try {
                        fs.unlinkSync(file);
                    } catch (err) {
                        console.error('Error cleaning up file:', err);
                    }
                });
                await interaction.channel.send('🎶 Queue finished!');
                return;
            }

            queue.playing = true;
            const currentSong = queue.songs[0];
            queue.currentSong = currentSong;

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
            await interaction.channel.send(`🎶 Now playing: **${currentSong.title}**`);

            // Set up event handlers
            queue.player.on('error', error => {
                console.error('Player error:', error);
                interaction.channel.send(`❌ Error playing: ${currentSong.title}`).catch(console.error);
                // Skip to next song on error
                queue.songs.shift();
                this.playNextSong(interaction, queue, voiceChannel);
            });

            queue.player.on('idle', () => {
                // Clean up the played file if it was a temporary download
                if (queue.tempFiles.includes(currentSong.path)) {
                    try {
                        fs.unlinkSync(currentSong.path);
                        queue.tempFiles = queue.tempFiles.filter(f => f !== currentSong.path);
                    } catch (err) {
                        console.error('Error cleaning up file:', err);
                    }
                }
                
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
            // Clean up any downloaded files
            queue.tempFiles.forEach(file => {
                try {
                    fs.unlinkSync(file);
                } catch (err) {
                    console.error('Error cleaning up file:', err);
                }
            });
            
            interaction.client.queues.delete(interaction.guild.id);
            await interaction.channel.send('❌ Error playing the playlist').catch(console.error);
        }
    }
};
