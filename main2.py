import os
import discord
from discord.ext import commands
from conf import conf2
import json
import asyncio
from collections import deque

PREFIX = "/"
# Create bot instance with command prefix
bot = commands.Bot(command_prefix=PREFIX, intents=discord.Intents.all())


# Load all modules from the modules folder
async def load_modules():
    for filename in os.listdir("./modules"):
        if filename.endswith(".py") and not filename.startswith("__"):
            try:
                await bot.load_extension(f"modules.{filename[:-3]}")
                print(f"Successfully loaded module: {filename}")
            except Exception as e:
                print(f"Failed to load module {filename}: {e}")


@bot.event
async def on_ready():
    print(f"Logged in as {bot.user.name} ({bot.user.id})")
    await bot.change_presence(
        activity=discord.Activity(
            type=discord.ActivityType.listening, name=f"{PREFIX}play"
        )
    )
    print("------")


# Run the bot
async def main():
    await load_modules()
    await bot.start(conf2.TOKEN)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
