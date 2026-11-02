import { REST, Routes } from 'discord.js';
import { definitions } from './core/registry.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
if (!token || !clientId) throw new Error('DISCORD_TOKEN and CLIENT_ID are needed in .env');

const rest = new REST().setToken(token);
// a server id makes the commands show up instantly, global ones can take a while
const route = guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);

try {
  await rest.put(route, { body: definitions });
} catch (e) {
  // discord explains exactly which command and option it didn't like
  const err = e as { rawError?: unknown; message?: string };
  console.error('Discord refused the commands:');
  console.error(JSON.stringify(err.rawError ?? err.message, null, 2));
  process.exit(1);
}

const live = (await rest.get(route)) as { name: string }[];
console.log(`Registered ${live.length} commands ${guildId ? 'on the server' : 'globally'}:`);
console.log(live.map((c) => `/${c.name}`).sort().join('  '));
if (!guildId) console.log('If some are missing in Discord, press Ctrl+R in the app to refresh.');
