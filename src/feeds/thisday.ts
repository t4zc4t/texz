import { ask } from '../anime/anilist.js';

// "on this day" for football from Wikipedia's daily feed, kept to football only, and for anime from AniList

const mmdd = (d = new Date()) => [String(d.getUTCMonth() + 1).padStart(2, '0'), String(d.getUTCDate()).padStart(2, '0')] as const;
const cache = new Map<string, { at: number; data: unknown }>();
async function once<T>(key: string, make: () => Promise<T>, ms = 6 * 3600_000): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.data as T;
  const data = await make();
  cache.set(key, { at: Date.now(), data });
  return data;
}

interface WikiEvent { text: string; year: number; pages?: { content_urls?: { desktop?: { page?: string } }; thumbnail?: { source: string } }[] }
// American football and the NFL say "football" too, they're left out
const NOT = /\b(american football|national football league|nfl|college football|gridiron|rugby|australian rules)\b/i;
const FOOTBALL = /\b(football|footballer|soccer|fifa|uefa|world cup|premier league|la liga|serie a|bundesliga|ligue 1|champions league|european cup|copa am[eé]rica|ballon d'or|goalkeeper|striker)\b/i;

export interface Moment { year: number; text: string; link?: string }

export async function footballThisDay(d = new Date()): Promise<{ events: Moment[]; born: Moment[] }> {
  const [m, day] = mmdd(d);
  return once(`fb:${m}${day}`, async () => {
    const res = await fetch(`https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/all/${m}/${day}`, {
      headers: { 'User-Agent': 'Texz Discord bot (github.com/t4zc4t/texz)' }, signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`wikipedia ${res.status}`);
    const j = (await res.json()) as { events?: WikiEvent[]; selected?: WikiEvent[]; births?: WikiEvent[] };
    const pick = (list: WikiEvent[] = []) => list.filter((e) => FOOTBALL.test(e.text) && !NOT.test(e.text)).map((e) => ({ year: e.year, text: e.text, link: e.pages?.[0]?.content_urls?.desktop?.page }));
    const events = [...pick(j.selected), ...pick(j.events)].filter((e, i, a) => a.findIndex((x) => x.text === e.text) === i).sort((a, b) => b.year - a.year);
    // the better known players tend to have a photo on their page, they go first
    const known = (j.births ?? []).filter((e) => /footballer|soccer|football manager|football coach/i.test(e.text) && !NOT.test(e.text));
    const born = [...known.filter((e) => e.pages?.[0]?.thumbnail), ...known.filter((e) => !e.pages?.[0]?.thumbnail)].slice(0, 6)
      .map((e) => ({ year: e.year, text: e.text, link: e.pages?.[0]?.content_urls?.desktop?.page })).sort((a, b) => a.year - b.year);
    return { events, born };
  });
}

export interface AnimeMoment { title: string; year: number; url: string; cover: string | null; popularity: number }
export interface Birthday { name: string; from: string | null; url: string; image: string | null; favourites: number }

export async function animeThisDay(d = new Date()): Promise<{ premieres: AnimeMoment[]; birthdays: Birthday[] }> {
  const [m, day] = mmdd(d);
  return once(`an:${m}${day}`, async () => {
    const j = await ask<{
      premieres: { media: { title: { english: string | null; romaji: string | null }; startDate: { year: number | null }; siteUrl: string; coverImage: { large: string | null }; popularity: number }[] };
      birthdays: { characters: { name: { full: string }; siteUrl: string; image: { large: string | null }; favourites: number; media: { nodes: { title: { english: string | null; romaji: string | null } }[] } }[] };
    }>(`query ($like: String) {
      premieres: Page(perPage: 8) { media(type: ANIME, startDate_like: $like, sort: POPULARITY_DESC, isAdult: false, format_in: [TV, MOVIE, ONA]) {
        title { english romaji } startDate { year } siteUrl coverImage { large } popularity } }
      birthdays: Page(perPage: 6) { characters(isBirthday: true, sort: FAVOURITES_DESC) {
        name { full } siteUrl image { large } favourites media(perPage: 1, sort: POPULARITY_DESC) { nodes { title { english romaji } } } } }
    }`, { like: `%${m}${day}` }, 6 * 3600_000);
    return {
      premieres: j.premieres.media.filter((x) => x.startDate.year && x.startDate.year < new Date().getUTCFullYear())
        .map((x) => ({ title: x.title.english ?? x.title.romaji ?? '?', year: x.startDate.year!, url: x.siteUrl, cover: x.coverImage.large, popularity: x.popularity })),
      birthdays: j.birthdays.characters.map((c) => ({ name: c.name.full, url: c.siteUrl, image: c.image.large, favourites: c.favourites, from: c.media.nodes[0] ? c.media.nodes[0].title.english ?? c.media.nodes[0].title.romaji : null })),
    };
  });
}
