import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder, StringSelectMenuBuilder,
  type Interaction, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Store } from '../db.js';
import type { Command } from '../core/module.js';
import { card } from '../theme.js';
import { GENRES, details, genreName, hasMovies, people, pickSome, search, similar, type Film, type Filters } from '../anime/trakt.js';

// movie nights: look a film up, get ones like it, or let the picker roll one (or three for a vote) from the filters you set

const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);
const year = (f: Film) => f.year ?? '?';
const hm = (min: number | null) => (min ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : null);
const LANGS: [string, string][] = [['', 'Any language'], ['en', 'English'], ['hi', 'Hindi'], ['ja', 'Japanese'], ['ko', 'Korean'], ['ta', 'Tamil'], ['te', 'Telugu'], ['fr', 'French'], ['es', 'Spanish'], ['zh', 'Chinese']];
const DECADES: [number, string][] = [[0, 'Any time'], [2020, '2020s'], [2010, '2010s'], [2000, '2000s'], [1990, '1990s'], [1980, '1980s'], [1900, 'Older classics']];
const SCORES: [number, string][] = [[0, 'Any score'], [6, '6 and up'], [7, '7 and up'], [8, '8 and up']];
const LENGTHS: Record<Filters['length'], string> = { any: 'Any length', short: 'Under 100 minutes', long: 'Over 140 minutes' };

const nokey = 'Movies need a Trakt Client ID in `.env` (`TRAKT_ID`), the bot owner can make one free at developer.trakt.tv.';

// the filters ride along in the button ids, so nothing has to be stored
const pack = (f: Filters) => `g=${f.genres.join('.')};d=${f.decade ?? ''};s=${f.score};l=${f.lang ?? ''};n=${f.length}`;
function unpack(s: string): Filters {
  const m = Object.fromEntries(s.split(';').map((x) => x.split('=')));
  return { genres: (m.g ?? '').split('.').filter(Boolean), decade: m.d ? Number(m.d) : null, score: Number(m.s ?? 0), lang: m.l || null, length: (m.n as Filters['length']) || 'any' };
}
const describe = (f: Filters) => [
  f.genres.length ? f.genres.map(genreName).join(' + ') : 'any genre',
  DECADES.find(([d]) => d === (f.decade ?? 0))?.[1],
  f.score ? `⭐ ${f.score}+` : null,
  f.lang ? LANGS.find(([l]) => l === f.lang)?.[1] : null,
  f.length !== 'any' ? LENGTHS[f.length].toLowerCase() : null,
].filter(Boolean).join(' · ');

// extra buttons ride on the card, like going back to the list it came from or rolling again
export async function movieCard(slug: string, extra: ButtonBuilder[] = []) {
  const [m, who] = await Promise.all([details(slug), people(slug).catch(() => ({ director: null, cast: [] as string[] }))]);
  const story = m.overview.length > 380 ? `${m.overview.slice(0, 380).replace(/\s+\S*$/, '')}…` : m.overview;
  const e = card({
    kind: 'anime', title: `${m.title} (${year(m)})`, gif: 'off', line: '', color: m.color ?? 0xc8283c,
    body: [
      m.tagline ? `*${m.tagline}*` : null,
      story || null,
      '',
      [m.votes ? `⭐ **${m.rating.toFixed(1)}** (${m.votes.toLocaleString()})` : '⭐ unrated', hm(m.runtime) ? `⏱️ ${hm(m.runtime)}` : null, m.certification ? `🔖 ${m.certification}` : null, m.genres.length ? `🎭 ${m.genres.slice(0, 3).map(genreName).join(', ')}` : null].filter(Boolean).join('  ·  '),
      [who.director ? `🎬 ${who.director}` : null, who.cast.length ? `👥 ${who.cast.join(', ')}` : null].filter(Boolean).join('  ·  ') || null,
    ].filter((x) => x !== null).join('\n'),
  }).setURL(`https://trakt.tv/movies/${m.slug}`).setFooter({ text: 'Movie data from Trakt' });
  if (m.original) e.setAuthor({ name: m.original });
  if (m.poster) e.setThumbnail(m.poster);
  if (m.fanart) e.setImage(m.fanart);
  const buttons = [new ButtonBuilder().setCustomId(`mvl|${m.slug}`.slice(0, 100)).setLabel('More like this').setStyle(ButtonStyle.Secondary)];
  if (m.trailer) buttons.unshift(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(m.trailer).setLabel('Trailer'));
  buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(`https://www.justwatch.com/in/search?q=${encodeURIComponent(m.title)}`).setLabel('Where to watch'));
  return { content: '', embeds: [e], components: extra.length ? [row(...buttons), row(...extra)] : [row(...buttons)] };
}

// a list keeps where it came from in its menu, so opening one and pressing Back rebuilds the same list in the same message
const listOf = (title: string, films: Film[], from: string, extra: ButtonBuilder[] = []) => {
  const e = new EmbedBuilder().setColor(0xc8283c).setTitle(title).setFooter({ text: 'Movie data from Trakt' })
    .setDescription(films.map((f, n) => `**${n + 1}. ${f.title}** (${year(f)})\n-# ${[f.votes ? `⭐ ${f.rating.toFixed(1)}` : null, hm(f.runtime), f.genres.slice(0, 3).map(genreName).join(', ')].filter(Boolean).join(' · ')}`).join('\n'));
  if (films[0]?.fanart) e.setImage(films[0].fanart);
  const menu = new StringSelectMenuBuilder().setCustomId(`mvo|${from}`.slice(0, 100)).setPlaceholder('Open one').addOptions(films.slice(0, 25).map((f) => ({ label: `${f.title} (${year(f)})`.slice(0, 100), value: f.slug.slice(0, 100) })));
  return { content: '', embeds: [e], components: extra.length ? [row(menu), row(...extra)] : [row(menu)] };
};
const backTo = (id: string, label = 'Back') => new ButtonBuilder().setCustomId(id.slice(0, 100)).setLabel(label).setStyle(ButtonStyle.Secondary);

// the picker panel, only its owner changes the filters
function picker(owner: string, f: Filters) {
  const st = pack(f);
  return {
    embeds: [card({ kind: 'help', title: 'Movie night', emoji: '🎬', gif: 'off', line: '',
      body: `Set what the room is in the mood for, then roll one or put three to a vote.\n\n**Looking for** ${describe(f)}` })],
    components: [
      row(new StringSelectMenuBuilder().setCustomId(`mvp|${owner}|g|${st}`).setPlaceholder('Genres, up to three').setMinValues(0).setMaxValues(3)
        .addOptions(GENRES.map(([id, name]) => ({ label: name, value: id, default: f.genres.includes(id) })))),
      row(new StringSelectMenuBuilder().setCustomId(`mvp|${owner}|d|${st}`).setPlaceholder('When')
        .addOptions(DECADES.map(([d, name]) => ({ label: name, value: String(d), default: (f.decade ?? 0) === d })))),
      row(new StringSelectMenuBuilder().setCustomId(`mvp|${owner}|l|${st}`).setPlaceholder('Language')
        .addOptions(LANGS.map(([l, name]) => ({ label: name, value: l || 'any', default: (f.lang ?? '') === l })))),
      row(new StringSelectMenuBuilder().setCustomId(`mvp|${owner}|s|${st}`).setPlaceholder('Score and length').setMinValues(0).setMaxValues(2).addOptions(
        ...SCORES.map(([n, name]) => ({ label: name, value: `s${n}`, default: f.score === n })),
        ...(Object.entries(LENGTHS) as [Filters['length'], string][]).map(([k, name]) => ({ label: name, value: `n${k}`, default: f.length === k })),
      )),
      row(
        new ButtonBuilder().setCustomId(`mvp|${owner}|roll|${st}`).setLabel('Roll one').setEmoji('🎲').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`mvp|${owner}|vote|${st}`).setLabel('Three to a vote').setEmoji('🗳️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`mvp|${owner}|list|${st}`).setLabel('Show ten').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`mvp|${owner}|reset|g=;d=;s=0;l=;n=any`).setLabel('Clear').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export const movie: Command = {
  name: 'movie',
  data: new SlashCommandBuilder().setName('movie').setDescription('Find a movie, get ones like it, or open the movie night picker')
    .addStringOption((o) => o.setName('title').setDescription('A title, "like <title>" for similar ones, or empty for the picker').setMaxLength(100)).toJSON(),
  text: { aliases: ['movies', 'film', 'mv'], args: ['title'] },
  hint: '`{p} movie` · `/anime view:movie`\n-# opens the movie night picker: genres, decade, language, score and length, then roll one, show ten or put three to a vote\n`{p} movie inception` · `{p} movie like interstellar`\n-# look one up with its trailer, cast and where to watch, or get ones like it',
  run: async (ctx) => {
    if (!hasMovies()) return ctx.reply({ content: nokey, temp: true });
    const q = (ctx.str('title') ?? '').trim();
    if (!q || q === 'pick' || q === 'night') return ctx.reply({ ...picker(ctx.userId, { genres: [], decade: null, score: 0, lang: null, length: 'any' }), public: true });
    const like = /^like\s+(.+)/i.exec(q);
    const found = await search(like ? like[1] : q).catch(() => []);
    if (!found.length) return ctx.reply({ content: `Nothing called "${like ? like[1] : q}". Try the original title or fewer words.`, temp: true });
    if (like) {
      const recs = (await similar(found[0].slug).catch(() => [])).slice(0, 10);
      if (!recs.length) return ctx.reply({ content: `Trakt has nothing like ${found[0].title} yet.`, temp: true });
      return ctx.reply({ ...listOf(`If you liked ${found[0].title}`, recs, `mvl|${found[0].slug}`), public: true });
    }
    // an exact title opens straight away, otherwise a short list to pick from
    const exact = found.find((f) => f.title.toLowerCase() === q.toLowerCase()) ?? (found.length === 1 ? found[0] : null);
    if (exact) return ctx.reply({ ...(await movieCard(exact.slug)), public: true });
    return ctx.reply({ ...listOf(`Movies matching "${q}"`, found.slice(0, 8), `mvs|${q.slice(0, 60)}`), public: true });
  },
};

// everything edits the message it was pressed on, nothing posts a new one
export async function onMovie(store: Store, i: Interaction): Promise<boolean> {
  if (!(i.isButton() || i.isStringSelectMenu())) return false;
  const id = i.customId;
  if (!id.startsWith('mv')) return false;
  if (!hasMovies()) { await i.reply({ content: nokey, flags: MessageFlags.Ephemeral }); return true; }
  const fail = () => i.editReply({ content: 'Trakt didn\'t answer, try again in a moment.' }).catch(() => {});
  // open one from a list, with Back to that list
  if (id.startsWith('mvo|') && i.isStringSelectMenu()) {
    await i.deferUpdate();
    const from = id.slice(4);
    await i.editReply(await movieCard(i.values[0], [backTo(from, 'Back to the list')])).catch(fail);
    return true;
  }
  // more like this, or a search list rebuilt for Back
  if (id.startsWith('mvl|') || id.startsWith('mvs|')) {
    await i.deferUpdate();
    const arg = id.slice(4);
    if (id.startsWith('mvl|')) {
      const recs = (await similar(arg).catch(() => [])).slice(0, 10);
      if (!recs.length) { await i.followUp({ content: 'Nothing similar on Trakt yet.', flags: MessageFlags.Ephemeral }); return true; }
      await i.editReply(listOf('More like this', recs, id, [backTo(`mvc|${arg}`, 'Back to the movie')])).catch(fail);
    } else {
      const found = (await search(arg).catch(() => [])).slice(0, 8);
      await i.editReply(listOf(`Movies matching "${arg}"`, found, id)).catch(fail);
    }
    return true;
  }
  if (id.startsWith('mvc|')) {
    await i.deferUpdate();
    await i.editReply(await movieCard(id.slice(4))).catch(fail);
    return true;
  }
  // a vote on the same message: one pick each, changing your mind moves it
  if (id.startsWith('mvv|')) {
    const n = id.split('|')[1];
    const key = `mvvote:${i.message.id}`;
    const votes = JSON.parse(store.getKv(key) ?? '{}') as Record<string, number>;
    votes[i.user.id] = Number(n);
    store.setKv(key, JSON.stringify(votes));
    const counts = [0, 0, 0];
    for (const v of Object.values(votes)) counts[v]++;
    const rows = i.message.components.map((r) => ActionRowBuilder.from(r as never) as ActionRowBuilder<ButtonBuilder>);
    for (const b of rows[1]?.components ?? []) {
      const at = Number((b.data as { custom_id?: string }).custom_id?.split('|')[1]);
      if (!Number.isNaN(at) && (b.data as { custom_id?: string }).custom_id?.startsWith('mvv|')) b.setLabel(`${(b.data as { label?: string }).label?.replace(/ · \d+$/, '')} · ${counts[at]}`);
    }
    await i.update({ components: rows as never }).catch(() => {});
    return true;
  }
  if (!id.startsWith('mvp|')) return false;
  const [, owner, what, st] = id.split('|');
  const f = unpack(st);
  if (i.user.id !== owner) { await i.reply({ content: 'This is someone else\'s movie night. Open your own with `tz movie`.', flags: MessageFlags.Ephemeral }); return true; }
  const panelBtn = backTo(`mvp|${owner}|panel|${st}`, 'Change filters');
  if (['roll', 'vote', 'list'].includes(what)) {
    await i.deferUpdate();
    const n = what === 'roll' ? 1 : what === 'vote' ? 3 : 10;
    const films = await pickSome(f, n).catch(() => [] as Film[]);
    if (!films.length) { await i.followUp({ content: `Nothing fits ${describe(f)}. Loosen a filter and try again.`, flags: MessageFlags.Ephemeral }); return true; }
    if (what === 'roll') {
      await i.editReply(await movieCard(films[0].slug, [new ButtonBuilder().setCustomId(`mvp|${owner}|roll|${st}`).setLabel('Roll again').setEmoji('🎲').setStyle(ButtonStyle.Primary), panelBtn])).catch(fail);
    } else if (what === 'list') {
      await i.editReply(listOf(`Ten for ${describe(f)}`, films, `mvp|${owner}|list|${st}`, [new ButtonBuilder().setCustomId(`mvp|${owner}|list|${st}`).setLabel('Another ten').setStyle(ButtonStyle.Primary), panelBtn])).catch(fail);
    } else {
      // the vote happens right on this message, a button per movie with its count
      const out = listOf('What are we watching? Vote below', films, `mvp|${owner}|vote|${st}`);
      const voteRow = row(...films.map((x, n) => new ButtonBuilder().setCustomId(`mvv|${n}|${x.slug}`.slice(0, 100)).setLabel(`${n + 1}. ${x.title}`.slice(0, 70) + ' · 0').setStyle(ButtonStyle.Secondary)));
      store.setKv(`mvvote:${i.message.id}`, null);
      await i.editReply({ ...out, components: [out.components[0], voteRow, row(new ButtonBuilder().setCustomId(`mvp|${owner}|vote|${st}`).setLabel('Three others').setStyle(ButtonStyle.Primary), panelBtn)] }).catch(fail);
    }
    return true;
  }
  if (what === 'g' && i.isStringSelectMenu()) f.genres = i.values;
  if (what === 'd' && i.isStringSelectMenu()) f.decade = Number(i.values[0]) || null;
  if (what === 'l' && i.isStringSelectMenu()) f.lang = i.values[0] === 'any' ? null : i.values[0];
  if (what === 's' && i.isStringSelectMenu()) for (const v of i.values) { if (v.startsWith('s')) f.score = Number(v.slice(1)); else f.length = v.slice(1) as Filters['length']; }
  await i.update({ content: '', ...picker(owner, what === 'reset' ? unpack('g=;d=;s=0;l=;n=any') : f) });
  return true;
}

// every evening a movie of the day lands in the Watch Party voice room's chat, a different mood each day of the week
const MOODS: string[][] = [['animation'], ['science-fiction'], ['thriller', 'mystery'], ['comedy'], ['action'], ['drama'], ['horror']];
export function startMovieDay(client: import('discord.js').Client, store: Store) {
  const tick = async () => {
    if (!hasMovies()) return;
    const now = new Date();
    // around 7 in the evening in India
    if (now.getUTCHours() * 60 + now.getUTCMinutes() < 13 * 60 + 30) return;
    const day = now.toISOString().slice(0, 10);
    for (const guild of client.guilds.cache.values()) {
      const id = store.getKv(`voice:${guild.id}:watch`);
      if (!id || !store.rules(guild.id, 'anime').enabled || !store.firstTime(guild.id, `movieday:${day}`)) continue;
      const ch = await guild.channels.fetch(id).catch(() => null);
      if (!ch?.isSendable()) continue;
      const mood = MOODS[now.getUTCDay()];
      const picks = await pickSome({ genres: mood, decade: null, score: 7, lang: null, length: 'any' }, 1).catch(() => [] as Film[]);
      if (!picks.length) continue;
      const out = await movieCard(picks[0].slug).catch(() => null);
      if (!out) continue;
      await ch.send({ ...out, content: `🎬 **Movie of the day** · ${mood.map(genreName).join(' and ')} night. Anyone in for a watch party? \`tz movie\` rolls something else.` }).catch(() => {});
    }
  };
  setTimeout(() => void tick(), 120_000);
  setInterval(() => void tick(), 15 * 60_000);
}
