import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus, MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, TextInputBuilder, TextInputStyle,
  type Client, type Guild, type Interaction, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Store } from '../db.js';
import type { Command } from '../core/module.js';
import { searchMedia, titleOf } from '../anime/anilist.js';
import { details, hasMovies, search as searchMovies } from '../anime/trakt.js';
import { card } from '../theme.js';
import { parseWhen } from './server.js';
import { track } from './missions.js';

// a watch party for an anime, a movie or just the room: a server event in the Watch Party voice room,
// an I'm in button, a ping for everyone in when it starts, and a spoiler thread under it

interface What { kind: 'anime' | 'movie' | 'room'; title: string; url?: string; image?: string; thumb?: string; minutes: number; fans?: string[] }
interface Party { key: string; guild: string; host: string; title: string; at: number; going: string[]; channel: string; message?: string; thread?: string; event?: string; started?: boolean }

const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);
const partyKey = (k: string) => `wparty:${k}`;
const load = (store: Store, k: string) => JSON.parse(store.getKv(partyKey(k)) ?? 'null') as Party | null;
const save = (store: Store, p: Party) => store.setKv(partyKey(p.key), JSON.stringify(p));
const roomOf = (store: Store, g: string) => store.getKv(`voice:${g}:watch`);

// look the title up: "movie x" or "anime x" says which, otherwise the closer match of the two wins
async function find(q: string, prefer?: 'anime' | 'movie'): Promise<What | null> {
  const m = /^(movie|film|anime)\s+(.+)/i.exec(q);
  const want = m ? (m[1].toLowerCase() === 'anime' ? 'anime' : 'movie') : prefer;
  const text = m ? m[2] : q;
  const near = (a: string) => a.toLowerCase().replace(/[^a-z0-9]/g, '').includes(text.toLowerCase().replace(/[^a-z0-9]/g, '')) || text.toLowerCase().replace(/[^a-z0-9]/g, '').includes(a.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const anime = want === 'movie' ? null : (await searchMedia(text, 'ANIME').catch(() => []))[0] ?? null;
  const film = want === 'anime' || !hasMovies() ? null : (await searchMovies(text).catch(() => []))[0] ?? null;
  const animeOk = anime && (want === 'anime' || near(titleOf(anime)) || near(anime.title.romaji ?? '') || !film);
  if (anime && (animeOk || !film)) {
    return { kind: 'anime', title: titleOf(anime), url: anime.siteUrl, image: anime.bannerImage ?? anime.coverImage?.large ?? undefined, thumb: anime.coverImage?.large ?? undefined, minutes: Math.min(180, Math.max(30, (anime.duration ?? 24) * 2 + 10)) };
  }
  if (film) return movieWhat(film.slug);
  return null;
}
async function movieWhat(slug: string): Promise<What | null> {
  const f = await details(slug).catch(() => null);
  if (!f) return null;
  return { kind: 'movie', title: `${f.title}${f.year ? ` (${f.year})` : ''}`, url: `https://trakt.tv/movies/${f.slug}`, image: f.fanart ?? undefined, thumb: f.poster ?? undefined, minutes: Math.min(240, (f.runtime ?? 120) + 15) };
}
async function animeWhat(id: number): Promise<What | null> {
  const [a] = await searchMedia(String(id), 'ANIME').catch(() => []);
  if (!a || a.id !== id) return null;
  return { kind: 'anime', title: titleOf(a), url: a.siteUrl, image: a.bannerImage ?? a.coverImage?.large ?? undefined, thumb: a.coverImage?.large ?? undefined, minutes: Math.min(180, Math.max(30, (a.duration ?? 24) * 2 + 10)) };
}

function view(p: Party, w: { url?: string; image?: string; thumb?: string; kind: What['kind'] } | null, store: Store) {
  const at = Math.floor(p.at / 1000);
  const room = roomOf(store, p.guild);
  const live = p.started || p.at <= Date.now() + 60_000;
  const e = card({
    kind: 'anDay', title: `🍿 ${p.title}`, emoji: '', gif: 'off', line: '',
    body: [
      live ? `**On now**${room ? ` in <#${room}>` : ''}` : `<t:${at}:F> · <t:${at}:R>${room ? ` in <#${room}>` : ''}`,
      `Hosted by <@${p.host}>`,
      p.going.length ? `In: ${p.going.map((u) => `<@${u}>`).join(' ')}` : 'Nobody in yet, press I\'m in and you get a ping when it starts.',
      '-# talk spoilers in the thread under this message',
    ].join('\n'),
  });
  if (w?.url) e.setURL(w.url);
  if (w?.image) e.setImage(w.image);
  if (w?.thumb) e.setThumbnail(w.thumb);
  const buttons: ButtonBuilder[] = [
    new ButtonBuilder().setCustomId(`wpj|${p.key}`).setLabel(`I'm in · ${p.going.length}`).setEmoji('🍿').setStyle(ButtonStyle.Success),
  ];
  if (room) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${p.guild}/${room}`).setLabel('Join the room'));
  if (p.event) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(`https://discord.com/events/${p.guild}/${p.event}`).setLabel('Event'));
  return { embeds: [e], components: [row(...buttons)] };
}

// the event sits in the Watch Party voice room when there is one, so the server's event list shows where to go
async function makeEvent(guild: Guild, store: Store, title: string, at: number, minutes: number, host: string, w: What) {
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageEvents)) return null;
  const room = roomOf(store, guild.id);
  const start = Math.max(at, Date.now() + 30_000);
  const base = {
    name: `🍿 ${title} watch party`.slice(0, 100), scheduledStartTime: start, privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    description: `Hosted by ${guild.members.cache.get(host)?.displayName ?? 'someone'}.${w.url ? ` ${w.url}` : ''}`.slice(0, 1000), image: w.image ?? undefined,
  };
  const ev = room
    ? await guild.scheduledEvents.create({ ...base, entityType: GuildScheduledEventEntityType.Voice, channel: room }).catch(() => null)
    : await guild.scheduledEvents.create({ ...base, scheduledEndTime: start + minutes * 60_000, entityType: GuildScheduledEventEntityType.External, entityMetadata: { location: 'here' } }).catch(() => null);
  // a party that starts now starts the event too
  if (ev && at <= Date.now() + 60_000) setTimeout(() => void ev.setStatus(GuildScheduledEventStatus.Active).catch(() => {}), 35_000);
  return ev;
}

// one party: the card in the channel, the event, the thread, and the people with it on their list pinged
export async function startParty(store: Store, guild: Guild, channelId: string, host: string, w: What, at: number) {
  const ch = await guild.channels.fetch(channelId).catch(() => null);
  if (!ch?.isSendable()) return null;
  const p: Party = { key: `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, guild: guild.id, host, title: w.title, at, going: [host], channel: channelId };
  const ev = await makeEvent(guild, store, w.title, at, w.minutes, host, w);
  if (ev) p.event = ev.id;
  const fans = (w.fans ?? []).filter((u) => u !== host && guild.members.cache.has(u)).slice(0, 20);
  const extra = track(store, guild.id, host, 'watchparty');
  const content = [fans.length ? `${fans.map((u) => `<@${u}>`).join(' ')} it's on your list, come watch` : null, ...extra].filter(Boolean).join('\n') || undefined;
  const msg = await ch.send({ content, ...view(p, w, store), allowedMentions: { users: [...fans, host] } }).catch(() => null);
  if (!msg) return null;
  p.message = msg.id;
  const thread = await msg.startThread({ name: `💬 ${w.title} spoilers`.slice(0, 100), autoArchiveDuration: 1440 }).catch(() => null);
  if (thread) p.thread = thread.id;
  store.setKv(`wpart:${p.key}`, JSON.stringify({ url: w.url, image: w.image, thumb: w.thumb, kind: w.kind }));
  if (at <= Date.now() + 60_000) p.started = true;
  save(store, p);
  return p;
}
const artOf = (store: Store, key: string) => JSON.parse(store.getKv(`wpart:${key}`) ?? 'null') as { url?: string; image?: string; thumb?: string; kind: What['kind'] } | null;

// "now", nothing, "in 2h", "21:00", "tomorrow 20:30"
function when(raw: string, tz: string): number | null {
  const t = raw.trim().toLowerCase();
  if (!t || t === 'now' || t === 'rn' || t === 'right now') return Date.now();
  return parseWhen(raw, tz);
}

export const watchparty: Command = {
  name: 'watchparty',
  group: 'anime',
  data: new SlashCommandBuilder().setName('watchparty').setDescription('Start a watch party for an anime, a movie or just the room, now or later')
    .addStringOption((o) => o.setName('what').setDescription('An anime or a movie title, or leave empty for an open room').setMaxLength(100))
    .addStringOption((o) => o.setName('when').setDescription('now (default), in 2h, 21:00, tomorrow 20:30'))
    .addStringOption((o) => o.setName('kind').setDescription('If the title could be both').addChoices({ name: 'Anime', value: 'anime' }, { name: 'Movie', value: 'movie' })).toJSON(),
  text: { aliases: ['wp', 'party'], args: ['what'] },
  hint: '`{p} wp` · `{p} wp frieren` · `{p} wp movie interstellar`\n-# starts one now in the Watch Party room\n`{p} wp 21:00 frieren` · `{p} wp in 2h movie dune`\n-# plans one for later, everyone who presses I\'m in gets pinged when it starts',
  run: async (ctx, store) => {
    if (!ctx.guild || !ctx.guildId) return ctx.reply('Watch parties live in servers.');
    const tz = store.settings(ctx.userId).timezone || 'Asia/Kolkata';
    let what = (ctx.str('what') ?? '').trim();
    let at: number | null = Date.now();
    if (ctx.viaText) {
      // typed: the time comes first if there is one, "in 2h", "tomorrow 21:00", "21:00" or "now"
      const m = /^(now|in\s+\S+|tomorrow\s+\S+|today\s+\S+|\d{1,2}(?::\d{2})?\s*(?:am|pm)?|<t:\d+(?::\w)?>)(?:\s+|$)(.*)$/i.exec(what);
      if (m && (m[1].toLowerCase() === 'now' || parseWhen(m[1], tz))) { at = when(m[1], tz); what = m[2].trim(); }
    } else if (ctx.str('when')) {
      at = when(ctx.str('when')!, tz);
    }
    if (!at || at < Date.now() - 60_000) return ctx.reply({ content: 'I couldn\'t read that time. Try `now`, `in 2h`, `21:00` or `tomorrow 20:30`.', temp: true });
    let w: What | null = { kind: 'room', title: 'Watch party', minutes: 120 };
    if (what) {
      w = await find(what, (ctx.str('kind') as 'anime' | 'movie' | null) ?? undefined);
      if (!w) return ctx.reply({ content: `Nothing called **${what}** on AniList or Trakt. Try the original title.`, temp: true });
      if (w.kind === 'anime') {
        const [a] = await searchMedia(what.replace(/^(anime)\s+/i, ''), 'ANIME').catch(() => []);
        if (a) w.fans = store.watchersOf(a.id);
      }
    }
    const p = await startParty(store, ctx.guild, ctx.channelId, ctx.userId, w, at);
    if (!p) return ctx.reply({ content: 'I can\'t post here. Try it in a channel I can talk in.', temp: true });
    if (!ctx.viaText) return ctx.reply({ content: `🍿 Party's up${p.event ? ', with an event in the server\'s list' : ''}.`, temp: true });
  },
};

// a 🍿 Watch party button on a movie or anime card asks when, then starts it
export const partyButton = (kind: 'movie' | 'anime', id: string | number) =>
  new ButtonBuilder().setCustomId(`wpn|${kind}|${id}`.slice(0, 100)).setLabel('Watch party').setEmoji('🍿').setStyle(ButtonStyle.Secondary);

export async function onWatchparty(store: Store, i: Interaction): Promise<boolean> {
  if (i.isButton() && i.customId.startsWith('wpn|')) {
    const [, kind, id] = i.customId.split('|');
    const modal = new ModalBuilder().setCustomId(`wpm|${kind}|${id}`.slice(0, 100)).setTitle('Watch party').addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('when').setLabel('When?').setPlaceholder('now, in 2h, 21:00, tomorrow 20:30').setValue('now').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40)),
    );
    await i.showModal(modal).catch(() => {});
    return true;
  }
  if (i.isModalSubmit() && i.customId.startsWith('wpm|')) {
    const [, kind, id] = i.customId.split('|');
    if (!i.guild || !i.channelId) return true;
    const at = when(i.fields.getTextInputValue('when'), store.settings(i.user.id).timezone || 'Asia/Kolkata');
    if (!at || at < Date.now() - 60_000) { await i.reply({ content: 'I couldn\'t read that time. Try `now`, `in 2h`, `21:00` or `tomorrow 20:30`.', flags: MessageFlags.Ephemeral }); return true; }
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const w = kind === 'movie' ? await movieWhat(id) : await animeWhat(Number(id));
    if (!w) { await i.editReply('Couldn\'t look that up right now, try again in a moment.'); return true; }
    if (kind === 'anime') w.fans = store.watchersOf(Number(id));
    const p = await startParty(store, i.guild, i.channelId, i.user.id, w, at);
    await i.editReply(p ? `🍿 Party's up${p.event ? ', with an event in the server\'s list' : ''}.` : 'I can\'t post in this channel.');
    return true;
  }
  if (i.isButton() && i.customId.startsWith('wpj|')) {
    const p = load(store, i.customId.slice(4));
    if (!p) { await i.reply({ content: 'That party is over.', flags: MessageFlags.Ephemeral }); return true; }
    // pressing again drops out, the host stays in
    if (p.going.includes(i.user.id) && i.user.id !== p.host) p.going = p.going.filter((u) => u !== i.user.id);
    else if (!p.going.includes(i.user.id)) p.going.push(i.user.id);
    save(store, p);
    await i.update(view(p, artOf(store, p.key), store)).catch(() => {});
    return true;
  }
  return false;
}

// a party that was planned for later pings everyone who's in, in its thread, when it starts
export function startPartyClock(client: Client, store: Store) {
  const tick = async () => {
    for (const { key, value } of store.kvByPrefix('wparty:')) {
      const p = JSON.parse(value) as Party;
      if (Date.now() > p.at + 8 * 3600_000) { store.setKv(key, null); store.setKv(`wpart:${p.key}`, null); continue; }
      if (p.started || p.at > Date.now()) continue;
      p.started = true;
      save(store, p);
      const guild = client.guilds.cache.get(p.guild);
      if (!guild) continue;
      const room = roomOf(store, p.guild);
      const where = (p.thread && await guild.channels.fetch(p.thread).catch(() => null)) || await guild.channels.fetch(p.channel).catch(() => null);
      if (where?.isSendable()) await where.send({ content: `🍿 **${p.title}** is starting${room ? ` in <#${room}>` : ''}! ${p.going.map((u) => `<@${u}>`).join(' ')}`, allowedMentions: { users: p.going } }).catch(() => {});
      if (p.event) await guild.scheduledEvents.edit(p.event, { status: GuildScheduledEventStatus.Active }).catch(() => {});
      const ch = await guild.channels.fetch(p.channel).catch(() => null);
      if (ch && ch.type !== ChannelType.GuildCategory && 'messages' in ch && p.message) {
        const msg = await ch.messages.fetch(p.message).catch(() => null);
        await msg?.edit(view(p, artOf(store, p.key), store)).catch(() => {});
      }
    }
  };
  setTimeout(() => void tick(), 60_000);
  setInterval(() => void tick(), 60_000);
}
