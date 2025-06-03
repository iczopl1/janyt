import os
import json
import asyncio
import discord
from collections import deque
from discord.ext import commands

import yt_dlp as youtube_dl

# Update the ytdl format options
ytdl_format_options = {
    "format": "bestaudio/best",
    "outtmpl": "./YTmusic/%(title)s.%(ext)s",  # Save in YTmusic folder with original title
    "restrictfilenames": True,
    "noplaylist": True,
    "nocheckcertificate": True,
    "ignoreerrors": False,
    "logtostderr": False,
    "quiet": True,
    "no_warnings": True,
    "default_search": "auto",
    "source_address": "0.0.0.0",
    "extractaudio": True,
    "audioformat": "mp3",
    # Add these new options for better compatibility
    "extractor_args": {"youtube": {"skip": ["dash", "hls"]}},
    "postprocessors": [
        {
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }
    ],
    "ffmpeg_location": "/usr/bin/ffmpeg",  # Update this path if needed
}

# Update the playlist download options
playlist_ydl_opts = {
    "extract_flat": True,
    "quiet": True,
    "no_warnings": True,
    "extractor_args": {"youtube": {"skip": ["dash", "hls"]}},
}


class YTDLSource(discord.PCMVolumeTransformer):
    def __init__(self, source, *, data, volume=0.5):
        super().__init__(source, volume)
        self.data = data
        self.title = data.get("title")
        self.url = data.get("url")
        self.duration = data.get("duration")
        self.thumbnail = data.get("thumbnail")


os.makedirs("./data", exist_ok=True)
os.makedirs("./YTmusic", exist_ok=True)

QUEUE_FILE = "./data/queue.json"
LIBRARY_FILE = "./data/library.json"


def load_queue():
    try:
        if not os.path.exists(QUEUE_FILE):
            with open(QUEUE_FILE, "w") as f:
                json.dump([], f)
            return deque()

        with open(QUEUE_FILE, "r") as f:
            return deque(json.load(f))
    except (FileNotFoundError, json.JSONDecodeError):
        # If file is corrupted, reset it
        with open(QUEUE_FILE, "w") as f:
            json.dump([], f)
        return deque()


def load_library():
    try:
        if not os.path.exists(LIBRARY_FILE):
            with open(LIBRARY_FILE, "w") as f:
                json.dump({}, f)
            return {}

        with open(LIBRARY_FILE, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        # If file is corrupted, reset it
        with open(LIBRARY_FILE, "w") as f:
            json.dump({}, f)
        return {}


class Music(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.ytdl = youtube_dl.YoutubeDL(ytdl_format_options)

        # Initialize queue and library
        bot.song_queue = load_queue()
        bot.song_library = load_library()
        bot.current_song = None
        bot.is_playing = False

    # Paths for data files
    def save_queue(self):
        with open(QUEUE_FILE, "w") as f:
            json.dump(list(self.bot.song_queue), f)

    def save_library(self):
        with open(LIBRARY_FILE, "w") as f:
            json.dump(self.bot.song_library, f)

    async def download_song(self, url, retries=10):
        for attempt in range(retries):
            try:
                if url in self.bot.song_library:
                    cached_entry = self.bot.song_library[url]
                    cached_path = cached_entry.get("filepath", "")

                    # Verify the cached file exists and is valid
                    if os.path.exists(cached_path):
                        # Additional verification - check file size
                        if os.path.getsize(cached_path) > 1024:  # At least 1KB
                            print(
                                f"Using cached version of {cached_entry.get('title', 'unknown')}"
                            )
                            return cached_path
                        else:
                            print(
                                f"Removing invalid cached file (too small): {cached_path}"
                            )
                            os.remove(cached_path)
                            del self.bot.song_library[url]
                # start download
                data = await self.bot.loop.run_in_executor(
                    None, lambda: self.ytdl.extract_info(url, download=True)
                )

                if not data:
                    raise Exception("No data received from YouTube")

                if "entries" in data:  # Playlist
                    data = data["entries"][0]
                    if not data:
                        raise Exception("No playlist data received")

                filename = self.ytdl.prepare_filename(data)
                base, ext = os.path.splitext(filename)
                mp3_file = base + ".mp3"

                if not os.path.exists(mp3_file):
                    raise Exception("Downloaded file not found")

                # Add to library
                self.bot.song_library[url] = {
                    "title": data.get("title", "Unknown Title"),
                    "filepath": mp3_file,
                    "duration": data.get("duration", 0),
                    "thumbnail": data.get("thumbnail", ""),
                }

                self.save_library()
                return mp3_file
            except Exception as e:
                if attempt == retries - 1:
                    print(f"Final attempt failed for {url}: {e}")
                    raise
                print(f"Attempt {attempt + 1} failed for {url}, retrying...")
                await asyncio.sleep(2)

    async def play_next(self, ctx):
        if len(self.bot.song_queue) > 0:
            self.bot.is_playing = True
            url, user_id = self.bot.song_queue.popleft()
            self.save_queue()

            try:
                requester = ctx.guild.get_member(user_id)
                requester_mention = (
                    requester.mention if requester else f"User {user_id}"
                )

                # Assume file exists and is in song_library
                song_data = self.bot.song_library[url]
                filepath = song_data["filepath"]

                # Create audio source with proper FFmpeg options
                source = discord.FFmpegPCMAudio(
                    executable="ffmpeg",
                    source=filepath,
                    options="-vn -b:a 128k -ar 48000 -ac 2",
                )

                self.bot.current_song = YTDLSource(source, data=song_data)

                if not self.bot.current_song or not hasattr(
                    self.bot.current_song, "title"
                ):
                    raise Exception("Invalid song data received")

                ctx.voice_client.play(
                    self.bot.current_song,
                    after=lambda e: (
                        asyncio.run_coroutine_threadsafe(
                            self.play_next(ctx), self.bot.loop
                        )
                        if e is None
                        else print(f"Player error: {e}")
                    ),
                )

                # Create embed
                embed = discord.Embed(
                    title="Now Playing",
                    description=f"[{self.bot.current_song.title}]({url})",
                    color=discord.Color.green(),
                )

                if (
                    hasattr(self.bot.current_song, "thumbnail")
                    and self.bot.current_song.thumbnail
                ):
                    embed.set_thumbnail(url=self.bot.current_song.thumbnail)

                if (
                    hasattr(self.bot.current_song, "duration")
                    and self.bot.current_song.duration
                ):
                    minutes, seconds = divmod(self.bot.current_song.duration, 60)
                    embed.add_field(
                        name="Duration", value=f"{minutes}:{seconds:02}", inline=True
                    )

                embed.add_field(
                    name="Requested by", value=requester_mention, inline=True
                )
                await ctx.send(embed=embed)

            except Exception as e:
                print(f"Error playing song: {e}")
                self.bot.is_playing = False
                await ctx.send(f"Error playing song: {str(e)}")
                await self.play_next(ctx)
        else:
            self.bot.is_playing = False
            self.bot.current_song = None
            await ctx.send("Queue is empty!")

    @commands.command(name="play", help="Plays a song from YouTube")
    async def play(self, ctx, *, query):
        try:
            if not ctx.author.voice:
                return await ctx.send("You are not connected to a voice channel!")

            voice_channel = ctx.author.voice.channel

            if ctx.voice_client is None:
                await voice_channel.connect()
            elif ctx.voice_client.channel != voice_channel:
                await ctx.voice_client.move_to(voice_channel)

            try:
                await ctx.send("Start looking")
                if query.startswith("http"):
                    url = query
                else:
                    search_query = f"ytsearch:{query}"
                    data = await self.bot.loop.run_in_executor(
                        None,
                        lambda: self.ytdl.extract_info(search_query, download=False),
                    )
                    if not data or "entries" not in data or not data["entries"]:
                        return await ctx.send("No results found!")
                    url = data["entries"][0]["webpage_url"]

                # Show "downloading" message
                msg = await ctx.send("⏳ Downloading song...")

                filepath = await self.download_song(url)
                if not filepath:
                    return await ctx.send("Failed to download the song!")

                await msg.delete()  # Remove downloading message
                self.bot.song_queue.append((url, ctx.author.id))
                self.save_queue()

                if not self.bot.is_playing:
                    await self.play_next(ctx)
                else:
                    title = self.bot.song_library[url]["title"]
                    await ctx.send(f"Added to queue: **{title}**")
            except Exception as e:
                await ctx.send(f"Error processing song: {str(e)}")
                print(f"Error in play command: {e}")
        except Exception as e:
            print(f"Unexpected error in play command: {e}")

    @commands.command(name="play_playlist", help="Plays a Playlist from YouTube")
    async def play_playlist(self, ctx, url):
        if not ctx.author.voice:
            await ctx.send("You are not connected to a voice channel!")
            return

        voice_channel = ctx.author.voice.channel

        if ctx.voice_client is None:
            await voice_channel.connect()
        elif ctx.voice_client.channel != voice_channel:
            await ctx.voice_client.move_to(voice_channel)

        try:
            msg = await ctx.send("⏳ Processing playlist...")

            ydl_opts = {
                "quiet": True,
                "no_warnings": True,
                "extract_flat": True,
            }

            with youtube_dl.YoutubeDL(ydl_opts) as ydl:
                data = ydl.extract_info(url, download=False)

            if "entries" not in data or not data["entries"]:
                await ctx.send("This doesn't appear to be a valid playlist.")
                return

            count = 0
            for entry in data["entries"]:
                song_url = f"https://youtube.com/watch?v={entry['id']}"
                try:
                    filepath = await self.download_song(song_url)
                    if filepath:
                        self.bot.song_queue.append((song_url, ctx.author.id))
                        count += 1
                        self.save_queue()
                        if not self.bot.is_playing:
                            await self.play_next(ctx)

                    else:
                        await ctx.send(f"⚠️ Failed to download: {song_url}")
                except Exception as e:
                    await ctx.send(f"⚠️ Error downloading a song: {e}")

            self.save_queue()
            await msg.delete()
            await ctx.send(f"✅ Added {count} songs from playlist to queue!")

            if not self.bot.is_playing:
                await self.play_next(ctx)

        except Exception as e:
            await ctx.send(f"Error processing playlist: {e}")
            print(f"Error in play_playlist: {e}")

    @commands.command(name="queue", help="Shows the current queue")
    async def show_queue(self, ctx):
        if len(self.bot.song_queue) == 0 and not self.bot.is_playing:
            await ctx.send("Queue is empty!")
            return

        embed = discord.Embed(title="Music Queue", color=discord.Color.blue())

        if self.bot.is_playing and self.bot.current_song:
            embed.add_field(
                name="Now Playing",
                value=f"[{self.bot.current_song.title}]({self.bot.current_song.url})",
                inline=False,
            )

        if len(self.bot.song_queue) > 0:
            queue_list = []
            for i, (url, user_id) in enumerate(self.bot.song_queue, 1):
                member = ctx.guild.get_member(user_id)
                mention = member.mention if member else f"User {user_id}"
                title = (
                    self.bot.song_library.get(url, {}).get("title", "Unknown Title")
                    if url in self.bot.song_library
                    else "Loading..."
                )
                queue_list.append(f"{i}. [{title}]({url}) (requested by {mention})")

            embed.description = "\n".join(queue_list[:10])
            if len(self.bot.song_queue) > 10:
                embed.set_footer(
                    text=f"And {len(self.bot.song_queue) - 10} more songs..."
                )
        else:
            embed.description = "No songs in queue"

        await ctx.send(embed=embed)

    @commands.command(name="skip", help="Skips the current song")
    async def skip(self, ctx):
        if not self.bot.is_playing:
            await ctx.send("No song is currently playing!")
            return

        if ctx.voice_client:
            ctx.voice_client.stop()
            await ctx.send("⏭️ Skipped current song!")

    @commands.command(name="stop", help="Stops the music and clears the queue")
    async def stop(self, ctx):
        if not self.bot.is_playing:
            await ctx.send("No music is playing!")
            return

        if ctx.voice_client:
            self.bot.song_queue.clear()
            self.save_queue()
            ctx.voice_client.stop()
            self.bot.is_playing = False
            self.bot.current_song = None
            await ctx.send("⏹️ Stopped playback and cleared queue!")

    @commands.command(name="pause", help="Pauses the current song")
    async def pause(self, ctx):
        if not self.bot.is_playing:
            await ctx.send("No song is currently playing!")
            return

        if ctx.voice_client and ctx.voice_client.is_playing():
            ctx.voice_client.pause()
            await ctx.send("⏸️ Paused playback!")

    @commands.command(name="resume", help="Resumes the current song")
    async def resume(self, ctx):
        if not self.bot.is_playing:
            await ctx.send("No song is paused!")
            return

        if ctx.voice_client and ctx.voice_client.is_paused():
            ctx.voice_client.resume()
            await ctx.send("▶️ Resumed playback!")

    @commands.command(
        name="nowplaying", aliases=["np"], help="Shows the currently playing song"
    )
    async def now_playing(self, ctx):
        if not self.bot.current_song:
            await ctx.send("No song is currently playing!")
            return

        embed = discord.Embed(
            title="Now Playing",
            description=f"[{self.bot.current_song.title}]({self.bot.current_song.url})",
            color=discord.Color.green(),
        )
        if (
            hasattr(self.bot.current_song, "thumbnail")
            and self.bot.current_song.thumbnail
        ):
            embed.set_thumbnail(url=self.bot.current_song.thumbnail)
        if (
            hasattr(self.bot.current_song, "duration")
            and self.bot.current_song.duration
        ):
            embed.add_field(
                name="Duration",
                value=f"{self.bot.current_song.duration // 60}:{self.bot.current_song.duration % 60:02}",
            )
        await ctx.send(embed=embed)


async def setup(bot):
    await bot.add_cog(Music(bot))
