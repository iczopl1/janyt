const fs = require('fs');
const path = require('path');
const { Collection } = require('discord.js');

class CommandLoader {
    /**
     * @param {Client} [client] - Discord.js client instance (optional)
     */
constructor(client = null) {
    this.client = client;
    // Store commands on client if available, otherwise use local collection
    this.commands = client ? (client.commands ||= new Collection()) : new Collection();
    this._commandPaths = new Map();
}    /**
     * Validate a command module structure
     * @param {object} command - The command module to validate
     * @throws {Error} If command is invalid
     */
    validateCommand(command) {
        if (!command.data) throw new Error('Missing "data" property');
        if (!command.data.name) throw new Error('Command data missing "name"');
        if (!command.data.description) throw new Error('Command data missing "description"');
        if (!command.execute) throw new Error('Missing "execute" method');
        if (typeof command.execute !== 'function') throw new Error('"execute" must be a function');
        
        // Optional but recommended validations
        if (command.autocomplete && typeof command.autocomplete !== 'function') {
            throw new Error('"autocomplete" must be a function if provided');
        }
    }

    /**
     * Load all commands from the modules directory
     * @returns {Promise<{success: boolean, loaded: number, errors: string[]}>}
     */
    async loadAllCommands() {
        this.clearCache();
        this.commands.clear();
        this._commandPaths.clear();

        const modulesPath = path.join(__dirname, 'modules');
        const results = {
            success: true,
            loaded: 0,
            errors: []
        };

        // Check if modules directory exists
        if (!fs.existsSync(modulesPath)) {
            results.errors.push(`Modules directory not found: ${modulesPath}`);
            results.success = false;
            return results;
        }

        try {
            const moduleFolders = fs.readdirSync(modulesPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            if (moduleFolders.length === 0) {
                results.errors.push('No module folders found');
                results.success = false;
                return results;
            }

            for (const folder of moduleFolders) {
                const commandsPath = path.join(modulesPath, folder);
                const commandFiles = fs.readdirSync(commandsPath)
                    .filter(file => file.endsWith('.js') && !file.startsWith('_'));

                if (commandFiles.length === 0) {
                    results.errors.push(`No commands found in ${folder}`);
                    continue;
                }

                for (const file of commandFiles) {
                    const filePath = path.join(commandsPath, file);
                    try {
                        const command = require(filePath);
                        this.validateCommand(command);

                        this.commands.set(command.data.name, command);
                        this._commandPaths.set(command.data.name, filePath);
                        results.loaded++;
                    } catch (error) {
                        results.errors.push(`[${file}] ${error.message}`);
                        results.success = false;
                    }
                }
            }

            return results;
        } catch (error) {
            results.errors.push(`Directory error: ${error.message}`);
            results.success = false;
            return results;
        }
    }

    /**
     * Get a command by name
     * @param {string} name - Command name
     * @returns {Command|null}
     */
    getCommand(name) {
        return this.commands.get(name) || null;
    }

    /**
     * Reload a specific command
     * @param {string} commandName - Name of the command to reload
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async reloadCommand(commandName) {
        if (!this._commandPaths.has(commandName)) {
            return { success: false, error: 'Command not found or not loaded from file' };
        }

        const filePath = this._commandPaths.get(commandName);
        
        try {
            // Clear the module cache
            delete require.cache[require.resolve(filePath)];
            
            // Reload the command
            const newCommand = require(filePath);
            this.validateCommand(newCommand);
            
            // Replace the command
            this.commands.set(commandName, newCommand);
            
            return { success: true };
        } catch (error) {
            return { 
                success: false, 
                error: `Failed to reload ${commandName}: ${error.message}` 
            };
        }
    }

    /**
     * Clear the require cache for all commands
     */
    clearCache() {
        // Clear all command-related cache
        for (const filePath of this._commandPaths.values()) {
            const resolvedPath = require.resolve(filePath);
            if (require.cache[resolvedPath]) {
                delete require.cache[resolvedPath];
            }
        }
    }

    /**
     * Get all command data for registration
     * @returns {Array} Array of command data objects
     */
    getCommandData() {
        return [...this.commands.values()].map(cmd => cmd.data.toJSON());
    }
}

module.exports = CommandLoader;
