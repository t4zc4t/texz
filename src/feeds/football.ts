// football scores from ESPN's public scoreboard, no key needed, polled gently
import { clubEmoji } from '../features/logos.js';
export const leagues: Record<string, { name: string; all: boolean }> = {
  'eng.1': { name: 'Premier League', all: false },
  'esp.1': { name: 'LaLiga', all: false },
  'ita.1': { name: 'Serie A', all: false },
  'ger.1': { name: 'Bundesliga', all: false },
  'fra.1': { name: 'Ligue 1', all: false },
  'uefa.champions': { name: 'Champions League', all: false },
  'uefa.europa': { name: 'Europa League', all: false },
  'fifa.world': { name: 'World Cup', all: true },
  'uefa.euro': { name: 'Euros', all: true },
  'ind.1': { name: 'Indian Super League', all: false },
  'usa.1': { name: 'MLS', all: false },
  'mex.1': { name: 'Liga MX', all: false },
  'ned.1': { name: 'Eredivisie', all: false },
  'por.1': { name: 'Primeira Liga', all: false },
  'sco.1': { name: 'Scottish Premiership', all: false },
  'tur.1': { name: 'Süper Lig', all: false },
  'sau.1': { name: 'Saudi Pro League', all: false },
  'bra.1': { name: 'Brasileirão', all: false },
  'arg.1': { name: 'Liga Profesional', all: false },
  'uefa.europa.conf': { name: 'Conference League', all: false },
  'eng.fa': { name: 'FA Cup', all: false },
  'eng.league_cup': { name: 'Carabao Cup', all: false },
  'esp.copa_del_rey': { name: 'Copa del Rey', all: false },
  'concacaf.champions': { name: 'CONCACAF Champions Cup', all: false },
  'conmebol.libertadores': { name: 'Libertadores', all: false },
  'fifa.cwc': { name: 'Club World Cup', all: true },
  'uefa.nations': { name: 'Nations League', all: false },
  'fifa.friendly': { name: 'Friendlies', all: false },
};

// the clubs whose matches are always worth a mention
export const bigClubs = [
  'Real Madrid', 'Barcelona', 'Atlético Madrid', 'Atletico Madrid', 'Manchester City', 'Manchester United', 'Liverpool', 'Arsenal', 'Chelsea',
  'Tottenham Hotspur', 'Newcastle United', 'Bayern Munich', 'Borussia Dortmund', 'Bayer Leverkusen', 'Paris Saint-Germain', 'Juventus',
  'Internazionale', 'Inter Milan', 'AC Milan', 'Napoli', 'AS Roma', 'Benfica', 'Porto',
];

export interface Team { id: string; name: string; short: string; score: string; winner: boolean; home: boolean; color: string | null; logo: string | null }
export interface Match { id: string; league: string; date: number; state: 'pre' | 'in' | 'post'; detail: string; venue: string | null; home: Team; away: Team; goals: { who: string; clock: string; team: string }[] }

const cache = new Map<string, { at: number; data: Match[] }>();
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

export async function matches(league: string, day: Date, keep = 9 * 60_000): Promise<Match[]> {
  const key = `${league}:${ymd(day)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < keep) return hit.data;
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${ymd(day)}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`espn ${league}: ${res.status}`);
  const d = await res.json() as { events?: EspnEvent[] };
  const data = (d.events ?? []).map((e) => toMatch(league, e));
  cache.set(key, { at: Date.now(), data });
  return data;
}

interface EspnEvent {
  id: string; date: string;
  status: { type: { state: 'pre' | 'in' | 'post'; shortDetail: string } };
  competitions: { venue?: { fullName?: string }; competitors: { homeAway: string; score?: string; winner?: boolean; team: { id: string; displayName: string; abbreviation: string; color?: string; logo?: string } }[];
    details?: { scoringPlay?: boolean; clock?: { displayValue?: string }; athletesInvolved?: { displayName: string }[]; team?: { id: string } }[] }[];
}

function toMatch(league: string, e: EspnEvent): Match {
  const c = e.competitions[0];
  const team = (side: string): Team => {
    const t = c.competitors.find((x) => x.homeAway === side) ?? c.competitors[0];
    return { id: t.team.id, name: t.team.displayName, short: t.team.abbreviation, score: t.score ?? '0', winner: !!t.winner, home: side === 'home', color: t.team.color ?? null, logo: t.team.logo?.startsWith('https://') ? t.team.logo : null };
  };
  return {
    id: e.id, league, date: Date.parse(e.date), state: e.status.type.state, detail: e.status.type.shortDetail, venue: c.venue?.fullName ?? null,
    home: team('home'), away: team('away'),
    goals: (c.details ?? []).filter((x) => x.scoringPlay).map((x) => ({ who: x.athletesInvolved?.[0]?.displayName ?? '?', clock: x.clock?.displayValue ?? '', team: x.team?.id ?? '' })),
  };
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const isFav = (m: Match, favs: string[]) => favs.some((f) => [m.home.name, m.away.name].some((n) => norm(n).includes(norm(f))));
const isBigClub = (name: string) => bigClubs.some((b) => norm(b) === norm(name));

// worth posting: a favourite plays, a tournament game, or two big clubs, or a big club in Europe
export function interesting(m: Match, favs: string[], big: boolean) {
  if (isFav(m, favs)) return true;
  if (!big) return false;
  if (leagues[m.league]?.all) return true;
  const bigs = [m.home.name, m.away.name].filter(isBigClub).length;
  return bigs === 2 || (bigs === 1 && m.league.startsWith('uefa.'));
}

export const scoreLine = (m: Match) => `${clubDot(m.home)} **${m.home.name}** ${m.home.score} - ${m.away.score} **${m.away.name}** ${clubDot(m.away)}`;

// the nearest coloured circle to a club's main colour
const circles: [string, number[]][] = [['🔴', [200, 30, 40]], ['🟠', [240, 130, 30]], ['🟡', [240, 210, 40]], ['🟢', [40, 150, 60]], ['🔵', [30, 80, 200]],
  ['🟣', [120, 50, 160]], ['🟤', [120, 70, 40]], ['⚫', [20, 20, 20]], ['⚪', [235, 235, 235]]];
export function clubDot(t: Team) {
  // the real crest when there is one, it gets made the first time a club shows up
  const crest = clubEmoji(t);
  if (crest) return crest;
  if (!t.color || !/^[0-9a-f]{6}$/i.test(t.color)) return '⚽';
  const c = [0, 2, 4].map((i) => Number.parseInt(t.color!.slice(i, i + 2), 16));
  return circles.reduce((best, cur) => (dist(cur[1], c) < dist(best[1], c) ? cur : best))[0];
}
const dist = (a: number[], b: number[]) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);

// every club in the big leagues with its crest, for the crest quiz
interface EspnTeams { sports: { leagues: { teams: { team: { id: string; displayName: string; color?: string; logos?: { href: string }[] } }[] }[] }[] }
export interface Club { id: string; name: string; logo: string; league: string; code: string; color: string | null }
let clubs: { at: number; list: Club[] } | null = null;
// the leagues people can pick a favourite club from
export const clubLeagues = ['eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'usa.1', 'por.1', 'ned.1'];
async function clubsFrom(codes: string[]) {
  const out: Club[] = [];
  for (const l of codes) {
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${l}/teams`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const j = (await res.json()) as EspnTeams;
      for (const t of j.sports[0]?.leagues[0]?.teams ?? []) {
        const logo = t.team.logos?.[0]?.href;
        if (logo) out.push({ id: t.team.id, name: t.team.displayName, logo, league: leagues[l]?.name ?? l, code: l, color: t.team.color ?? null });
      }
    } catch { /* one league missing is fine */ }
  }
  return out;
}

export async function allClubs() {
  if (clubs && Date.now() - clubs.at < 24 * 3600_000) return clubs.list;
  const out = await clubsFrom(clubLeagues);
  if (out.length) clubs = { at: Date.now(), list: out };
  return out;
}

// every club league ESPN covers, for matching a club someone typed in their own words
let wide: { at: number; list: Club[] } | null = null;
const otherLeagues = ['ind.1', 'mex.1', 'sco.1', 'tur.1', 'sau.1', 'bra.1', 'arg.1', 'bel.1', 'eng.2', 'uefa.champions', 'uefa.europa', 'uefa.europa.conf', 'conmebol.libertadores'];
const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\b(fc|cf|afc|sc|ac|cd|club|de|the)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export async function findClub(name: string): Promise<Club | null> {
  const want = plain(name);
  if (!want) return null;
  const pick = (list: Club[]) => list.find((c) => plain(c.name) === want)
    ?? list.find((c) => plain(c.name).startsWith(want) || want.startsWith(plain(c.name)))
    ?? list.find((c) => plain(c.name).includes(want) || (want.length > 4 && want.includes(plain(c.name))))
    ?? null;
  const first = pick(await allClubs().catch(() => []));
  if (first) return first;
  if (!wide || Date.now() - wide.at > 24 * 3600_000) wide = { at: Date.now(), list: await clubsFrom(otherLeagues) };
  return pick(wide.list);
}

// a crest and four clubs from the same league to pick from
export async function crestQuestions() {
  const list = await allClubs();
  const shuffle = <T>(a: T[]) => a.map((x) => [Math.random(), x] as const).sort((p, q) => p[0] - q[0]).map(([, x]) => x);
  return shuffle(list).slice(0, 40).map((c) => {
    const others = shuffle(list.filter((o) => o.league === c.league && o.name !== c.name)).slice(0, 3).map((o) => o.name);
    const options = shuffle([c.name, ...others]);
    const big = isBigClub(c.name);
    return {
      id: `crest-${c.name}`, q: 'Whose crest is this?', options, answer: options.indexOf(c.name), image: c.logo,
      explain: `That's **${c.name}**, ${c.league}.`, difficulty: big ? 'easy' : c.league === 'MLS' || c.league === 'Eredivisie' || c.league === 'Primeira Liga' ? 'hard' : 'medium',
      category: c.league,
    };
  });
}
