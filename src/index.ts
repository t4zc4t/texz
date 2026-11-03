import { ActivityType, Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { Store } from './db.js';
import { look } from './theme.js';
import { warmUp } from './gifs.js';
import { startScheduler } from './reminders.js';
import { onComponent, onSlash, onText } from './core/registry.js';
import { afkWatch } from './modules/utility.js';
import { startModTimers } from './modules/moderation.js';
import { startGiveaways } from './modules/giveaways.js';
import { startBirthdays } from './modules/birthdays.js';
import { watchEpisodes } from './anime/alerts.js';
import { wireEvents } from './events.js';
import { watch } from './watch.js';

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error('DISCORD_TOKEN is missing, copy .env.example to .env and fill it in');

const store = new Store(process.env.DB_PATH || 'texz.db');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.GuildMember],
});

client.once(Events.ClientReady, (c) => {
  console.log(`texz online as ${c.user.tag}`);
  look.avatar = c.user.displayAvatarURL();
  // look up every gif link once so cards can show them straight away
  const custom = store.db.prepare('SELECT settings FROM guilds').all().flatMap((r) => Object.values((JSON.parse((r as { settings: string }).settings).gifs ?? {}) as Record<string, string>));
  void warmUp(custom).then((n) => console.log(`gifs ready: ${n}`));
  startScheduler(client, store);
  watchEpisodes(store);
  startModTimers(client, store);
  startGiveaways(client, store);
  startBirthdays(client, store);
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
  else void onComponent(store, i);
});

client.on(Events.MessageCreate, (m) => {
  if (m.author.bot) return;
  if (m.guildId) store.heard(m.guildId, m.author.id, m.channelId);
  onText(store, m);
  void afkWatch(store, m);
});

watch(client, store);
wireEvents(client, store);
client.login(token);
