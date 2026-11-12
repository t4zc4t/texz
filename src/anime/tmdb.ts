// movies from TMDB. It needs a free key from themoviedb.org in .env as TMDB_TOKEN (the read access token) or TMDB_KEY.
// TMDB allows around 50 requests a second, and answers are kept for six hours anyway.

const BASE = 'https://api.themoviedb.org/3';
export const IMG = 'https://image.tmdb.org/t/p';

export const hasTmdb = () => !!(process.env.TMDB_TOKEN || process.env.TMDB_KEY);

const cache = new Map<string, { at: number; data: unknown }>();
async function get<T>(path: string, q: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  if (!process.env.TMDB_TOKEN && process.env.TMDB_KEY) url.searchParams.set('api_key', process.env.TMDB_KEY);
  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.data as T;
  const r = await fetch(url, { headers: process.env.TMDB_TOKEN ? { Authorization: `Bearer ${process.env.TMDB_TOKEN}`, accept: 'application/json' } : { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`tmdb ${r.status}`);
  const data = await r.json();
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), data });
  return data as T;
}

export interface Film {
  id: number; title: string; original_title: string; overview: string; release_date: string; vote_average: number; vote_count: number;
  poster_path: string | null; backdrop_path: string | null; genre_ids?: number[]; original_language: string;
}
export interface FilmFull extends Film {
  runtime: number | null; tagline: string; genres: { id: number; name: string }[];
  credits?: { cast: { name: string }[]; crew: { name: string; job: string }[] };
  videos?: { results: { key: string; site: string; type: string; official: boolean }[] };
  'watch/providers'?: { results: Record<string, { link: string; flatrate?: { provider_name: string }[]; rent?: { provider_name: string }[] }> };
}

// TMDB's movie genres, fixed for years, so they live here instead of a call
export const GENRES: [number, string][] = [
  [28, 'Action'], [12, 'Adventure'], [16, 'Animation'], [35, 'Comedy'], [80, 'Crime'], [99, 'Documentary'], [18, 'Drama'], [10751, 'Family'],
  [14, 'Fantasy'], [36, 'History'], [27, 'Horror'], [10402, 'Music'], [9648, 'Mystery'], [10749, 'Romance'], [878, 'Science Fiction'],
  [53, 'Thriller'], [10752, 'War'], [37, 'Western'],
];
export const genreName = (id: number) => GENRES.find(([g]) => g === id)?.[1] ?? '';

export const search = (q: string) => get<{ results: Film[] }>('/search/movie', { query: q, include_adult: 'false' }).then((r) => r.results);
export const details = (id: number) => get<FilmFull>(`/movie/${id}`, { append_to_response: 'credits,videos,watch/providers' });
export const similar = (id: number) => get<{ results: Film[] }>(`/movie/${id}/recommendations`).then((r) => r.results);

export interface Filters { genres: number[]; decade: number | null; score: number; lang: string | null; length: 'any' | 'short' | 'long' }
export async function discover(f: Filters, page = 1) {
  return get<{ results: Film[]; total_pages: number; total_results: number }>('/discover/movie', {
    with_genres: f.genres.join(',') || undefined,
    'primary_release_date.gte': f.decade ? `${f.decade}-01-01` : undefined,
    'primary_release_date.lte': f.decade ? `${f.decade === 1900 ? 1979 : f.decade + 9}-12-31` : undefined,
    'vote_average.gte': f.score || undefined,
    'vote_count.gte': f.score >= 7 ? 300 : 100,
    with_original_language: f.lang ?? undefined,
    'with_runtime.lte': f.length === 'short' ? 100 : undefined,
    'with_runtime.gte': f.length === 'long' ? 140 : undefined,
    include_adult: 'false',
    sort_by: 'popularity.desc',
    page,
  });
}

// a few random picks that fit, from anywhere in the first twenty pages
export async function pickSome(f: Filters, n: number): Promise<Film[]> {
  const first = await discover(f, 1);
  if (!first.total_results) return [];
  const pages = Math.min(first.total_pages, 20);
  const page = 1 + Math.floor(Math.random() * pages);
  const pool = page === 1 ? first.results : (await discover(f, page)).results;
  return [...pool].sort(() => Math.random() - 0.5).slice(0, n);
}
