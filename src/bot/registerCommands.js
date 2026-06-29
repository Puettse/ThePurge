import { REST, Routes } from 'discord.js';
import { commandData } from './commands.js';

export async function registerCommands({ config, liveFeed }) {
  const rest = new REST({ version: '10' }).setToken(config.botToken);
  console.log('[discord] Registering slash commands');

  await rest.put(Routes.applicationCommands(config.clientId), {
    body: commandData,
  });

  console.log(`[discord] Registered ${commandData.length} slash commands`);
  liveFeed.publish('discord.commands_registered', { count: commandData.length });
}
