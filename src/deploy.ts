import { REST, Routes } from 'discord.js';
import { definitions } from './core/registry.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
if (!token || !clientId) throw new Error('DISCORD_TOKEN and CLIENT_ID are needed in .env');

const rest = new REST().setToken(token);
// a server id makes the commands show up instantly, global ones can take a while
const route = guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);
await rest.put(route, { body: definitions });
console.log(`Registered ${definitions.length} commands ${guildId ? 'on the server' : 'globally'}`);
