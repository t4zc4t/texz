// AniList's public GraphQL api, no key needed. It allows 30 requests a minute right now
// (90 once they fix it), so calls are spaced out and answers are kept for a while.

const URL = 'https://graphql.anilist.co';
const PER_MINUTE = 25;
const KEEP_MS = 30 * 60_000;

const sent: number[] = [];
const kept = new Map<string, { at: number; data: unknown }>();

async function slot() {
  for (;;) {
    const now = Date.now();
    while (sent.length && now - sent[0] > 60_000) sent.shift();
    if (sent.length < PER_MINUTE) { sent.push(now); return; }
    await new Promise((r) => setTimeout(r, 60_000 - (now - sent[0]) + 50));
  }
}

export class AniListError extends Error {}

export async function ask<T>(query: string, variables: Record<string, unknown>, keep = KEEP_MS): Promise<T> {
  const key = JSON.stringify([query, variables]);
  const hit = kept.get(key);
  if (hit && Date.now() - hit.at < keep) return hit.data as T;
  await slot();
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 429) throw new AniListError('AniList asked me to slow down, try again in a minute.');
  const body = (await res.json()) as { data?: T; errors?: { message: string; status?: number }[] };
  if (body.errors?.length && !body.data) throw new AniListError(body.errors[0].message);
  kept.set(key, { at: Date.now(), data: body.data });
  if (kept.size > 500) kept.delete(kept.keys().next().value!);
  return body.data as T;
}

export interface Media {
  id: number;
  type: 'ANIME' | 'MANGA';
  siteUrl: string;
  title: { romaji: string | null; english: string | null; native: string | null };
  format: string | null;
  status: string | null;
  description: string | null;
  episodes: number | null;
  duration: number | null;
  chapters: number | null;
  volumes: number | null;
  season: string | null;
  seasonYear: number | null;
  averageScore: number | null;
  popularity: number | null;
  genres: string[];
  isAdult: boolean;
  coverImage: { large: string | null; color: string | null };
  bannerImage: string | null;
  studios: { nodes: { name: string }[] };
  nextAiringEpisode: { episode: number; airingAt: number } | null;
  startDate: { year: number | null; month: number | null; day: number | null };
}

const MEDIA = `id type siteUrl title { romaji english native } format status description(asHtml: false)
  episodes duration chapters volumes season seasonYear averageScore popularity genres isAdult
  coverImage { large color } bannerImage studios(isMain: true) { nodes { name } }
  nextAiringEpisode { episode airingAt } startDate { year month day }`;

export async function searchMedia(search: string, type: 'ANIME' | 'MANGA'): Promise<Media[]> {
  const q = `query ($search: String, $type: MediaType) { Page(perPage: 6) { media(search: $search, type: $type, isAdult: false, sort: SEARCH_MATCH) { ${MEDIA} } } }`;
  const d = await ask<{ Page: { media: Media[] } }>(q, { search, type });
  return d.Page.media;
}

export async function mediaById(id: number): Promise<Media | null> {
  const q = `query ($id: Int) { Media(id: $id) { ${MEDIA} } }`;
  const d = await ask<{ Media: Media | null }>(q, { id });
  return d.Media;
}

export async function seasonal(season: string, year: number, type: 'ANIME' | 'MANGA' = 'ANIME'): Promise<Media[]> {
  const q = `query ($season: MediaSeason, $year: Int, $type: MediaType) { Page(perPage: 10) { media(season: $season, seasonYear: $year, type: $type, isAdult: false, sort: POPULARITY_DESC) { ${MEDIA} } } }`;
  const d = await ask<{ Page: { media: Media[] } }>(q, { season, year, type });
  return d.Page.media;
}

export async function trending(type: 'ANIME' | 'MANGA'): Promise<Media[]> {
  const q = `query ($type: MediaType) { Page(perPage: 10) { media(type: $type, isAdult: false, sort: TRENDING_DESC) { ${MEDIA} } } }`;
  const d = await ask<{ Page: { media: Media[] } }>(q, { type }, 15 * 60_000);
  return d.Page.media;
}

export interface Character {
  id: number;
  siteUrl: string;
  name: { full: string | null; native: string | null };
  image: { large: string | null };
  description: string | null;
  gender: string | null;
  age: string | null;
  favourites: number | null;
  media: { nodes: { title: { romaji: string | null; english: string | null }; type: string }[] };
}

export async function searchCharacter(search: string): Promise<Character[]> {
  const q = `query ($search: String) { Page(perPage: 5) { characters(search: $search, sort: SEARCH_MATCH) {
    id siteUrl name { full native } image { large } description(asHtml: false) gender age favourites
    media(perPage: 3, sort: POPULARITY_DESC) { nodes { title { romaji english } type } } } } }`;
  const d = await ask<{ Page: { characters: Character[] } }>(q, { search });
  return d.Page.characters;
}

export async function randomPopular(type: 'ANIME' | 'MANGA'): Promise<Media | null> {
  const page = 1 + Math.floor(Math.random() * 50);
  const q = `query ($page: Int, $type: MediaType) { Page(page: $page, perPage: 1) { media(type: $type, isAdult: false, sort: POPULARITY_DESC) { ${MEDIA} } } }`;
  const d = await ask<{ Page: { media: Media[] } }>(q, { page, type }, 0);
  return d.Page.media[0] ?? null;
}

// AniList descriptions carry a little markup, the card only needs plain text
export function plain(text: string | null, max = 380): string {
  if (!text) return '';
  const t = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(i|b|em|strong)>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/~!.*?!~/gs, '[spoiler hidden]')
    .replace(/__(.+?)__/g, '**$1**')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t.length > max ? `${t.slice(0, max).replace(/\s+\S*$/, '')}…` : t;
}

export const titleOf = (m: { title: { english: string | null; romaji: string | null } }) => m.title.english ?? m.title.romaji ?? 'Untitled';

export function currentSeason(now = new Date()) {
  const m = now.getUTCMonth();
  const season = m < 3 ? 'WINTER' : m < 6 ? 'SPRING' : m < 9 ? 'SUMMER' : 'FALL';
  return { season, year: now.getUTCFullYear() };
}

const CHAR = `id siteUrl name { full native } image { large } description(asHtml: false) gender age favourites
    media(perPage: 3, sort: POPULARITY_DESC) { nodes { title { romaji english } type } }`;

// the same character for everyone all day, picked from the 300 most loved
export async function characterOfDay(day = new Date().toISOString().slice(0, 10)): Promise<Character | null> {
  let h = 0;
  for (const c of day) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const page = 1 + (h % 300);
  const q = `query ($page: Int) { Page(page: $page, perPage: 1) { characters(sort: FAVOURITES_DESC) { ${CHAR} } } }`;
  const d = await ask<{ Page: { characters: Character[] } }>(q, { page }, 6 * 60 * 60_000);
  return d.Page.characters[0] ?? null;
}

// four popular shows for the guessing game, at least one with a banner picture to show
export async function guessRound(): Promise<{ answer: Media; options: Media[] } | null> {
  const page = 1 + Math.floor(Math.random() * 75);
  const q = `query ($page: Int) { Page(page: $page, perPage: 4) { media(type: ANIME, isAdult: false, sort: POPULARITY_DESC, format_in: [TV, MOVIE]) { ${MEDIA} } } }`;
  const d = await ask<{ Page: { media: Media[] } }>(q, { page }, 0);
  const options = d.Page.media;
  const withPic = options.filter((m) => m.bannerImage);
  if (options.length < 4 || !withPic.length) return null;
  return { answer: withPic[Math.floor(Math.random() * withPic.length)], options };
}
