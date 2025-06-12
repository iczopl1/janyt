const { Client, GatewayIntentBits, ActivityType, Collection } = require('discord.js');
const mongoose = require('mongoose');
require('dotenv').config();
const CommandLoader = require('./commandsLoader');
// Initialize global error handlers
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});
process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error);
});

async function initializeDatabase() {
    const maxRetries = 3;
    let retries = 0;
    
    while (retries < maxRetries) {
        try {
            await mongoose.connect(process.env.MONGODB_URI, {
                dbName: "song_database",
                serverSelectionTimeoutMS: 5000
            });
            console.log('✅ Connected to MongoDB');
            client.dbConnection = mongoose.connection;
            client.db = mongoose.connection.db;
            return;
        } catch (err) {
            retries++;
            console.error(`❌ MongoDB connection error (attempt ${retries}/${maxRetries}):`, err.message);
            if (retries < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }
    console.error('❌ Failed to connect to MongoDB after multiple attempts');
    process.exit(1);
}

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildVoiceStates
    ] 
});

// Initialize collections
client.commands = new Collection();  // This will store all commands
client.queues = new Map();
const commandLoader = new CommandLoader(client);
client.commandLoader = commandLoader;
async function startBot() {
    try {
        // 1. Initialize database first
        await initializeDatabase();
        
        // 2. Load all commands
        const loadResult = await commandLoader.loadAllCommands();
        console.log(`Loaded ${loadResult.loaded} commands`);
        
        if (loadResult.errors.length > 0) {
            console.error('Command loading errors:', loadResult.errors);
        }
        
        // Transfer commands from loader to client
        commandLoader.commands.forEach((cmd, name) => {
            client.commands.set(name, cmd);
        });

        // Check if commands were loaded properly
        if (client.commands.size === 0) {
            throw new Error('No commands were loaded! Check your commands directory.');
        }
        
        const registerCommand = require('./registerCommand.js')
        console.log('Available commands:');
        client.commands.forEach((command, name) => {
            console.log(` • ${name}`);
        });

        // 3. Login to Discord
        await client.login(process.env.TOKEN);
        console.log(`Logged in as ${client.user.tag}`);
        
    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1);
    }
}

// Event handlers
client.on('ready', () => {
    console.log(`Bot is ready in ${client.guilds.cache.size} guilds`);
    client.user.setPresence({
        activities: [{ name: '/help', type: ActivityType.Listening }],
        status: 'online'
    });
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        console.log(`[${new Date().toISOString()}] ${interaction.user.tag} used /${interaction.commandName} in ${interaction.guild?.name || 'DM'}`);
        
        await command.execute(interaction);
    } catch (error) {
        console.error(`Command Error [${interaction.commandName}]:`, error);
        
        let errorMessage = 'There was an error executing this command!';
        if (error instanceof Error) {
            errorMessage += `\n\`\`\`${error.message}\`\`\``;
        }
        
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ 
                content: errorMessage,
                ephemeral: true 
            });
        } else {
            await interaction.reply({ 
                content: errorMessage,
                ephemeral: true 
            });
        }
    }
});

client.on('guildDelete', guild => {
    client.queues.delete(guild.id);
});

// Start the bot
startBot();
