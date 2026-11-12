import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder, StringSelectMenuBuilder,
  type Interaction, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Store } from '../db.js';
import type { Command } from '../core/module.js';
import { card } from '../theme.js';
import { GENRES, IMG, details, genreName, hasTmdb, pickSome, search, similar, type Film, type Filters } from '../anime/tmdb.js';

// movie nights: look a film up, get ones like it, or let the picker roll one (or three for a vote) from the filters you set

const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);
const year = (f: Film) => f.release_date?.slice(0, 4) || '?';
const hm = (min: number | null) => (min ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : null);
const LANGS: [string, string][] = [['', 'Any language'], ['en', 'English'], ['hi', 'Hindi'], ['ja', 'Japanese'], ['ko', 'Korean'], ['ta', 'Tamil'], ['te', 'Telugu'], ['fr', 'French'], ['es', 'Spanish'], ['zh', 'Chinese']];
const DECADES: [number, string][] = [[0, 'Any time'], [2020, '2020s'], [2010, '2010s'], [2000, '2000s'], [1990, '1990s'], [1980, '1980s'], [1900, 'Older classics']];
const SCORES: [number, string][] = [[0, 'Any score'], [6, '6 and up'], [7, '7 and up'], [8, '8 and up']];
const LENGTHS: Record<Filters['length'], string> = { any: 'Any length', short: 'Under 100 minutes', long: 'Over 140 minutes' };

const nokey = 'Movies need a free TMDB key in `.env` (`TMDB_TOKEN`), the bot owner can add one from themoviedb.org.';

// the filters ride along in the button ids, so nothing has to be stored
const pack = (f: Filters) => `g=${f.genres.join('.')};d=${f.decade ?? ''};s=${f.score};l=${f.lang ?? ''};n=${f.length}`;
function unpack(s: string): Filters {
  const m = Object.fromEntries(s.split(';').map((x) => x.split('=')));
  return { genres: (m.g ?? '').split('.').filter(Boolean).map(Number), decade: m.d ? Number(m.d) : null, score: Number(m.s ?? 0), lang: m.l || null, length: (m.n as Filters['length']) || 'any' };
}
const describe = (f: Filters) => [
  f.genres.length ? f.genres.map(genreName).join(' + ') : 'any genre',
  DECADES.find(([d]) => d === (f.decade ?? 0))?.[1],
  f.score ? `⭐ ${f.score}+` : null,
  f.lang ? LANGS.find(([l]) => l === f.lang)?.[1] : null,
  f.length !== 'any' ? LENGTHS[f.length].toLowerCase() : null,
].filter(Boolean).join(' · ');

export async function movieCard(id: number) {
  const m = await details(id);
  const director = m.credits?.crew.find((c) => c.job === 'Director')?.name;
  const cast = (m.credits?.cast ?? []).slice(0, 3).map((c) => c.name).join(', ');
  const here = m['watch/providers']?.results?.IN;
  const stream = here?.flatrate?.slice(0, 4).map((p) => p.provider_name).join(', ');
  const rent = !stream ? here?.rent?.slice(0, 3).map((p) => p.provider_name).join(', ') : null;
  const story = m.overview.length > 380 ? `${m.overview.slice(0, 380).replace(/\s+\S*$/, '')}…` : m.overview;
  const e = card({
    kind: 'anime', title: `${m.title} (${year(m)})`, gif: 'off', line: '', color: 0xc8283c,
    body: [
      m.tagline ? `*${m.tagline}*` : null,
      story || null,
      '',
      [m.vote_count ? `⭐ **${m.vote_average.toFixed(1)}** (${m.vote_count.toLocaleString()})` : '⭐ unrated', hm(m.runtime) ? `⏱️ ${hm(m.runtime)}` : null, m.genres.length ? `🎭 ${m.genres.slice(0, 3).map((g) => g.name).join(', ')}` : null].filter(Boolean).join('  ·  '),
      [director ? `🎬 ${director}` : null, cast ? `👥 ${cast}` : null].filter(Boolean).join('  ·  ') || null,
      stream ? `📺 Streaming in India on ${stream}` : rent ? `📺 Rent in India on ${rent}` : null,
    ].filter((x) => x !== null).join('\n'),
  }).setURL(`https://www.themoviedb.org/movie/${m.id}`).setFooter({ text: 'Movie data from TMDB' });
  if (m.original_title !== m.title) e.setAuthor({ name: m.original_title });
  if (m.poster_path) e.setThumbnail(`${IMG}/w342${m.poster_path}`);
  if (m.backdrop_path) e.setImage(`${IMG}/w780${m.backdrop_path}`);
  const trailer = m.videos?.results.find((v) => v.site === 'YouTube' && v.type === 'Trailer' && v.official) ?? m.videos?.results.find((v) => v.site === 'YouTube' && v.type === 'Trailer');
  const buttons = [new ButtonBuilder().setCustomId(`mvl|${m.id}`).setLabel('More like this').setStyle(ButtonStyle.Secondary)];
  if (trailer) buttons.unshift(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(`https://www.youtube.com/watch?v=${trailer.key}`).setLabel('Trailer'));
  if (here?.link) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(here.link).setLabel('Where to watch'));
  return { embeds: [e], components: [row(...buttons)] };
}

const listOf = (title: string, films: Film[]) => {
  const e = new EmbedBuilder().setColor(0xc8283c).setTitle(title).setFooter({ text: 'Movie data from TMDB' })
    .setDescription(films.map((f, n) => `**${n + 1}. ${f.title}** (${year(f)})\n-# ⭐ ${f.vote_average.toFixed(1)} · ${(f.genre_ids ?? []).slice(0, 3).map(genreName).filter(Boolean).join(', ')}`).join('\n'));
  if (films[0]?.backdrop_path) e.setImage(`${IMG}/w780${films[0].backdrop_path}`);
  const menu = new StringSelectMenuBuilder().setCustomId('mvo').setPlaceholder('Open one').addOptions(films.slice(0, 25).map((f) => ({ label: `${f.title} (${year(f)})`.slice(0, 100), value: String(f.id) })));
  return { embeds: [e], components: [row(menu)] };
};

// the picker panel, only its owner changes the filters
function picker(owner: string, f: Filters) {
  const st = pack(f);
  return {
    embeds: [card({ kind: 'help', title: 'Movie night', emoji: '🎬', gif: 'off', line: '',
      body: `Set what the room is in the mood for, then roll one or put three to a vote.\n\n**Looking for** ${describe(f)}` })],
    components: [
      row(new StringSelectMenuBuilder().setCustomId(`mvp|${owner}|g|${st}`).setPlaceholder('Genres, up to three').setMinValues(0).setMaxValues(3)
        .addOptions(GENRES.map(([id, name]) => ({ label: name, value: String(id), default: f.genres.includes(id) })))),
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
  hint: '`{p} movie` · `/anime view:movie`\n-# opens the movie night picker: genres, decade, language, score and length, then roll one, show ten or put three to a vote\n`{p} movie inception` · `{p} movie like interstellar`\n-# look one up with its trailer and where to watch in India, or get ones like it',
  run: async (ctx) => {
    if (!hasTmdb()) return ctx.reply({ content: nokey, temp: true });
    const q = (ctx.str('title') ?? '').trim();
    if (!q || q === 'pick' || q === 'night') return ctx.reply({ ...picker(ctx.userId, { genres: [], decade: null, score: 0, lang: null, length: 'any' }), public: true });
    const like = /^like\s+(.+)/i.exec(q);
    const found = await search(like ? like[1] : q).catch(() => []);
    if (!found.length) return ctx.reply({ content: `Nothing called "${like ? like[1] : q}". Try the original title or fewer words.`, temp: true });
    if (like) {
      const recs = (await similar(found[0].id).catch(() => [])).slice(0, 10);
      if (!recs.length) return ctx.reply({ content: `TMDB has nothing like ${found[0].title} yet.`, temp: true });
      return ctx.reply({ ...listOf(`If you liked ${found[0].title}`, recs), public: true });
    }
    // an exact title opens straight away, otherwise a short list to pick from
    const exact = found.find((f) => f.title.toLowerCase() === q.toLowerCase()) ?? (found.length === 1 ? found[0] : null);
    if (exact) return ctx.reply({ ...(await movieCard(exact.id)), public: true });
    return ctx.reply({ ...listOf(`Movies matching "${q}"`, found.slice(0, 8)), public: true });
  },
};

export async function onMovie(store: Store, i: Interaction): Promise<boolean> {
  void store;
  if (!(i.isButton() || i.isStringSelectMenu())) return false;
  const id = i.customId;
  if (!id.startsWith('mv')) return false;
  if (!hasTmdb()) { await i.reply({ content: nokey, flags: MessageFlags.Ephemeral }); return true; }
  // open one from a list, anyone can
  if (id === 'mvo' && i.isStringSelectMenu()) {
    await i.deferReply();
    await i.editReply(await movieCard(Number(i.values[0]))).catch(() => {});
    return true;
  }
  if (id.startsWith('mvl|')) {
    await i.deferReply();
    const recs = (await similar(Number(id.split('|')[1])).catch(() => [])).slice(0, 10);
    await i.editReply(recs.length ? listOf('More like this', recs) : { content: 'Nothing similar on TMDB yet.' }).catch(() => {});
    return true;
  }
  if (!id.startsWith('mvp|')) return false;
  const [, owner, what, st] = id.split('|');
  const f = unpack(st);
  // results anyone can use, the filters only the person who opened it
  if (['roll', 'vote', 'list'].includes(what)) {
    await i.deferReply();
    const n = what === 'roll' ? 1 : what === 'vote' ? 3 : 10;
    const films = await pickSome(f, n).catch(() => [] as Film[]);
    if (!films.length) { await i.editReply({ content: `Nothing fits ${describe(f)}. Loosen a filter and try again.` }); return true; }
    if (what === 'roll') {
      const out = await movieCard(films[0].id);
      out.components[0].addComponents(new ButtonBuilder().setCustomId(`mvp|${owner}|roll|${st}`).setLabel('Roll again').setEmoji('🎲').setStyle(ButtonStyle.Primary));
      await i.editReply(out).catch(() => {});
    } else if (what === 'list') {
      await i.editReply(listOf(`Ten for ${describe(f)}`, films)).catch(() => {});
    } else {
      // a real Discord poll, open for an hour, with the three cards one click away
      await i.editReply({
        ...listOf('What are we watching?', films),
        poll: { question: { text: 'What are we watching?' }, answers: films.map((x) => ({ text: `${x.title} (${year(x)})`.slice(0, 55) })), duration: 1, allowMultiselect: false },
      }).catch(async () => { await i.editReply(listOf('What are we watching? React with 1, 2 or 3', films)).catch(() => {}); });
    }
    return true;
  }
  if (i.user.id !== owner) { await i.reply({ content: 'These are someone else\'s filters. Open your own with `tz movie`.', flags: MessageFlags.Ephemeral }); return true; }
  if (what === 'g' && i.isStringSelectMenu()) f.genres = i.values.map(Number);
  if (what === 'd' && i.isStringSelectMenu()) f.decade = Number(i.values[0]) || null;
  if (what === 'l' && i.isStringSelectMenu()) f.lang = i.values[0] === 'any' ? null : i.values[0];
  if (what === 's' && i.isStringSelectMenu()) for (const v of i.values) { if (v.startsWith('s')) f.score = Number(v.slice(1)); else f.length = v.slice(1) as Filters['length']; }
  await i.update(picker(owner, what === 'reset' ? unpack('g=;d=;s=0;l=;n=any') : f));
  return true;
}
