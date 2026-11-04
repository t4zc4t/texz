// Grand Prix data from Parc Fermé, which keeps its own copy of the season and rebuilds it after every session
const BASE = 'https://parc-ferme.pages.dev/data';

export interface Driver { code: string; driver: string; id: string; team: string }
export interface Session { type: string; label: string; start: string; end: string; results?: boolean; top3?: Driver[] }
export interface Round { round: number; name: string; race: string; start?: string; sprint?: boolean; circuit: { name: string; locality: string; country: string }; sessions: Session[] }
export interface Home {
  season: number;
  afterRound: number;
  lastRace: { round: number; name: string; dateLabel: string; results: (Driver & { pos: string; gap: string; grid: number; points: number })[] };
  standings: (Driver & { pos: string; points: number; wins: number })[];
  teams: { team: string; pos: string; points: number; wins: number }[];
}
export interface Question { id: string; q: string; answer: string; body: string }

const cache = new Map<string, { at: number; data: unknown }>();

async function get<T>(path: string, keep = 5 * 60_000): Promise<T> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < keep) return hit.data as T;
  const res = await fetch(`${BASE}/${path}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`parc ferme ${path}: ${res.status}`);
  const data = await res.json() as T;
  cache.set(path, { at: Date.now(), data });
  return data;
}

export const schedule = () => get<{ season: number; rounds: Round[] }>('schedule.json');
export const home = () => get<Home>('home.json');
export const questions = () => get<{ questions: Question[] }>('questions.json', 60 * 60_000);

export const SITE = 'https://parc-ferme.pages.dev';
export const flagOf: Record<string, string> = {
  Australia: '🇦🇺', China: '🇨🇳', Japan: '🇯🇵', Bahrain: '🇧🇭', 'Saudi Arabia': '🇸🇦', USA: '🇺🇸', 'United States': '🇺🇸', Italy: '🇮🇹', Monaco: '🇲🇨',
  Spain: '🇪🇸', Canada: '🇨🇦', Austria: '🇦🇹', UK: '🇬🇧', 'United Kingdom': '🇬🇧', Hungary: '🇭🇺', Belgium: '🇧🇪', Netherlands: '🇳🇱', Azerbaijan: '🇦🇿',
  Singapore: '🇸🇬', Mexico: '🇲🇽', Brazil: '🇧🇷', Qatar: '🇶🇦', UAE: '🇦🇪', 'United Arab Emirates': '🇦🇪', France: '🇫🇷', Portugal: '🇵🇹', Germany: '🇩🇪',
};

// the sessions worth a ping, practice is left out
export const bigSession = (t: string) => ['Q', 'SQ', 'S', 'R'].includes(t);

export function nextRound(rounds: Round[], now = Date.now()) {
  return rounds.find((r) => Date.parse(r.race) + 3 * 3_600_000 > now) ?? null;
}
