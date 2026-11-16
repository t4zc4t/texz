import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus, MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
  type Client, type Guild, type Interaction, type Message, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Store } from '../db.js';
import type { Command } from '../core/module.js';
import { mediaById, searchMedia, titleOf, type Media } from '../anime/anilist.js';
import { details, hasMovies, search as searchMovies, type Film } from '../anime/trakt.js';
import { card } from '../theme.js';
import { parseWhen } from './server.js';
import { track } from './missions.js';

// a watch party for an anime, a movie or just the room: a server event in the Watch Party voice room,
// an I'm in button, a ping for everyone in when it starts, and a spoiler thread under it

interface What { kind: 'anime' | 'movie' | 'room'; title: string; url?: string; image?: string; thumb?: string; minutes: number; fans?: string[] }
interface Party { key: string; guild: string; host: string; title: string; at: number; going: string[]; channel: string; message?: string; thread?: string; event?: string; started?: boolean; cancelled?: boolean }

const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);
const partyKey = (k: string) => `wparty:${k}`;
const load = (store: Store, k: string) => JSON.parse(store.getKv(partyKey(k)) ?? 'null') as Party | null;
const save = (store: Store, p: Party) => store.setKv(partyKey(p.key), JSON.stringify(p));
const roomOf = (store: Store, g: string) => store.getKv(`voice:${g}:watch`);

// everything a title could mean, anime from AniList and movies from Trakt, for the host to pick from
interface Choice { value: string; label: string; description: string }
const animeChoice = (m: Media): Choice => ({ value: `a:${m.id}`, label: `${titleOf(m)}`.slice(0, 100), description: ['Anime', ({ TV: 'TV', TV_SHORT: 'TV short', MOVIE: 'film', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'special', MUSIC: 'music' } as Record<string, string>)[m.format ?? ''] ?? null, m.seasonYear ?? m.startDate?.year, m.episodes && m.episodes > 1 ? `${m.episodes} eps` : null].filter(Boolean).join(' · ').slice(0, 100) });
const movieChoice = (f: Film): Choice => ({ value: `m:${f.slug}`.slice(0, 100), label: f.title.slice(0, 100), description: ['Movie', f.year, f.runtime ? `${f.runtime} min` : null, f.votes ? `⭐ ${f.rating.toFixed(1)}` : null].filter(Boolean).join(' · ').slice(0, 100) });
export async function choices(q: string, prefer?: 'anime' | 'movie'): Promise<Choice[]> {
  const m = /^(movie|film|anime)\s+(.+)/i.exec(q);
  const want = m ? (m[1].toLowerCase() === 'anime' ? 'anime' : 'movie') : prefer;
  const text = m ? m[2] : q;
  const [anime, films] = await Promise.all([
    want === 'movie' ? [] : searchMedia(text, 'ANIME').catch(() => [] as Media[]),
    want === 'anime' || !hasMovies() ? [] : searchMovies(text).catch(() => [] as Film[]),
  ]);
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const exact = (t: string) => key(t) === key(text);
  const all = [...anime.map((a) => ({ c: animeChoice(a), hit: exact(titleOf(a)) || exact(a.title.romaji ?? '') })), ...films.slice(0, 8).map((f) => ({ c: movieChoice(f), hit: exact(f.title) }))];
  // exact titles first, then the two sources taking turns so neither buries the other
  const hits = all.filter((x) => x.hit).map((x) => x.c);
  const rest = all.filter((x) => !x.hit).map((x) => x.c);
  const as = rest.filter((c) => c.value.startsWith('a:')), ms = rest.filter((c) => c.value.startsWith('m:'));
  const mixed: Choice[] = [];
  for (let n = 0; n < Math.max(as.length, ms.length); n++) { if (as[n]) mixed.push(as[n]); if (ms[n]) mixed.push(ms[n]); }
  const seen = new Set<string>();
  return [...hits, ...mixed].filter((c) => !seen.has(c.value) && seen.add(c.value)).slice(0, 25);
}
const whatOf = (value: string) => (value.startsWith('m:') ? movieWhat(value.slice(2)) : animeWhat(Number(value.slice(2))));
async function movieWhat(slug: string): Promise<What | null> {
  const f = await details(slug).catch(() => null);
  if (!f) return null;
  return { kind: 'movie', title: `${f.title}${f.year ? ` (${f.year})` : ''}`, url: `https://trakt.tv/movies/${f.slug}`, image: f.fanart ?? undefined, thumb: f.poster ?? undefined, minutes: Math.min(240, (f.runtime ?? 120) + 15) };
}
async function animeWhat(id: number): Promise<What | null> {
  const a = await mediaById(id).catch(() => null);
  if (!a) return null;
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
  if (p.cancelled) {
    e.setDescription(`~~${p.title}~~\n**Called off** by <@${p.host}>.`).setColor(0x5c5f66).setImage(null);
    return { embeds: [e], components: [] };
  }
  const buttons: ButtonBuilder[] = [
    new ButtonBuilder().setCustomId(`wpj|${p.key}`).setLabel(`I'm in · ${p.going.length}`).setEmoji('🍿').setStyle(ButtonStyle.Success),
  ];
  if (room) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${p.guild}/${room}`).setLabel('Join the room'));
  if (p.event) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(`https://discord.com/events/${p.guild}/${p.event}`).setLabel('Event'));
  buttons.push(new ButtonBuilder().setCustomId(`wpx|${p.key}`).setLabel('Call it off').setStyle(ButtonStyle.Danger));
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
export async function startParty(store: Store, guild: Guild, channelId: string, host: string, w: What, at: number, over?: Message) {
  const ch = await guild.channels.fetch(channelId).catch(() => null);
  if (!ch?.isSendable()) return null;
  const p: Party = { key: `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, guild: guild.id, host, title: w.title, at, going: [host], channel: channelId };
  const ev = await makeEvent(guild, store, w.title, at, w.minutes, host, w);
  if (ev) p.event = ev.id;
  const fans = (w.fans ?? []).filter((u) => u !== host && guild.members.cache.has(u)).slice(0, 20);
  const extra = track(store, guild.id, host, 'watchparty');
  const content = [fans.length ? `${fans.map((u) => `<@${u}>`).join(' ')} it's on your list, come watch` : null, ...extra].filter(Boolean).join('\n') || undefined;
  const msg = over
    ? await over.edit({ content: content ?? '', ...view(p, w, store), allowedMentions: { users: [...fans, host] } }).catch(() => null)
    : await ch.send({ content, ...view(p, w, store), allowedMentions: { users: [...fans, host] } }).catch(() => null);
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

// a host's pick list waiting for an answer
const picks = new Map<string, { host: string; at: number; channel: string; made: number }>();

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
    const w: What = { kind: 'room', title: 'Watch party', minutes: 120 };
    if (!what) {
      const p = await startParty(store, ctx.guild, ctx.channelId, ctx.userId, w, at);
      if (!p) return ctx.reply({ content: 'I can\'t post here. Try it in a channel I can talk in.', temp: true });
      if (!ctx.viaText) return ctx.reply({ content: `🍿 Party's up${p.event ? ', with an event in the server\'s list' : ''}.`, temp: true });
      return;
    }
    // a title gets a pick list, the top search result is wrong too often to just take it
    const list = await choices(what, (ctx.str('kind') as 'anime' | 'movie' | null) ?? undefined);
    if (!list.length) return ctx.reply({ content: `Nothing called **${what}** on AniList or Trakt. Try the original title.`, temp: true });
    const key = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    picks.set(key, { host: ctx.userId, at, channel: ctx.channelId, made: Date.now() });
    const at2 = at <= Date.now() + 60_000 ? 'now' : `<t:${Math.floor(at / 1000)}:F>`;
    return ctx.reply({
      embeds: [card({ kind: 'anDay', title: '🍿 Which one?', emoji: '', gif: 'off', line: '', body: `Watch party ${at2} for **${what}**. Pick the right one below.` })],
      components: [
        row(new StringSelectMenuBuilder().setCustomId(`wps|${key}`).setPlaceholder('Pick the anime or movie').addOptions(list.map((c) => ({ ...c, emoji: c.value.startsWith('a:') ? '📺' : '🎬' })))),
        row(new ButtonBuilder().setCustomId(`wpq|${key}`).setLabel('Never mind').setStyle(ButtonStyle.Secondary)),
      ],
      public: true, temp: false,
    });
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
  if ((i.isStringSelectMenu() && i.customId.startsWith('wps|')) || (i.isButton() && i.customId.startsWith('wpq|'))) {
    const key = i.customId.slice(4);
    const pk = picks.get(key);
    if (!pk || Date.now() - pk.made > 15 * 60_000) { picks.delete(key); await i.update({ content: 'That pick list ran out, start again with `tz wp`.', embeds: [], components: [] }).catch(() => {}); return true; }
    if (i.user.id !== pk.host) { await i.reply({ content: 'Only the host picks. Start your own with `tz wp`.', flags: MessageFlags.Ephemeral }); return true; }
    picks.delete(key);
    if (i.isButton()) { await i.update({ content: 'No party then.', embeds: [], components: [] }).catch(() => {}); return true; }
    await i.deferUpdate();
    const w = await whatOf(i.values[0]);
    if (!w || !i.guild) { await i.editReply({ content: 'Couldn\'t look that one up right now, try again.', embeds: [], components: [] }).catch(() => {}); return true; }
    if (w.kind === 'anime') w.fans = store.watchersOf(Number(i.values[0].slice(2)));
    const p = await startParty(store, i.guild, pk.channel, pk.host, w, Math.max(pk.at, Date.now()), i.message);
    if (!p) await i.editReply({ content: 'I can\'t post in this channel.', embeds: [], components: [] }).catch(() => {});
    return true;
  }
  // the host, or staff tidying up, can call a party off: the card says so, the event goes, nobody gets pinged
  if (i.isButton() && i.customId.startsWith('wpx|')) {
    const p = load(store, i.customId.slice(4));
    if (!p || p.cancelled) { await i.update({ components: [] }).catch(() => {}); return true; }
    const staff = i.memberPermissions?.has(PermissionFlagsBits.ManageEvents) ?? false;
    if (i.user.id !== p.host && !staff) { await i.reply({ content: 'Only the host can call it off.', flags: MessageFlags.Ephemeral }); return true; }
    p.cancelled = true;
    p.started = true;
    save(store, p);
    if (p.event && i.guild) await i.guild.scheduledEvents.delete(p.event).catch(() => {});
    await i.update(view(p, artOf(store, p.key), store)).catch(() => {});
    if (p.thread && i.guild) {
      const t = await i.guild.channels.fetch(p.thread).catch(() => null);
      if (t?.isThread()) { await t.send(`🍿 Called off by <@${p.host}>.`).catch(() => {}); await t.setArchived(true).catch(() => {}); }
    }
    return true;
  }
  if (i.isButton() && i.customId.startsWith('wpj|')) {
    const p = load(store, i.customId.slice(4));
    if (!p || p.cancelled) { await i.reply({ content: 'That party is over.', flags: MessageFlags.Ephemeral }); return true; }
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
