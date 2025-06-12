// registerCommand.js (improved)
const { REST, Routes } = require('discord.js');
require('dotenv').config();
const CommandLoader = require('./commandsLoader');
const isGlobal = process.argv.includes('--global');
const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

(async () => {
    const commandLoader = new CommandLoader();
    const result = await commandLoader.loadAllCommands();
    
    if (!result.success) {
        console.error('Failed to load commands:', result.errors);
        process.exit(1);
    }

    const commands = [...commandLoader.commands.values()].map(cmd => cmd.data.toJSON());
    const rest = new REST({ version: '10' }).setToken(token);

    try {
        console.log(`🔄 Refreshing ${commands.length} commands (${isGlobal ? 'GLOBAL' : 'GUILD'})...`);
        
        const route = isGlobal 
            ? Routes.applicationCommands(clientId)
            : Routes.applicationGuildCommands(clientId, guildId);

        await rest.put(route, { body: commands });
        console.log('✅ Successfully registered application commands.');
    } catch (error) {
        console.error('❌ Failed to register commands:', error);
        process.exit(1);
    }
})();
