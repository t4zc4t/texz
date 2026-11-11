import { ActivityType, Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { Store } from './db.js';
import { look } from './theme.js';
import { warmUp } from './gifs.js';
import { startScheduler } from './reminders.js';
import { definitions, onComponent, onSlash, onText } from './core/registry.js';
import { afkWatch } from './modules/utility.js';
import { startModTimers } from './modules/moderation.js';
import { startGiveaways } from './modules/giveaways.js';
import { startBirthdays } from './modules/birthdays.js';
import { watchEpisodes } from './anime/alerts.js';
import { wireEvents } from './events.js';
import { watch } from './watch.js';
import { report, startHealth, startOps, syncCommands } from './ops.js';
import { startServerTimers } from './modules/server.js';
import { startDailyCharacter } from './modules/anime.js';
import { sweepQuiz } from './modules/f1quiz.js';
import { mergeShoobRoles, watchSpawns } from './modules/spawns.js';
import { onCount, startRecap } from './modules/community.js';
import { carryRankPerms, fixRankOrder, tidyRanks } from './modules/levels.js';
import { warmModel } from './features/pokemodel.js';
import { loadTypeIcons } from './features/typeicons.js';
import { loadLogos } from './features/logos.js';
import { startBulletins } from './modules/bulletins.js';
import { onQuote, QUOTE_MENU, startQuoteOfWeek } from './modules/quote.js';
import { settleAll, settleGuild } from './core/settle.js';

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
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.Reaction, Partials.User],
});

client.once(Events.ClientReady, (c) => {
  console.log(`texz online as ${c.user.tag}`);
  look.avatar = c.user.displayAvatarURL();
  // new servers start switched off, the home server keeps everything
  settleAll(c, store);
  // rank roles drift when people add or move roles, so they're put back in order on every start and once a day
  const reorder = () => {
    for (const guild of c.guilds.cache.values()) void mergeShoobRoles(guild, store).catch((e) => report('shoob roles', e));
    for (const guild of c.guilds.cache.values()) {
      const g = store.guild(guild.id);
      if (!store.rules(guild.id, 'levels').enabled || Object.keys(g.levels.rewards).length < 2) continue;
      // servers from before keep only the highest rank now
      if (!store.getKv(`ranks:single:${guild.id}`)) { store.setKv(`ranks:single:${guild.id}`, '1'); g.levels.stack = false; store.saveGuild(guild.id, g); }
      void (async () => {
        await fixRankOrder(guild, g.levels.rewards);
        if (!g.levels.stack) await carryRankPerms(guild, g.levels.rewards);
        await tidyRanks(store, guild);
      })().catch((e) => report('rank roles', e));
    }
  };
  setTimeout(reorder, 30_000).unref?.();
  setInterval(reorder, 24 * 3600_000).unref?.();
  // look up every gif link once so cards can show them straight away
  const custom = store.db.prepare('SELECT settings FROM guilds').all().flatMap((r) => Object.values((JSON.parse((r as { settings: string }).settings).gifs ?? {}) as Record<string, string>));
  void warmUp(custom).then((n) => console.log(`gifs ready: ${n}`));
  startScheduler(client, store);
  watchEpisodes(store);
  startModTimers(client, store);
  startGiveaways(client, store);
  startBirthdays(client, store);
  startOps(client, store);
  void syncCommands(c, store, definitions).catch((e) => report('command sync', e));
  startServerTimers(client, store);
  startDailyCharacter(client, store);
  watchSpawns(client, store);
  warmModel();
  void loadTypeIcons(client).catch((e) => report('type icons', e)).then(() => loadLogos(client)).catch((e) => report('team logos', e));
  startQuoteOfWeek(client, store);
  startHealth(client, store);
  startRecap(client, store);
  sweepQuiz(async (id, payload) => {
    const ch = await client.channels.fetch(id).catch(() => null);
    if (ch?.isSendable()) await ch.send(payload as never);
  });
  startBulletins(client, store);
  // knowing the owner lets /setup offer the error channel to them only
  void c.application.fetch().catch(() => {});
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

client.on(Events.GuildCreate, (guild) => settleGuild(store, guild));

client.on(Events.InteractionCreate, (i) => {
  if (i.isChatInputCommand()) void onSlash(store, i);
  else if (i.isMessageContextMenuCommand() && (i.commandName === QUOTE_MENU || i.commandName === 'Quote')) void onQuote(store, i).catch((e) => report('quote', e));
  else void onComponent(store, i);
});

client.on(Events.MessageCreate, (m) => {
  if (m.author.bot) return;
  if (m.guildId) store.heard(m.guildId, m.author.id, m.channelId);
  onText(store, m);
  void afkWatch(store, m);
  void onCount(store, m).catch(() => {});
});

watch(client, store);
wireEvents(client, store);
client.login(token);
