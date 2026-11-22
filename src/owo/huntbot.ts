// HuntBot upgrade advice that judges each trait by what it really adds to YOUR runs, per essence spent.
// The traps it steers around:
//  - big numbers on the card ("1100 essence/H") say nothing about which next level pays back fastest
//  - duration only helps when your check-ins are further apart than a run; past that it can even lose
//    hunting time, because a bot still out when you look in sits idle until the next time you're around
//  - efficiency makes a run SHORTER when you can't afford a full one, so essence and xp from gain drop
//  - rare animals carry most of the average value, fabled and hidden are a lottery and aren't counted
//  - radar's chance is so small that no level of it is worth the essence
//  - spending on whatever is cheapest instead of what's best: essence put into a trait stays there as
//    progress, so the plan always pours into the best trait and never buys a worse level just because it fits
// Formulas are OwO's own (autohuntutil.js, autohunt.js, animal.json).

export const SPEC = {
  efficiency: { inc: 10, pow: 1.748, base: 25, upg: 1, max: 215 },
  duration: { inc: 10, pow: 1.7, base: 0.5, upg: 0.1, max: 235 },
  cost: { inc: 1000, pow: 3.4, base: 10, upg: -1, max: 5 },
  gain: { inc: 10, pow: 1.8, base: 0, upg: 25, max: 200 },
  experience: { inc: 10, pow: 1.8, base: 0, upg: 35, max: 200 },
  radar: { inc: 50, pow: 2.5, base: 0, upg: 0.00000004, max: 999 },
} as const;
export type HbTrait = keyof typeof SPEC;

// essence it takes to go from level L to L+1
export const levelCost = (t: HbTrait, L: number) => Math.trunc(SPEC[t].inc * Math.pow(L + 1, SPEC[t].pow));
export const statOf = (t: HbTrait, L: number) => SPEC[t].base + SPEC[t].upg * Math.min(L, SPEC[t].max);

// what an animal is worth, rank by rank (rarity %, sell cowoncy, sacrifice essence)
export const RANK_VALUE: Record<string, { rarity: number; sell: number; essence: number }> = {
  common: { rarity: 58.85, sell: 1, essence: 1 },
  uncommon: { rarity: 30, sell: 3, essence: 5 },
  rare: { rarity: 10, sell: 10, essence: 20 },
  epic: { rarity: 1, sell: 250, essence: 250 },
  mythic: { rarity: 0.1, sell: 5000, essence: 3000 },
  legendary: { rarity: 0.05, sell: 15000, essence: 10000 },
  fabled: { rarity: 0.001, sell: 250000, essence: 100000 },
  hidden: { rarity: 0.0001, sell: 1000000, essence: 500000 },
};
const LOTTERY = new Set(['fabled', 'hidden']);
const avg = (k: 'sell' | 'essence') => Object.entries(RANK_VALUE).filter(([r]) => !LOTTERY.has(r)).reduce((s, [, v]) => s + (v.rarity / 100) * v[k], 0);
// about 14.6 essence or 17.5 cowoncy per animal, counting only what turns up often enough to plan on
export const PER_ANIMAL = { essence: avg('essence'), sell: avg('sell') };
// selling a legendary swaps 10k essence for 15k cowoncy: that's the going rate when runs need paying for
export const ESSENCE_PER_COWONCY = 0.6;

// ---------- how much of the day it actually hunts ----------

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// replay your real check-ins: whenever you were around and the bot was home, it goes out for a full run
export function huntHours(checks: number[], D: number) {
  if (checks.length < 2) return null;
  const end = checks[checks.length - 1];
  let busyUntil = -Infinity;
  let hunted = 0;
  let sends = 0;
  for (const c of checks) {
    if (c < busyUntil) continue;
    busyUntil = c + D * HOUR;
    hunted += Math.min(D * HOUR, Math.max(0, end - c));
    sends++;
  }
  const days = (end - checks[0]) / DAY;
  return { perDay: hunted / HOUR / days, sendsPerDay: sends / days };
}

// check-ins from your OwO activity, merged into 10 minute visits; without two days of them a plain day is assumed:
// three looks six hours apart, then a night's sleep
export function checkIns(times: number[], now = Date.now()) {
  const recent = [...new Set(times.filter((t) => t > now - 14 * DAY && t <= now))].sort((a, b) => a - b);
  const visits: number[] = [];
  for (const t of recent) if (!visits.length || t - visits[visits.length - 1] > 10 * 60_000) visits.push(t);
  const span = visits.length ? visits[visits.length - 1] - visits[0] : 0;
  if (visits.length >= 6 && span >= 2 * DAY) return { visits, measured: true };
  const fake: number[] = [];
  for (let d = 7; d >= 0; d--) for (const h of [0, 6, 12]) fake.push(now - d * DAY - (12 - h) * HOUR);
  return { visits: fake, measured: false };
}

// ---------- the advice ----------

export interface HbLevels { efficiency: number; duration: number; cost: number; gain: number; experience: number; radar: number }
export interface HbInput {
  levels: HbLevels;
  progress?: Partial<Record<HbTrait, { progress: number; need: number }>>;
  essence: number;
  cash: number | null; // cowoncy on hand, when known
  checks: number[];
  now?: number;
}
export interface Pick { trait: HbTrait; perDay: number; cost: number; payback: number; why: string }
export interface Plan {
  hoursPerDay: number; sendsPerDay: number; measured: boolean;
  runCost: number; cashShort: boolean;
  essencePerDay: number;
  ranked: Pick[]; // every trait worth a level, best first
  skip: { trait: HbTrait; why: string }[];
  spend: { trait: HbTrait; essence: number; levels: number }[]; // where the essence on hand goes
  left: number;
  xp: { perDay: number; cost: number } | null;
}

const NAME: Record<HbTrait, string> = { efficiency: 'efficiency', duration: 'duration', cost: 'cost', gain: 'gain', experience: 'exp', radar: 'radar' };
export const upgradeWord = (t: HbTrait) => NAME[t];

export function advise(inp: HbInput): Plan {
  const now = inp.now ?? Date.now();
  const lv = { ...inp.levels };
  const { visits, measured } = checkIns(inp.checks, now);
  const hours = (D: number) => huntHours(visits, D)!;
  const runCostOf = (l: HbLevels) => Math.floor(statOf('duration', l.duration) * statOf('efficiency', l.efficiency)) * statOf('cost', l.cost);
  const runCost = runCostOf(lv);
  // can't pay for even one full run: the bot is cowoncy-bound, not trait-bound
  const cashShort = inp.cash !== null && inp.cash < runCost;
  const k = ESSENCE_PER_COWONCY;

  // essence-equivalent a day for one more level of t, at levels l
  const value = (t: HbTrait, l: HbLevels): { perDay: number; why: string } => {
    const D = statOf('duration', l.duration);
    const eff = statOf('efficiency', l.efficiency);
    const cost = statOf('cost', l.cost);
    const gain = statOf('gain', l.gain);
    const h = hours(D);
    const perAnimal = PER_ANIMAL.essence - k * cost;
    if (l[t] >= SPEC[t].max) return { perDay: 0, why: 'maxed' };
    switch (t) {
      case 'gain': return { perDay: 25 * h.perDay, why: '+25 essence/h' };
      case 'efficiency':
        if (cashShort) return { perDay: 0, why: 'shortens runs while you can\'t afford a full one' };
        return { perDay: h.perDay * perAnimal, why: '+1 animal/h' };
      case 'duration': {
        if (cashShort) return { perDay: 0, why: 'runs end early for lack of cowoncy' };
        const more = hours(D + 0.1).perDay - h.perDay;
        if (more <= 0.001) return { perDay: more < -0.001 ? -1 : 0, why: more < -0.001 ? 'would hunt less at your check-in times' : 'runs already outlast your check-in gaps' };
        return { perDay: more * (gain + eff * perAnimal), why: `+${(more * 60).toFixed(0)} min hunting/day` };
      }
      case 'cost': {
        if (statOf('cost', l.cost) <= 5) return { perDay: 0, why: 'maxed' };
        const animals = cashShort && inp.cash !== null ? inp.cash / cost : eff * h.perDay;
        // short on cowoncy: a cheaper animal means more animals for the same cash; otherwise it just saves cowoncy
        return cashShort
          ? { perDay: (animals / (cost - 1) - animals / cost) * PER_ANIMAL.essence * h.sendsPerDay, why: 'more animals for the same cowoncy' }
          : { perDay: eff * h.perDay * k, why: `saves ${Math.round(eff * h.perDay)} cowoncy/day` };
      }
      default: return { perDay: 0, why: '' };
    }
  };
  const remaining = (t: HbTrait, l: HbLevels) => {
    const p = inp.progress?.[t];
    return l[t] === inp.levels[t] && p && p.need ? Math.max(0, p.need - p.progress) : levelCost(t, l[t]);
  };

  const ECON: HbTrait[] = ['gain', 'duration', 'efficiency', 'cost'];
  const rankAt = (l: HbLevels) => ECON.map((t) => {
    const v = value(t, l);
    const c = remaining(t, l);
    return { trait: t, perDay: v.perDay, cost: c, payback: v.perDay > 0 ? c / v.perDay : Infinity, why: v.why };
  });
  const all = rankAt(lv);
  // a level that takes over half a year to earn itself back isn't worth chasing yet
  const ranked = all.filter((p) => p.payback < 180).sort((a, b) => a.payback - b.payback);
  const skip: Plan['skip'] = all.filter((p) => !(p.payback < 180)).map((p) => ({ trait: p.trait, why: p.perDay > 0 ? `~${Math.round(p.payback)} days to pay back` : p.why }));
  // each radar level adds 0.000004% per animal: at your pace that's one extra bot animal every few decades
  const radarYears = 1 / (SPEC.radar.upg * eff(lv) * hours(statOf('duration', lv.duration)).perDay * 365);
  skip.push({ trait: 'radar', why: `1 bot animal per ~${Math.round(radarYears)} years a level` });

  // pour the essence on hand into the best trait, re-checking at every level since each level shifts the others
  const spend = new Map<HbTrait, { essence: number; levels: number }>();
  let left = inp.essence;
  const l = { ...lv };
  const firstRemaining = new Map<HbTrait, number>();
  for (let guard = 0; guard < 500 && left > 0; guard++) {
    const best = rankAt(l).filter((p) => p.payback < 180).sort((a, b) => a.payback - b.payback)[0];
    if (!best) break;
    const need = firstRemaining.has(best.trait) || l[best.trait] !== lv[best.trait] ? levelCost(best.trait, l[best.trait]) : best.cost;
    firstRemaining.set(best.trait, 1);
    const put = Math.min(left, need);
    const s = spend.get(best.trait) ?? { essence: 0, levels: 0 };
    s.essence += put;
    if (put >= need) { s.levels++; l[best.trait]++; }
    spend.set(best.trait, s);
    left -= put;
    if (put < need) break;
  }

  const h = hours(statOf('duration', lv.duration));
  const xpCost = remaining('experience', lv);
  return {
    hoursPerDay: h.perDay, sendsPerDay: h.sendsPerDay, measured,
    runCost, cashShort,
    essencePerDay: statOf('gain', lv.gain) * h.perDay + (cashShort ? 0 : eff(lv) * h.perDay * PER_ANIMAL.essence),
    ranked, skip,
    spend: [...spend].map(([trait, s]) => ({ trait, ...s })),
    left,
    xp: lv.experience < SPEC.experience.max ? { perDay: 35 * h.perDay, cost: xpCost } : null,
  };
}
const eff = (l: HbLevels) => statOf('efficiency', l.efficiency);

// ---------- what to sell and what to sacrifice ----------

export interface Hold { rank: string; count: number; animals: { animal: string; count: number }[] }
export interface SellPlan { sell: { rank: string; count: number; cowoncy: number; only?: { animal: string; count: number }[] }[]; sacrifice: { rank: string; count: number; essence: number; only?: { animal: string; count: number }[] }[]; keep: string[]; need: number }

// keep enough cowoncy for the next full run, raising it from the ranks that give the most cowoncy per essence given up,
// sacrifice the rest; team pets and anything the team helper wants are kept back
export function sellPlan(hold: Hold[], cash: number | null, runCost: number, keepAnimals: Set<string>): SellPlan {
  const need = Math.max(0, runCost - (cash ?? runCost));
  const keep: string[] = [];
  // only the plain ranks: gem, patreon, special and the rest are never sold or sacrificed here
  const usable = hold.filter((h) => RANK_VALUE[h.rank]).map((h) => {
    const kept = h.animals.filter((a) => keepAnimals.has(a.animal) && a.count > 0);
    for (const a of kept) keep.push(a.animal);
    // a rank holding a pet you want can't go by rank command, those animals are listed one by one instead
    const only = kept.length ? h.animals.filter((a) => !keepAnimals.has(a.animal) && a.count > 0) : undefined;
    return { rank: h.rank, count: h.count - kept.reduce((s, a) => s + a.count, 0), only };
  }).filter((h) => h.count > 0);
  // most cowoncy for each essence given up first
  const order = [...usable].sort((a, b) => RANK_VALUE[b.rank].sell / RANK_VALUE[b.rank].essence - RANK_VALUE[a.rank].sell / RANK_VALUE[a.rank].essence);
  let short = need;
  const sell: SellPlan['sell'] = [];
  const sold = new Map<string, number>();
  for (const h of order) {
    if (short <= 0) break;
    const v = RANK_VALUE[h.rank].sell;
    // OwO sells a whole rank at once, so whole ranks it is, even if that's a little more than needed
    const n = h.count;
    sell.push({ rank: h.rank, count: n, cowoncy: n * v, only: h.only });
    sold.set(h.rank, n);
    short -= n * v;
  }
  const sacrifice = usable.map((h) => ({ rank: h.rank, count: h.count - (sold.get(h.rank) ?? 0), only: h.only }))
    .filter((h) => h.count > 0).map((h) => ({ ...h, essence: h.count * RANK_VALUE[h.rank].essence }));
  return { sell, sacrifice, keep: [...new Set(keep)], need };
}
