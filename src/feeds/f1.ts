// Grand Prix data from Parc Fermé, which keeps its own copy of the season and rebuilds it after every session
import { teamEmoji } from '../features/logos.js';
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

// a colour square for each team, close to their livery
const teamDots: [RegExp, string][] = [
  [/red bull/i, '🟦'], [/ferrari/i, '🟥'], [/mercedes/i, '🩵'], [/mclaren/i, '🟧'], [/aston/i, '🟩'], [/alpine/i, '🩷'],
  [/williams/i, '🔷'], [/haas/i, '⬜'], [/audi|sauber/i, '⬛'], [/\brb\b|racing bulls|visa/i, '🔹'], [/cadillac/i, '🟨'],
];
// the team's own logo once it's been made into an emoji, a coloured square until then
export const teamDot = (team: string) => teamEmoji(team) ?? teamDots.find(([re]) => re.test(team))?.[1] ?? '▫️';

export interface Fact { id: string; category: string; text: string; link?: string }
export interface QuizQ { id: string; q: string; options: string[]; answer: number; explain: string; difficulty: string; category: string; link?: string }
export const facts = () => get<{ facts: Fact[] }>('trivia/facts.json', 6 * 60 * 60_000);
export const quiz = () => get<{ questions: QuizQ[] }>('trivia/quiz.json', 6 * 60 * 60_000);
export const onThisDay = () => get<{ days: Record<string, { text: string; year: number; link?: string }[]> }>('trivia/onthisday.json', 6 * 60 * 60_000);
export const siteLink = (path?: string) => (path ? `${SITE}${path.startsWith('/') ? '' : '/'}${path}` : SITE);

// the extra numbers from a race that Parc Fermé's summary leaves out, from the Jolpica F1 API (Ergast's successor)
// it allows a few hundred calls an hour, each race is fetched once and kept
const JOLPICA = 'https://api.jolpi.ca/ergast/f1';
export interface RaceExtras {
  winTime?: string;
  fastest?: { driver: string; team: string; time: string; lap: string };
  pit?: { driver: string; team: string; secs: string; lap: string };
  climb?: { driver: string; from: number; to: number };
  out: number;
}
const extrasCache = new Map<string, RaceExtras>();
type JRes = { position: string; grid: string; status: string; Driver: { givenName: string; familyName: string; driverId: string }; Constructor: { name: string }; Time?: { time: string }; FastestLap?: { rank: string; lap: string; Time: { time: string } } };
export async function raceExtras(season: number | string, round: number): Promise<RaceExtras | null> {
  const key = `${season}:${round}`;
  if (extrasCache.has(key)) return extrasCache.get(key)!;
  try {
    const [res, pits] = await Promise.all([
      fetch(`${JOLPICA}/${season}/${round}/results.json?limit=40`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()),
      fetch(`${JOLPICA}/${season}/${round}/pitstops.json?limit=200`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null),
    ]) as [{ MRData: { RaceTable: { Races: { Results: JRes[] }[] } } }, { MRData: { RaceTable: { Races: { PitStops: { driverId: string; lap: string; duration: string }[] }[] } } } | null];
    const results = res.MRData.RaceTable.Races[0]?.Results ?? [];
    if (!results.length) return null;
    const name = (r: JRes) => `${r.Driver.givenName} ${r.Driver.familyName}`;
    const fl = results.find((r) => r.FastestLap?.rank === '1');
    const stops = (pits?.MRData.RaceTable.Races[0]?.PitStops ?? []).filter((p) => /^\d+(\.\d+)?$/.test(p.duration)).sort((a, b) => Number(a.duration) - Number(b.duration));
    const quick = stops[0];
    const qr = quick ? results.find((r) => r.Driver.driverId === quick.driverId) : undefined;
    const climb = results.filter((r) => Number(r.grid) > 0 && /^\d+$/.test(r.position)).map((r) => ({ r, gain: Number(r.grid) - Number(r.position) })).sort((a, b) => b.gain - a.gain)[0];
    const out: RaceExtras = {
      winTime: results[0].Time?.time,
      fastest: fl ? { driver: name(fl), team: fl.Constructor.name, time: fl.FastestLap!.Time.time, lap: fl.FastestLap!.lap } : undefined,
      pit: quick && qr ? { driver: name(qr), team: qr.Constructor.name, secs: quick.duration, lap: quick.lap } : undefined,
      climb: climb && climb.gain > 2 ? { driver: name(climb.r), from: Number(climb.r.grid), to: Number(climb.r.position) } : undefined,
      out: results.filter((r) => !/^(Finished|\+\d+ Laps?|Lapped)$/i.test(r.status)).length,
    };
    extrasCache.set(key, out);
    return out;
  } catch {
    return null;
  }
}

// pole lap from qualifying
export async function poleTime(season: number | string, round: number, sprint = false): Promise<string | null> {
  try {
    const j = await fetch(`${JOLPICA}/${season}/${round}/${sprint ? 'sprintQualifying' : 'qualifying'}.json?limit=3`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()) as { MRData: { RaceTable: { Races: Record<string, { Q3?: string; Q2?: string; Q1?: string; SQ3?: string }[]>[] } } };
    const race = j.MRData.RaceTable.Races[0];
    const q = (race?.QualifyingResults ?? race?.SprintQualifyingResults)?.[0];
    return q?.Q3 ?? q?.SQ3 ?? q?.Q2 ?? q?.Q1 ?? null;
  } catch {
    return null;
  }
}

// the lines under a race result
export function extrasLines(x: RaceExtras | null, dot: (team: string) => string): string[] {
  if (!x) return [];
  return [
    x.winTime ? `⏱️ Race time **${x.winTime}**` : null,
    x.fastest ? `🟣 Fastest lap · ${dot(x.fastest.team)} **${x.fastest.driver}** ${x.fastest.time} on lap ${x.fastest.lap}` : null,
    x.pit ? `🔧 Quickest stop · ${dot(x.pit.team)} **${x.pit.driver}** ${Number(x.pit.secs).toFixed(1)}s in the pit lane, lap ${x.pit.lap}` : null,
    x.climb ? `📈 Biggest climb · **${x.climb.driver}** P${x.climb.from} → P${x.climb.to}` : null,
    x.out ? `💥 ${x.out} didn't finish` : null,
  ].filter((l): l is string => !!l);
}
