import discord
from discord.ext import commands
import yt_dlp as youtube_dl
import asyncio
import os
import json
from collections import deque
from conf import conf2


# Bot configuration
TOKEN = conf2.TOKEN
PREFIX = "/"
SONGS_DIR = "songs"
QUEUE_FILE = "song_queue.json"
LIBRARY_FILE = "song_library.json"

# Ensure songs directory exists
os.makedirs(SONGS_DIR, exist_ok=True)

# Initialize bot
intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix=PREFIX, intents=intents)

# Global variables
song_queue = deque()
current_song = None
is_playing = False
song_library = {}

# Load existing library if available
if os.path.exists(LIBRARY_FILE):
    with open(LIBRARY_FILE, "r") as f:
        song_library = json.load(f)

# Load queue if available
# In the initialization part (replace the queue loading code):
if os.path.exists(QUEUE_FILE):
    with open(QUEUE_FILE, "r") as f:
        saved_queue = json.load(f)
        song_queue = deque(saved_queue)  # Just load the (url, user_id) pairs directly

# YTDL options
ytdl_format_options = {
    "format": "bestaudio/best",
    "outtmpl": os.path.join(SONGS_DIR, "%(title)s.%(ext)s"),
    "restrictfilenames": True,
    "noplaylist": True,
    "nocheckcertificate": True,
    "ignoreerrors": False,
    "logtostderr": False,
    "quiet": True,
    "no_warnings": True,
    "default_search": "auto",
    "source_address": "0.0.0.0",
    "postprocessors": [
        {
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }
    ],
}

ffmpeg_options = {"options": "-vn"}

ytdl = youtube_dl.YoutubeDL(ytdl_format_options)


class YTDLSource(discord.PCMVolumeTransformer):
    def __init__(self, source, *, data, volume=0.5):
        super().__init__(source, volume)
        self.data = data
        self.title = data.get("title")
        self.url = data.get("url")
        self.duration = data.get("duration")
        self.thumbnail = data.get("thumbnail")

    @classmethod
    async def from_url(cls, url, *, loop=None, stream=False):
        loop = loop or asyncio.get_event_loop()
        data = await loop.run_in_executor(
            None, lambda: ytdl.extract_info(url, download=not stream)
        )

        if "entries" in data:
            data = data["entries"][0]

        filename = data["url"] if stream else ytdl.prepare_filename(data)
        return cls(discord.FFmpegPCMAudio(filename, **ffmpeg_options), data=data)


# Update the save_queue function:
def save_queue():
    # The queue already contains (url, user_id) pairs
    with open(QUEUE_FILE, "w") as f:
        json.dump(list(song_queue), f)


def save_library():
    with open(LIBRARY_FILE, "w") as f:
        json.dump(song_library, f)


async def download_song(url):
    try:
        # Check if song already exists in library with valid file
        if url in song_library:
            filepath = song_library[url]["filepath"]
            if os.path.exists(filepath):
                return filepath

        # Download the song
        data = await bot.loop.run_in_executor(
            None, lambda: ytdl.extract_info(url, download=True)
        )

        if not data:
            raise Exception("No data received from YouTube")

        if "entries" in data:  # Playlist
            data = data["entries"][0]
            if not data:
                raise Exception("No playlist data received")

        filename = ytdl.prepare_filename(data)
        base, ext = os.path.splitext(filename)
        mp3_file = base + ".mp3"

        # Verify the file was actually created
        if not os.path.exists(mp3_file):
            raise Exception("Downloaded file not found")

        # Add to library
        song_library[url] = {
            "title": data.get("title", "Unknown Title"),
            "filepath": mp3_file,
            "duration": data.get("duration", 0),
            "thumbnail": data.get("thumbnail", ""),
        }

        save_library()
        return mp3_file
    except Exception as e:
        print(f"Error downloading song {url}: {e}")
        # Remove invalid library entry if it exists
        if url in song_library:
            del song_library[url]
            save_library()
        return None


async def play_next(ctx):
    global current_song, is_playing

    if len(song_queue) > 0:
        is_playing = True
        url, user_id = song_queue.popleft()
        save_queue()

        try:
            # Get the member object from the ID
            requester = ctx.guild.get_member(user_id)
            requester_mention = requester.mention if requester else f"User {user_id}"

            # Check if song is already downloaded
            if url in song_library:
                filepath = song_library[url]["filepath"]
                if os.path.exists(filepath):
                    source = discord.FFmpegPCMAudio(filepath)
                    current_song = YTDLSource(source, data=song_library[url])
                else:
                    # File missing but library entry exists - redownload
                    filepath = await download_song(url)
                    if not filepath:
                        raise Exception("Failed to download song")
                    source = discord.FFmpegPCMAudio(filepath)
                    current_song = YTDLSource(source, data=song_library[url])
            else:
                # Download the song if not in library
                filepath = await download_song(url)
                if not filepath:
                    raise Exception("Failed to download song")
                source = discord.FFmpegPCMAudio(filepath)
                current_song = YTDLSource(source, data=song_library[url])

            # Verify we have valid song data before playing
            if not current_song or not hasattr(current_song, "title"):
                raise Exception("Invalid song data received")

            ctx.voice_client.play(
                current_song,
                after=lambda e: asyncio.run_coroutine_threadsafe(
                    play_next(ctx), bot.loop
                ),
            )

            embed = discord.Embed(
                title="Now Playing",
                description=f"[{current_song.title}]({url})",
                color=discord.Color.green(),
            )
            if hasattr(current_song, "thumbnail") and current_song.thumbnail:
                embed.set_thumbnail(url=current_song.thumbnail)
            if hasattr(current_song, "duration") and current_song.duration:
                embed.add_field(
                    name="Duration",
                    value=f"{current_song.duration // 60}:{current_song.duration % 60:02}",
                )
            embed.add_field(name="Requested by", value=requester_mention)
            await ctx.send(embed=embed)

        except Exception as e:
            print(f"Error playing song: {e}")
            await ctx.send(f"Error playing song: {str(e)}")
            is_playing = False
            await play_next(ctx)  # Try to play next song in queue
    else:
        is_playing = False
        current_song = None
        await ctx.send("Queue is empty!")


@bot.event
async def on_ready():
    print(f"Logged in as {bot.user.name} ({bot.user.id})")
    await bot.change_presence(
        activity=discord.Activity(
            type=discord.ActivityType.listening, name=f"{PREFIX}play"
        )
    )


@bot.command(name="play", help="Plays a song from YouTube")
async def play(ctx, *, query):
    if not ctx.author.voice:
        await ctx.send("You are not connected to a voice channel!")
        return

    voice_channel = ctx.author.voice.channel

    if ctx.voice_client is None:
        await voice_channel.connect()
    elif ctx.voice_client.channel != voice_channel:
        await ctx.voice_client.move_to(voice_channel)

    # Check if query is a URL
    if query.startswith("http"):
        url = query
    else:
        # Search YouTube
        search_query = f"ytsearch:{query}"
        data = await bot.loop.run_in_executor(
            None, lambda: ytdl.extract_info(search_query, download=False)
        )
        if "entries" in data:
            url = data["entries"][0]["webpage_url"]
        else:
            await ctx.send("No results found!")
            return

    # Download the song (or use existing)
    filepath = await download_song(url)
    if not filepath:
        await ctx.send("Failed to download the song!")
        return

    # Add to queue
    song_queue.append((url, ctx.author.id))  # Changed from ctx.author to ctx.author.id
    save_queue()

    if not is_playing:
        await play_next(ctx)
    else:
        title = song_library[url]["title"]
        await ctx.send(f"Added to queue: **{title}**")


@bot.command(name="playplaylist", help="Plays a YouTube playlist")
async def play_playlist(ctx, url):
    if not ctx.author.voice:
        await ctx.send("You are not connected to a voice channel!")
        return

    voice_channel = ctx.author.voice.channel

    if ctx.voice_client is None:
        await voice_channel.connect()
    elif ctx.voice_client.channel != voice_channel:
        await ctx.voice_client.move_to(voice_channel)

    try:
        # Extract playlist info
        ydl_opts = {
            "extract_flat": True,
            "quiet": True,
            "no_warnings": True,
        }

        with youtube_dl.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

            if "entries" not in info:
                await ctx.send("This doesn't appear to be a playlist!")
                return

            # Add all playlist songs to queue
            count = 0
            for entry in info["entries"]:
                song_url = f"https://youtube.com/watch?v={entry['id']}"
                song_queue.append((song_url, ctx.author.id))  # Changed to ctx.author.id
                count += 1
            save_queue()
            await ctx.send(f"Added {count} songs from playlist to queue!")

            if not is_playing:
                await play_next(ctx)
    except Exception as e:
        await ctx.send(f"Error processing playlist: {e}")


@bot.command(name="queue", help="Shows the current queue")
async def show_queue(ctx):
    if len(song_queue) == 0 and not is_playing:
        await ctx.send("Queue is empty!")
        return

    embed = discord.Embed(title="Music Queue", color=discord.Color.blue())

    if is_playing and current_song:
        embed.add_field(
            name="Now Playing",
            value=f"[{current_song.title}]({current_song.url})",
            inline=False,
        )

    if len(song_queue) > 0:
        queue_list = []
        for i, (url, user_id) in enumerate(song_queue, 1):
            member = ctx.guild.get_member(user_id)
            mention = member.mention if member else f"User {user_id}"
            title = (
                song_library.get(url, {}).get("title", "Unknown Title")
                if url in song_library
                else "Loading..."
            )
            queue_list.append(f"{i}. [{title}]({url}) (requested by {mention})")

        embed.description = "\n".join(queue_list[:10])
        if len(song_queue) > 10:
            embed.set_footer(text=f"And {len(song_queue) - 10} more songs...")
    else:
        embed.description = "No songs in queue"

    await ctx.send(embed=embed)


@bot.command(name="skip", help="Skips the current song")
async def skip(ctx):
    if ctx.voice_client is None or not ctx.voice_client.is_playing():
        await ctx.send("Not playing anything!")
        return

    ctx.voice_client.stop()
    await ctx.send("Skipped current song!")


@bot.command(name="stop", help="Stops the bot and clears the queue")
async def stop(ctx):
    if ctx.voice_client is None or not ctx.voice_client.is_playing():
        await ctx.send("Not playing anything!")
        return

    song_queue.clear()
    save_queue()
    ctx.voice_client.stop()
    await ctx.send("Stopped playback and cleared queue!")


@bot.command(name="pause", help="Pauses the current song")
async def pause(ctx):
    if ctx.voice_client is None or not ctx.voice_client.is_playing():
        await ctx.send("Not playing anything!")
        return

    ctx.voice_client.pause()
    await ctx.send("Playback paused!")


@bot.command(name="resume", help="Resumes the current song")
async def resume(ctx):
    if ctx.voice_client is None or not ctx.voice_client.is_paused():
        await ctx.send("Playback is not paused!")
        return

    ctx.voice_client.resume()
    await ctx.send("Playback resumed!")


@bot.command(name="disconnect", help="Disconnects the bot from voice")
async def disconnect(ctx):
    if ctx.voice_client is None:
        await ctx.send("Not connected to voice!")
        return

    await ctx.voice_client.disconnect()
    await ctx.send("Disconnected from voice channel!")


@bot.event
async def on_command_error(ctx, error):
    if isinstance(error, commands.CommandNotFound):
        await ctx.send("Command not found!")
    elif isinstance(error, commands.MissingRequiredArgument):
        await ctx.send("Missing required argument!")
    else:
        await ctx.send(f"An error occurred: {error}")
        print(f"Error in command {ctx.command}: {error}")


bot.run(TOKEN)
