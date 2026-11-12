// movies from Trakt. It needs a Client ID from developer.trakt.tv in .env as TRAKT_ID, nothing else.
// Trakt allows 1000 reads every 5 minutes, and answers are kept for six hours anyway.

const BASE = 'https://api.trakt.tv';
export const hasMovies = () => !!process.env.TRAKT_ID;

const cache = new Map<string, { at: number; data: unknown; pages: number }>();
async function get<T>(path: string, q: Record<string, string | number | undefined> = {}): Promise<{ data: T; pages: number }> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return { data: hit.data as T, pages: hit.pages };
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': process.env.TRAKT_ID ?? '' }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`trakt ${r.status}`);
  const data = await r.json();
  const pages = Number(r.headers.get('x-pagination-page-count') ?? 1);
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), data, pages });
  return { data: data as T, pages };
}

interface Raw {
  title: string; year: number | null; ids: { slug: string; trakt: number; imdb?: string; tmdb?: number };
  overview?: string; tagline?: string; rating?: number; votes?: number; runtime?: number; genres?: string[]; trailer?: string | null;
  certification?: string | null; language?: string; original_title?: string; colors?: { poster?: string[] };
  images?: { poster?: string[]; fanart?: string[]; thumb?: string[] };
}
export interface Film {
  slug: string; title: string; original: string | null; year: number | null; overview: string; tagline: string; rating: number; votes: number;
  runtime: number | null; genres: string[]; trailer: string | null; certification: string | null; poster: string | null; fanart: string | null; color: number | null; imdb: string | null;
}
const img = (a?: string[]) => (a?.[0] ? `https://${a[0]}` : null);
const film = (m: Raw): Film => ({
  slug: m.ids.slug, title: m.title, original: m.original_title && m.original_title !== m.title ? m.original_title : null, year: m.year,
  overview: m.overview ?? '', tagline: m.tagline ?? '', rating: m.rating ?? 0, votes: m.votes ?? 0, runtime: m.runtime || null, genres: m.genres ?? [],
  trailer: m.trailer ?? null, certification: m.certification ?? null, poster: img(m.images?.poster), fanart: img(m.images?.fanart),
  color: m.colors?.poster?.[0] ? Number.parseInt(m.colors.poster[0].slice(1), 16) : null, imdb: m.ids.imdb ?? null,
});
const ext = 'full,images';

// Trakt's genre slugs, the ones worth a spot in the menu
export const GENRES: [string, string][] = [
  ['action', 'Action'], ['adventure', 'Adventure'], ['animation', 'Animation'], ['anime', 'Anime'], ['comedy', 'Comedy'], ['crime', 'Crime'],
  ['documentary', 'Documentary'], ['drama', 'Drama'], ['family', 'Family'], ['fantasy', 'Fantasy'], ['history', 'History'], ['horror', 'Horror'],
  ['musical', 'Musical'], ['mystery', 'Mystery'], ['romance', 'Romance'], ['science-fiction', 'Science Fiction'], ['superhero', 'Superhero'],
  ['thriller', 'Thriller'], ['war', 'War'], ['western', 'Western'],
];
export const genreName = (slug: string) => GENRES.find(([g]) => g === slug)?.[1] ?? slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

export const search = async (q: string) => (await get<{ movie: Raw }[]>('/search/movie', { query: q, extended: ext, limit: 10 })).data.map((x) => film(x.movie));
export const details = async (slug: string) => film((await get<Raw>(`/movies/${slug}`, { extended: ext })).data);
export const similar = async (slug: string) => (await get<Raw[]>(`/movies/${slug}/related`, { extended: ext, limit: 10 })).data.map(film);
export async function people(slug: string) {
  const { data } = await get<{ cast?: { person: { name: string } }[]; crew?: { directing?: { jobs: string[]; person: { name: string } }[] } }>(`/movies/${slug}/people`);
  return {
    director: data.crew?.directing?.find((d) => d.jobs.includes('Director'))?.person.name ?? null,
    cast: (data.cast ?? []).slice(0, 3).map((c) => c.person.name),
  };
}

export interface Filters { genres: string[]; decade: number | null; score: number; lang: string | null; length: 'any' | 'short' | 'long' }
const query = (f: Filters) => ({
  extended: ext,
  genres: f.genres.join(',') || undefined,
  years: f.decade ? `${f.decade === 1900 ? 1900 : f.decade}-${f.decade === 1900 ? 1979 : f.decade + 9}` : undefined,
  ratings: f.score ? `${f.score * 10}-100` : undefined,
  languages: f.lang ?? undefined,
  runtimes: f.length === 'short' ? '1-100' : f.length === 'long' ? '140-400' : undefined,
});

// a few random picks that fit, from anywhere in the first ten pages of what's popular
export async function pickSome(f: Filters, n: number): Promise<Film[]> {
  const first = await get<Raw[]>('/movies/popular', { ...query(f), limit: 20, page: 1 });
  if (!first.data.length) return [];
  const page = 1 + Math.floor(Math.random() * Math.min(first.pages, 10));
  const pool = page === 1 ? first.data : (await get<Raw[]>('/movies/popular', { ...query(f), limit: 20, page })).data;
  return [...pool].map(film).sort(() => Math.random() - 0.5).slice(0, n);
}
