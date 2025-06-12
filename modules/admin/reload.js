
const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { REST, Routes } = require('discord.js');
require('dotenv').config();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reload')
        .setDescription('Reload and register all bot commands')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addBooleanOption(option =>
            option.setName('silent')
                .setDescription('Show response only to you')),

    async execute(interaction) {
        const silent = interaction.options.getBoolean('silent') || false;

        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({
                content: '❌ You need administrator permissions to use this command.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: silent });

        const commandLoader = interaction.client.commandLoader;
        const result = await commandLoader.loadAllCommands();

        // Register loaded commands with Discord
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
        const commands = commandLoader.getCommandData();

        const route = process.argv.includes('--global')
            ? Routes.applicationCommands(process.env.CLIENT_ID)
            : Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID);

        let apiError = null;
        try {
            await rest.put(route, { body: commands });
        } catch (err) {
            apiError = err;
        }

        const embed = new EmbedBuilder()
            .setColor(result.success && !apiError ? 0x00FF00 : 0xFF0000)
            .setTitle(apiError ? '❌ Reload Failed During Registration' :
                     result.success ? '✅ Commands Reloaded and Registered' :
                                      '⚠️ Reloaded With Errors')
            .addFields(
                { name: 'Commands Loaded', value: result.loaded.toString(), inline: true },
                { name: 'Errors', value: result.errors.length.toString(), inline: true }
            );

        if (result.errors.length > 0) {
            embed.addFields({
                name: 'Load Errors',
                value: `\`\`\`${result.errors.slice(0, 5).join('\n')}${result.errors.length > 5 ? '\n...and more' : ''}\`\`\``
            });
        }

        if (apiError) {
            embed.addFields({
                name: 'API Error',
                value: `\`\`\`${apiError.message}\`\`\``
            });
        }

        await interaction.editReply({ embeds: [embed] });
    }
};

