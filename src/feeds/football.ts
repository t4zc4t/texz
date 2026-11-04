// football scores from ESPN's public scoreboard, no key needed, polled gently
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
};

// the clubs whose matches are always worth a mention
export const bigClubs = [
  'Real Madrid', 'Barcelona', 'Atlético Madrid', 'Atletico Madrid', 'Manchester City', 'Manchester United', 'Liverpool', 'Arsenal', 'Chelsea',
  'Tottenham Hotspur', 'Newcastle United', 'Bayern Munich', 'Borussia Dortmund', 'Bayer Leverkusen', 'Paris Saint-Germain', 'Juventus',
  'Internazionale', 'Inter Milan', 'AC Milan', 'Napoli', 'AS Roma', 'Benfica', 'Porto',
];

export interface Team { id: string; name: string; short: string; score: string; winner: boolean; home: boolean }
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
  competitions: { venue?: { fullName?: string }; competitors: { homeAway: string; score?: string; winner?: boolean; team: { id: string; displayName: string; abbreviation: string } }[];
    details?: { scoringPlay?: boolean; clock?: { displayValue?: string }; athletesInvolved?: { displayName: string }[]; team?: { id: string } }[] }[];
}

function toMatch(league: string, e: EspnEvent): Match {
  const c = e.competitions[0];
  const team = (side: string): Team => {
    const t = c.competitors.find((x) => x.homeAway === side) ?? c.competitors[0];
    return { id: t.team.id, name: t.team.displayName, short: t.team.abbreviation, score: t.score ?? '0', winner: !!t.winner, home: side === 'home' };
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

export const scoreLine = (m: Match) => `**${m.home.name}** ${m.home.score} - ${m.away.score} **${m.away.name}**`;
