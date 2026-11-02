import { Client, Events, GatewayIntentBits, MessageFlags, Partials } from 'discord.js';
import { Store } from './db.js';
import { startScheduler } from './reminders.js';
import { handle } from './slash.js';
import { watch } from './watch.js';

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error('DISCORD_TOKEN is missing, copy .env.example to .env and fill it in');

const store = new Store(process.env.DB_PATH || 'texz.db');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, (c) => {
  console.log(`texz online as ${c.user.tag}`);
  startScheduler(client, store);
});

client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand()) return;
  try {
    await handle(store, i);
  } catch (e) {
    console.error(e);
    if (!i.replied) await i.reply({ content: 'Something broke on my side, try again in a bit.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

watch(client, store);
client.login(token);
