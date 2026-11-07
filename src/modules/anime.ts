import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, StringSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import {
  AniListError, airingOn, characterOfDay, guessRound, type Character, currentSeason, plain, randomPopular, searchCharacter, searchMedia, seasonal, titleOf, trending, mediaById,
  type Media,
} from '../anime/anilist.js';
import { RED, card, say } from '../theme.js';
import { listMenu, watchlist } from './watchlist.js';
import { GUESS_PAY } from './economy.js';
import { zonedTime } from '../time.js';

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);

const nice = (s: string | null) => (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '?');
const hex = (c: string | null) => (c ? Number.parseInt(c.replace('#', ''), 16) : undefined);

// a one-line opinion from the score, in his voice
function verdict(score: number | null, type: string) {
  const what = type === 'ANIME' ? 'watch' : 'read';
  if (score === null) return `Too new to judge. I'll ${what} it first and report back, probably during work hours.`;
  if (score >= 85) return `A masterpiece. Even Kunikida-kun would skip his schedule to ${what} this.`;
  if (score >= 75) return `Very good. Worth trading a nap for, and I don't say that lightly.`;
  if (score >= 65) return `Decent. Perfect for a lazy afternoon by the window.`;
  if (score >= 55) return `Hmm. ${what === 'watch' ? 'Watch' : 'Read'} it only if you've run out of crab.`;
  return `Even Chuuya has better taste than this. Skip it~`;
}

export function mediaCard(m: Media) {
  const isAnime = m.type === 'ANIME';
  const fields = [
    { name: '⭐ Score', value: m.averageScore ? `**${m.averageScore}**/100` : 'not rated', inline: true },
    { name: '📺 Format', value: nice(m.format), inline: true },
    { name: '📡 Status', value: nice(m.status), inline: true },
    isAnime
      ? { name: '🎞️ Episodes', value: `${m.episodes ?? '?'}${m.duration ? ` × ${m.duration}m` : ''}`, inline: true }
      : { name: '📚 Chapters', value: `${m.chapters ?? '?'}${m.volumes ? ` · ${m.volumes} vol` : ''}`, inline: true },
    { name: '🗓️ Started', value: m.season ? `${nice(m.season)} ${m.seasonYear}` : m.startDate.year ? String(m.startDate.year) : '?', inline: true },
    { name: '❤️ Popularity', value: m.popularity ? m.popularity.toLocaleString() : '?', inline: true },
  ];
  if (m.studios.nodes.length) fields.push({ name: '🏢 Studio', value: m.studios.nodes.map((s) => s.name).join(', '), inline: true });
  if (m.genres.length) fields.push({ name: '🏷️ Genres', value: m.genres.slice(0, 6).join(' · '), inline: false });
  fields.push({ name: '🕵️ Texz\'s verdict', value: verdict(m.averageScore, m.type), inline: false });
  // sequels, prequels and the source, so the next thing to watch is one click away
  const rel = (m.relations?.edges ?? []).filter((e) => ['SEQUEL', 'PREQUEL', 'ADAPTATION', 'SOURCE', 'PARENT', 'SIDE_STORY'].includes(e.relationType)).slice(0, 5);
  if (rel.length) {
    fields.push({ name: '🔗 Related', value: rel.map((e) => `${nice(e.relationType)}: [${e.node.title.english ?? e.node.title.romaji}](https://anilist.co/${e.node.type.toLowerCase()}/${e.node.id})`).join('\n'), inline: false });
  }
  if (m.nextAiringEpisode) {
    fields.push({ name: '⏰ Next episode', value: `Episode **${m.nextAiringEpisode.episode}** <t:${m.nextAiringEpisode.airingAt}:R> (<t:${m.nextAiringEpisode.airingAt}:f>)`, inline: false });
  }
  const e = card({
    kind: isAnime ? 'anime' : 'manga',
    title: titleOf(m),
    emoji: isAnime ? '📺' : '📖',
    color: hex(m.coverImage.color),
    body: [m.title.native ? `*${m.title.native}*` : '', plain(m.description)].filter(Boolean).join('\n\n'),
    fields,
    gif: 'off',
  }).setURL(m.siteUrl);
  if (m.coverImage.large) e.setThumbnail(m.coverImage.large);
  if (m.bannerImage) e.setImage(m.bannerImage);
  return e;
}

function mediaRows(userId: string, m: Media, others: Media[], following: boolean): Row[] {
  const rows: Row[] = [];
  if (others.length > 1) {
    rows.push(row(new StringSelectMenuBuilder().setCustomId(`ani|${userId}`).setPlaceholder('🔎 Not this one? Other matches')
      .addOptions(others.slice(0, 6).map((o) => ({
        label: titleOf(o).slice(0, 100),
        description: `${nice(o.format)} · ${o.seasonYear ?? o.startDate.year ?? '?'}`.slice(0, 100),
        value: String(o.id),
        default: o.id === m.id,
      })))));
  }
  const buttons: MessageActionRowComponentBuilder[] = [new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(m.siteUrl).setLabel('AniList').setEmoji('🔗')];
  // official places to watch or read, straight from AniList's own list
  const where = (m.externalLinks ?? []).filter((l) => l.type === 'STREAMING' && !l.isDisabled && /^https:\/\//.test(l.url));
  const seen = new Set<string>();
  const official = where.filter((l) => !seen.has(l.site) && seen.add(l.site)).slice(0, 4);
  if (m.type === 'ANIME' && m.nextAiringEpisode) {
    buttons.unshift(new ButtonBuilder().setCustomId(`anif|${userId}|${m.id}`).setStyle(following ? ButtonStyle.Success : ButtonStyle.Primary)
      .setEmoji(following ? '🔕' : '🔔').setLabel(following ? 'Stop episode alerts' : 'Alert me for new episodes'));
  }
  rows.push(row(listMenu(m)));
  rows.push(row(...buttons));
  if (official.length) {
    rows.push(row(...official.map((l) => new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(l.url).setLabel(`${m.type === 'MANGA' ? 'Read' : 'Watch'} on ${l.site}`.slice(0, 80)))));
  }
  return rows;
}

export function mediaView(store: Store, userId: string, m: Media, others: Media[]) {
  return { embeds: [mediaCard(m)], components: mediaRows(userId, m, others, store.follows(userId).some((f) => f.media_id === m.id)), private: false };
}

const listCard = (title: string, emoji: string, kind: 'season' | 'trending', list: Media[]) => card({
  kind, title, emoji, gif: 'off',
  body: list.map((m, i) => `\`${String(i + 1).padStart(2)}\` **[${titleOf(m)}](${m.siteUrl})** · ${m.averageScore ? `⭐ ${m.averageScore}` : 'new'} · ${nice(m.format)}${m.nextAiringEpisode ? ` · ep ${m.nextAiringEpisode.episode} <t:${m.nextAiringEpisode.airingAt}:R>` : ''}`).join('\n'),
});

const oops = (e: unknown) => card({ kind: 'error', title: 'AniList didn\'t answer', emoji: '📡', color: RED, gif: 'off', body: e instanceof AniListError ? e.message : 'Try again in a moment.' });

const lookup = (type: 'ANIME' | 'MANGA'): Command => ({
  name: type === 'ANIME' ? 'anime' : 'manga',
  group: 'anime',
  as: type === 'ANIME' ? 'search' : 'manga',
  data: new SlashCommandBuilder().setName(type === 'ANIME' ? 'anime' : 'manga').setDescription(`Look up ${type === 'ANIME' ? 'an anime' : 'a manga'} on AniList`)
    .addStringOption((o) => o.setName('title').setDescription('Title to search').setRequired(true).setMaxLength(100)).toJSON(),
  text: { aliases: type === 'ANIME' ? ['ani'] : ['mg'], args: ['title'] },
  run: async (ctx, store) => {
    const title = ctx.str('title');
    // nothing to search means the dashboard
    if (!title && type === 'ANIME') return home.run(ctx, store);
    if (!title) return ctx.reply(`Give me a title, partner: \`tz ${type === 'ANIME' ? 'anime' : 'manga'} bungo stray dogs\``);
    try {
      const found = await searchMedia(title, type);
      if (!found.length) return ctx.reply(card({ kind: 'missing', title: `No ${type.toLowerCase()} called "${title}"`, emoji: '🔍', gif: 'off' }));
      return ctx.reply(mediaView(store, ctx.userId, found[0], found));
    } catch (e) { return ctx.reply(oops(e)); }
  },
});

const character: Command = {
  name: 'character',
  group: 'anime',
  data: new SlashCommandBuilder().setName('character').setDescription('Look up an anime or manga character')
    .addStringOption((o) => o.setName('name').setDescription('Character name').setRequired(true).setMaxLength(100)).toJSON(),
  text: { aliases: ['char'], args: ['name'] },
  run: async (ctx) => {
    const name = ctx.str('name');
    if (!name) return ctx.reply('Who are we investigating? `tz char dazai osamu`');
    try {
      const [c] = await searchCharacter(name);
      if (!c) return ctx.reply(card({ kind: 'missing', title: `Nobody called "${name}"`, emoji: '🔍', gif: 'off' }));
      return ctx.reply({ embeds: [characterCard(c)] });
    } catch (e) { return ctx.reply(oops(e)); }
  },
};

export function characterCard(c: Character, title?: string) {
      const e = card({
        kind: 'character', title: title ?? c.name.full ?? '?', emoji: '🎭', gif: 'off',
        body: [c.name.native ? `*${c.name.native}*` : '', plain(c.description, 500)].filter(Boolean).join('\n\n'),
        fields: [
          { name: '📚 Appears in', value: c.media.nodes.map((n) => `${n.type === 'ANIME' ? '📺' : '📖'} ${n.title.english ?? n.title.romaji}`).join('\n') || '?', inline: false },
          { name: '❤️ Favourites', value: c.favourites?.toLocaleString() ?? '?', inline: true },
          ...(c.gender ? [{ name: '👤 Gender', value: c.gender, inline: true }] : []),
          ...(c.age ? [{ name: '🎂 Age', value: c.age, inline: true }] : []),
        ],
      }).setURL(c.siteUrl);
      if (c.image.large) e.setThumbnail(c.image.large);
      return e;
}

const season: Command = {
  name: 'season',
  group: 'anime',
  data: new SlashCommandBuilder().setName('season').setDescription('Most popular anime of a season')
    .addStringOption((o) => o.setName('season').setDescription('Season, this one if empty')
      .addChoices({ name: 'Winter', value: 'WINTER' }, { name: 'Spring', value: 'SPRING' }, { name: 'Summer', value: 'SUMMER' }, { name: 'Fall', value: 'FALL' }))
    .addIntegerOption((o) => o.setName('year').setDescription('Year').setMinValue(1960).setMaxValue(2100)).toJSON(),
  text: { aliases: ['seasonal'], args: ['season', 'year'] },
  run: async (ctx) => {
    const now = currentSeason();
    const s = (ctx.str('season') ?? now.season).toUpperCase().replace('AUTUMN', 'FALL');
    if (!['WINTER', 'SPRING', 'SUMMER', 'FALL'].includes(s)) return ctx.reply('Seasons are winter, spring, summer or fall.');
    const y = ctx.int('year') ?? now.year;
    try {
      const list = await seasonal(s, y);
      return ctx.reply({ embeds: [listCard(`${nice(s)} ${y}`, '🌸', 'season', list)], private: false });
    } catch (e) { return ctx.reply(oops(e)); }
  },
};

const trend: Command = {
  name: 'trending',
  group: 'anime',
  data: new SlashCommandBuilder().setName('trending').setDescription('What everyone is watching or reading right now')
    .addStringOption((o) => o.setName('type').setDescription('Anime or manga').addChoices({ name: 'Anime', value: 'ANIME' }, { name: 'Manga', value: 'MANGA' })).toJSON(),
  text: { aliases: ['trend', 'hot'], args: ['type'] },
  run: async (ctx) => {
    const type = (ctx.str('type') ?? 'ANIME').toUpperCase() === 'MANGA' ? 'MANGA' : 'ANIME';
    try {
      const list = await trending(type);
      return ctx.reply({ embeds: [listCard(`Trending ${type === 'ANIME' ? 'anime' : 'manga'}`, '🔥', 'trending', list)], private: false });
    } catch (e) { return ctx.reply(oops(e)); }
  },
};

const random: Command = {
  name: 'recommend',
  group: 'anime',
  as: 'random',
  data: new SlashCommandBuilder().setName('recommend').setDescription('A random popular anime or manga to try')
    .addStringOption((o) => o.setName('type').setDescription('Anime or manga').addChoices({ name: 'Anime', value: 'ANIME' }, { name: 'Manga', value: 'MANGA' })).toJSON(),
  text: { aliases: ['rec', 'suggest'], args: ['type'] },
  run: async (ctx, store) => {
    const type = (ctx.str('type') ?? 'ANIME').toUpperCase() === 'MANGA' ? 'MANGA' : 'ANIME';
    try {
      const m = await randomPopular(type);
      if (!m) return ctx.reply('My mind went blank. Try again~');
      return ctx.reply(mediaView(store, ctx.userId, m, []));
    } catch (e) { return ctx.reply(oops(e)); }
  },
};

const alerts: Command = {
  name: 'alerts',
  group: 'anime',
  data: new SlashCommandBuilder().setName('alerts').setDescription('Anime you get new-episode alerts for').toJSON(),
  text: { aliases: ['follows', 'watching'] },
  run: (ctx, store) => {
    const list = store.follows(ctx.userId);
    const body = list.length
      ? list.map((f) => `🔔 **${f.title}**${f.next_at ? ` · next <t:${Math.floor(f.next_at / 1000)}:R>` : ''}`).join('\n')
      : 'No alerts yet. Look an anime up with `tz anime <title>` and press 🔔.';
    const rows: Row[] = list.length
      ? [row(new StringSelectMenuBuilder().setCustomId(`aniu|${ctx.userId}`).setPlaceholder('🔕 Stop alerts for...')
          .addOptions(list.slice(0, 25).map((f) => ({ label: f.title.slice(0, 100), value: String(f.media_id) }))))]
      : [];
    return ctx.reply({ embeds: [card({ kind: 'alerts', title: 'Episode alerts', emoji: '🔔', body, gif: 'off' })], components: rows });
  },
};

// everything anime on one screen: today's episodes, what's hot, your list and alerts
const home: Command = {
  name: 'animehome',
  hidden: true,
  data: new SlashCommandBuilder().setName('animehome').setDescription('Anime dashboard').toJSON(),
  run: async (ctx, store) => {
    const tz = store.settings(ctx.userId).timezone;
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    const from = Math.floor(zonedTime(tz, Number(p.year), Number(p.month), Number(p.day)).getTime() / 1000);
    const [today, hot, cotd] = await Promise.all([
      airingOn(from, from + 86_400).catch(() => []),
      trending('ANIME').catch(() => []),
      characterOfDay().catch(() => null),
    ]);
    const mine = new Set(store.follows(ctx.userId).map((f) => f.media_id));
    const airs = [...today].sort((a, b) => (mine.has(b.media.id) ? 1 : 0) - (mine.has(a.media.id) ? 1 : 0) || (b.media.popularity ?? 0) - (a.media.popularity ?? 0)).slice(0, 6)
      .sort((a, b) => a.airingAt - b.airingAt);
    const count = (st: string) => store.watchlist(ctx.userId, st).length;
    const fields = [
      { name: '📡 Airing today', value: airs.map((a) => `<t:${a.airingAt}:t> ${mine.has(a.media.id) ? '🔔 ' : ''}**${titleOf(a.media)}** · ep ${a.episode}`).join('\n') || 'Nothing big today.', inline: false },
      { name: '🔥 Trending', value: hot.slice(0, 4).map((m, i) => `${i + 1}. [${titleOf(m)}](${m.siteUrl})`).join('\n') || '?', inline: true },
      { name: '📋 Your list', value: `▶️ ${count('watching')} watching\n🗓️ ${count('planning')} planning\n✅ ${count('completed')} done\n🔔 ${mine.size} alerts`, inline: true },
      ...(cotd ? [{ name: '🎭 Character of the day', value: `[${cotd.name.full}](${cotd.siteUrl})`, inline: true }] : []),
    ];
    const nav = (cmd: string, emoji: string, label: string) => new ButtonBuilder().setCustomId(`nav|${cmd}|owner=${ctx.userId},back=animehome`).setEmoji(emoji).setLabel(label).setStyle(ButtonStyle.Secondary);
    const rows = [
      row(nav('airing', '📡', 'Full schedule'), nav('watchlist', '📋', 'My list'), nav('trending', '🔥', 'Trending'), nav('guess', '🔎', 'Guess game')),
      row(new StringSelectMenuBuilder().setCustomId(`nav|pick|owner=${ctx.userId},back=animehome`).setPlaceholder('📂 Open anything else').addOptions(
        { label: 'This season', value: 'season', emoji: '🌸' }, { label: 'Random pick', value: 'recommend', emoji: '🎲' },
        { label: 'Character of the day', value: 'today', emoji: '🎭' }, { label: 'My episode alerts', value: 'alerts', emoji: '🔔' },
        { label: 'Server\'s tracked shows', value: 'track', emoji: '📺' },
        { label: 'Search an anime', value: 'anime', emoji: '🔍' }, { label: 'Search a manga', value: 'manga', emoji: '📚' },
        { label: 'Find a character', value: 'character', emoji: '🎭' }, { label: 'Add to my list', value: 'watchlist.add', emoji: '➕' },
        { label: 'Airing on another day', value: 'airing', emoji: '📅' }, { label: 'My pings', value: 'pings', emoji: '🔔' },
      )),
    ];
    return ctx.reply({ embeds: [card({ kind: 'season', title: 'Anime dashboard', emoji: '📺', gif: 'off', fields,
      body: 'Search with `tz anime <title>` or `/anime input:<title>`. Everything else is a click away.' })], components: rows });
  },
};

const airing: Command = {
  name: 'airing',
  group: 'anime',
  data: new SlashCommandBuilder().setName('airing').setDescription('Episodes airing today, or tomorrow')
    .addStringOption((o) => o.setName('day').setDescription('Today if empty').addChoices({ name: 'today', value: 'today' }, { name: 'tomorrow', value: 'tomorrow' })).toJSON(),
  text: { aliases: ['airs', 'aired'], args: ['day'] },
  run: async (ctx, store) => {
    // the day goes by the asker's own timezone
    const tz = store.settings(ctx.userId).timezone;
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    const add = ctx.str('day')?.toLowerCase() === 'tomorrow' ? 1 : 0;
    const from = zonedTime(tz, Number(p.year), Number(p.month), Number(p.day) + add).getTime() / 1000;
    const list = await airingOn(Math.floor(from), Math.floor(from) + 86_400).catch(() => null);
    if (!list) return ctx.reply('AniList didn\'t answer, try again in a moment.');
    const body = list.length
      ? list.slice(0, 20).map((a) => `<t:${a.airingAt}:t> **[${titleOf(a.media)}](${a.media.siteUrl})** · ep ${a.episode}${a.media.averageScore ? ` · ⭐ ${a.media.averageScore}` : ''}`).join('\n')
      : 'Nothing airing. A rare quiet day for Yokohama.';
    return ctx.reply({ embeds: [card({ kind: 'season', title: add ? 'Airing tomorrow' : 'Airing today', emoji: '📡', gif: 'off', body })] });
  },
};

const daily: Command = {
  name: 'today',
  group: 'anime',
  data: new SlashCommandBuilder().setName('today').setDescription('Today\'s character of the day').toJSON(),
  text: { aliases: ['cotd'] },
  run: async (ctx) => {
    const c = await characterOfDay().catch(() => null);
    if (!c) return ctx.reply('AniList didn\'t answer, try again in a moment.');
    return ctx.reply({ embeds: [characterCard(c, `Character of the day · ${c.name.full ?? '?'}`)] });
  },
};

// one round per channel, the first right answer wins
const rounds = new Map<string, { answer: number; titles: string[]; ends: number; done: boolean }>();

export const guess: Command = {
  name: 'guess',
  group: 'fun',
  data: new SlashCommandBuilder().setName('guess').setDescription('Name the anime from a picture, first right answer wins yen').toJSON(),
  text: { aliases: ['gta', 'animequiz'] },
  run: async (ctx, store) => {
    const live = rounds.get(ctx.channelId);
    if (live && !live.done && live.ends > Date.now()) return ctx.reply('A round is already running here, answer that one first.');
    const r = await guessRound().catch(() => null);
    if (!r) return ctx.reply('AniList didn\'t give me a good picture, try again.');
    const order = [...r.options].sort(() => Math.random() - 0.5);
    const titles = order.map(titleOf);
    const id = `${ctx.channelId}`;
    rounds.set(id, { answer: order.findIndex((m) => m.id === r.answer.id), titles, ends: Date.now() + 30_000, done: false });
    const e = card({ kind: 'guess', title: 'Which anime is this?', emoji: '🔎', gif: 'off', body: `30 seconds. First right answer${ctx.guildId && store.rules(ctx.guildId, 'economy').enabled ? ` gets **¥${GUESS_PAY}**` : ' wins'}.` })
      .setImage(r.answer.bannerImage);
    const buttons = row(...titles.map((t, i) => new ButtonBuilder().setCustomId(`gs|${id}|${i}`).setLabel(t.slice(0, 80)).setStyle(ButtonStyle.Secondary)));
    // everyone in the channel plays, so it's posted for all
    return ctx.reply({ embeds: [e], components: [buttons], public: true });
  },
};

export async function onGuess(store: Store, i: import('discord.js').Interaction) {
  if (!i.isButton() || !i.customId.startsWith('gs|')) return false;
  const [, id, pick] = i.customId.split('|');
  const r = rounds.get(id);
  if (!r || r.done || r.ends < Date.now()) {
    if (r && !r.done) r.done = true;
    await i.reply({ content: r ? `Time's up, it was **${r.titles[r.answer]}**.` : 'This round is over.', flags: 64 });
    return true;
  }
  if (Number(pick) !== r.answer) { await i.reply({ content: '❌ Not that one.', flags: 64 }); return true; }
  r.done = true;
  const paid = i.guildId && store.rules(i.guildId, 'economy').enabled ? store.pay(i.guildId, i.user.id, GUESS_PAY) : false;
  const rows = i.message.components.map((c) => c.toJSON());
  for (const rw of rows) for (const b of (rw as { components: { disabled?: boolean; style?: number; custom_id?: string }[] }).components) {
    b.disabled = true;
    if (b.custom_id === `gs|${id}|${r.answer}`) b.style = ButtonStyle.Success;
  }
  await i.update({ components: rows as never });
  await i.followUp({ content: `🎉 <@${i.user.id}> got it: **${r.titles[r.answer]}**${paid ? ` · +¥${GUESS_PAY}` : ''}. ${say('guessWin')}`, allowedMentions: { users: [i.user.id] } });
  return true;
}

// posts the character of the day once a day, around 9 in the morning in India
export function startDailyCharacter(client: import('discord.js').Client, store: Store) {
  const tick = async () => {
    const now = new Date();
    if (now.getUTCHours() < 3 || (now.getUTCHours() === 3 && now.getUTCMinutes() < 30)) return;
    const day = now.toISOString().slice(0, 10);
    for (const guild of client.guilds.cache.values()) {
      const g = store.guild(guild.id);
      // its own channel if one was picked, otherwise the screenings channel
      const chId = g.daily.channel ?? (g.bulletins.anime.on ? g.bulletins.anime.channel : null);
      if (!chId || !store.rules(guild.id, 'anime').enabled || store.getKv(`cotd:${guild.id}`) === day) continue;
      store.setKv(`cotd:${guild.id}`, day);
      const c = await characterOfDay(day).catch(() => null);
      const ch = c ? await guild.channels.fetch(chId).catch(() => null) : null;
      if (c && ch?.isSendable()) await ch.send({ embeds: [characterCard(c, `Character of the day · ${c.name.full ?? '?'}`)] }).catch(() => {});
    }
  };
  setInterval(() => void tick(), 10 * 60_000);
  setTimeout(() => void tick(), 20_000);
}

export const anime: Module = {
  name: 'anime',
  label: 'Anime and manga',
  about: 'Search anime, manga and characters, seasons, trending picks, new-episode alerts and your own watch list',
  commands: [home, lookup('ANIME'), lookup('MANGA'), character, airing, daily, season, trend, random, alerts, watchlist],
};

// ---------- buttons and menus ----------

export async function onAnimeComponent(store: Store, i: import('discord.js').Interaction) {
  if (!i.isButton() && !i.isStringSelectMenu()) return false;
  const [tag, owner, arg] = i.customId.split('|');
  if (!['ani', 'anif', 'aniu'].includes(tag)) return false;
  if (i.user.id !== owner && tag !== 'ani') {
    await i.reply({ content: 'Those are someone else\'s alerts. Look it up yourself and press 🔔.', flags: 64 });
    return true;
  }
  if (tag === 'ani' && i.isStringSelectMenu()) {
    const m = await mediaById(Number(i.values[0])).catch(() => null);
    if (!m) { await i.reply({ content: 'AniList didn\'t answer, try again.', flags: 64 }); return true; }
    const others = (i.message.components[0]?.toJSON() as { components?: { options?: { value: string }[] }[] })?.components?.[0]?.options ?? [];
    const rest = await Promise.all(others.map((o) => mediaById(Number(o.value)).catch(() => null)));
    await i.update(mediaView(store, owner, m, rest.filter((x): x is Media => !!x)));
    return true;
  }
  if (tag === 'anif' && i.isButton()) {
    const id = Number(arg);
    const following = store.follows(owner).some((f) => f.media_id === id);
    if (following) store.unfollow(owner, id);
    else {
      const m = await mediaById(id).catch(() => null);
      if (!m) { await i.reply({ content: 'AniList didn\'t answer, try again.', flags: 64 }); return true; }
      store.follow(owner, id, titleOf(m), m.nextAiringEpisode ? m.nextAiringEpisode.airingAt * 1000 : null, i.channelId);
    }
    await i.reply({ content: following ? '🔕 No more episode alerts for that one.' : '🔔 Done. I\'ll tell you the moment a new episode airs~', flags: 64 });
    return true;
  }
  if (tag === 'aniu' && i.isStringSelectMenu()) {
    store.unfollow(owner, Number(i.values[0]));
    await i.reply({ content: '🔕 Stopped.', flags: 64 });
    return true;
  }
  return false;
}
