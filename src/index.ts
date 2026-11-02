import { ActivityType, Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { Store } from './db.js';
import { startScheduler } from './reminders.js';
import { onSlash, onText } from './core/registry.js';
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
  // rotating status, so the profile looks alive
  const moods = [
    'hiding from Kunikida\'s schedule',
    'tz help · reading case files',
    'a crab buffet, in my dreams',
    'Chuuya lose at cards',
    'your huntbot, lovingly',
  ];
  let i = 0;
  const mood = () => c.user.setActivity(moods[i++ % moods.length], { type: ActivityType.Watching });
  mood();
  setInterval(mood, 10 * 60_000);
});

client.on(Events.InteractionCreate, (i) => {
  if (i.isChatInputCommand()) void onSlash(store, i);
});

client.on(Events.MessageCreate, (m) => {
  if (!m.author.bot) onText(store, m);
});

watch(client, store);
client.login(token);
