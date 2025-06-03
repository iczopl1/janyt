from discord.ext import commands
from discord import Embed


class Help(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        bot.remove_command("help")

    @commands.command(name="help")
    async def help(self, ctx, command_name: str = None):
        """Show all available commands or help for a specific command"""
        if command_name:
            # Show help for specific command
            command = self.bot.get_command(command_name)
            if not command:
                await ctx.send(f"Command '{command_name}' not found.")
                return

            embed = Embed(title=f"Help for {command.name}", description=command.help)
            await ctx.send(embed=embed)
        else:
            # Show general help
            embed = Embed(
                title="Available Commands", description="Here's what I can do:"
            )

            for cog_name in self.bot.cogs:
                cog = self.bot.get_cog(cog_name)
                commands_list = cog.get_commands()

                if commands_list:
                    command_info = "\n".join(
                        f"`{cmd.name}` - {cmd.help or 'No description'}"
                        for cmd in commands_list
                    )
                    embed.add_field(name=cog_name, value=command_info, inline=False)

            await ctx.send(embed=embed)


async def setup(bot):
    await bot.add_cog(Help(bot))
