import os, json, threading
import discord
from discord.ext import commands, tasks
from yt_dlp import YoutubeDL
from conf import conf

TOKEN = conf.TOKEN
MUSIC_DIR = "music/downloads"
SONG_DB = "music/songs.json"
PLAYLIST_DIR = "music/playlists"

os.makedirs(MUSIC_DIR, exist_ok=True)
os.makedirs(PLAYLIST_DIR, exist_ok=True)

intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix="/", intents=intents)


def load_db():
    if os.path.exists(SONG_DB):
        with open(SONG_DB, "r") as f:
            return json.load(f)
    return {}


def save_db(data):
    with open(SONG_DB, "w") as f:
        json.dump(data, f, indent=2)


song_db = load_db()

ydl_opts = {
    "format": "bestaudio/best",
    "outtmpl": f"{MUSIC_DIR}/%(title)s.%(ext)s",
    "quiet": True,
    "noplaylist": False,
    "extract_flat": False,
    "postprocessors": [
        {
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
        }
    ],
}


def download_music(link):
    with YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(link, download=True)
        entries = info.get("entries", [info])
        playlist = []
        for entry in entries:
            title = entry["title"]
            filename = f"{title}.mp3"
            if filename not in song_db:
                song_db[filename] = entry["webpage_url"]
            playlist.append({"title": title, "url": entry["webpage_url"]})
        save_db(song_db)
        if "entries" in info:  # it was a playlist
            playlist_file = os.path.join(PLAYLIST_DIR, f"{info['title']}.json")
            with open(playlist_file, "w") as f:
                json.dump(playlist, f, indent=2)


@bot.command()
async def join(ctx):
    if ctx.author.voice:
        await ctx.author.voice.channel.connect()


@bot.command()
async def leave(ctx):
    if ctx.voice_client:
        await ctx.voice_client.disconnect()


@bot.command()
async def play(ctx, *, name):
    vc = ctx.voice_client
    if not vc:
        await ctx.invoke(join)
        vc = ctx.voice_client

    path = os.path.join(MUSIC_DIR, name)
    if not os.path.exists(path):
        await ctx.send("File not found.")
        return

    vc.stop()
    vc.play(discord.FFmpegPCMAudio(path), after=lambda e: print(f"Finished: {e}"))


@bot.command()
async def list(ctx):
    files = os.listdir(MUSIC_DIR)
    await ctx.send("\n".join(files))


@bot.command()
async def download(ctx, url):
    await ctx.send("Starting download...")

    def bg_download():
        download_music(url)

    threading.Thread(target=bg_download).start()
    await ctx.send("Download started in background.")


@bot.command()
async def playlist(ctx, name):
    path = os.path.join(PLAYLIST_DIR, f"{name}.json")
    if not os.path.exists(path):
        await ctx.send("Playlist not found.")
        return

    with open(path, "r") as f:
        items = json.load(f)

    for item in items:
        title = f"{item['title']}.mp3"
        await ctx.invoke(play, name=title)


bot.run(TOKEN)
