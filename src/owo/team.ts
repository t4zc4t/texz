// Team building that judges pets on what they are, not on how far they've been levelled.
// OwO grows every stat in a straight line with level, so each pet's base stats are worked out (from the
// shared dex, or from its own numbers) and every pet is compared at the SAME level. A level 1 pet that
// would be stronger at your team's level is a real option, with the battles it needs to catch up shown.
// No battle simulator: OwO doesn't publish how it picks opponents, so this scores roles and fit instead.

export interface Base { hp: number; wp: number; str: number; mag: number; pr: number; mr: number }
export interface Candidate { animal: string; name: string; level: number; xp: number; base: Base; exact: boolean }
export interface Arm { id: string; type: string; quality: number; wpCost: number | null }

type Role = 'tank' | 'healer' | 'support' | 'str' | 'mag' | 'both';
// what each weapon does, read off OwO's own weapon descriptions
export const ROLE: Record<string, Role> = {
  "Defender's Aegis": 'tank',
  'Healing Staff': 'healer', 'Spirit Staff': 'healer', 'Staff of Purity': 'healer', 'Resurrection Staff': 'healer',
  "Vanguard's Banner": 'support', 'Arcane Scepter': 'support', 'Orb of Potency': 'support', 'Rune of Celebration': 'support', 'Rune of Luck': 'support',
  'Great Sword': 'str', 'Bow': 'str', 'Culling Scythe': 'str', 'Leeching Scythe': 'str', 'Staff of Corruption': 'str', 'Wounding Crossbow': 'str', 'Glacial Axe': 'str',
  'Energy Staff': 'mag', 'Flame Staff': 'mag', 'Wand of Absorption': 'mag', 'Conduit Claw': 'mag', 'Bleeding Gaze': 'mag', 'Soul Tithe': 'mag', 'Vampiric Staff': 'mag', 'Briar-Heart Staff': 'mag',
  'Poison Dagger': 'both', 'Foul Fish': 'both', "Arbiter's Edge": 'both', 'Rune of the Forgotten': 'both',
};
const TYPICAL_COST: Record<Role, number> = { tank: 200, healer: 190, support: 230, str: 150, mag: 160, both: 160 };

// ---------- stats ----------

const res = (base: number, L: number) => 25 + 2 * base * L;
export const resist = (base: number, L: number) => (0.8 * res(base, L)) / (100 + res(base, L));
export function statsAt(b: Base, L: number) {
  return { hp: 500 + 2 * b.hp * L, wp: 500 + 2 * b.wp * L, str: 100 + b.str * L, mag: 100 + b.mag * L, pr: resist(b.pr, L), mr: resist(b.mr, L) };
}

// base stats back out of a pet's numbers; resistances only come as a rounded %, so those are close, not exact
export function baseOf(p: { level: number; hp: number; wp: number; str: number; mag: number; pr: number; mr: number }): Base {
  const L = Math.max(1, p.level);
  const back = (pct: number) => {
    const x = Math.min(pct / 100, 0.79);
    const r = (100 * x) / (0.8 - x);
    return Math.max(0, (r - 25) / (2 * L));
  };
  return { hp: (p.hp - 500) / (2 * L), wp: (p.wp - 500) / (2 * L), str: (p.str - 100) / L, mag: (p.mag - 100) / L, pr: back(p.pr), mr: back(p.mr) };
}

// ---------- how well a pet holds a weapon ----------

// a fight is usually over in 5 to 7 turns: how much of it the pet can spend using its weapon
const castShare = (wp: number, cost: number) => Math.min(1, wp / (cost * 5));

export function fit(c: Candidate, arm: Arm | null, L: number) {
  const s = statsAt(c.base, L);
  const ehp = s.hp / (1 - (s.pr + s.mr) / 2);
  const role: Role = arm ? ROLE[arm.type] ?? 'both' : 'str';
  const cost = arm?.wpCost ?? TYPICAL_COST[role];
  const share = arm ? castShare(s.wp, cost) : 0;
  const power = arm ? 0.6 + 0.4 * (arm.quality / 100) : 0;
  // what the pet does with its turns: the weapon while it has WP, a plain STR hit after
  const hit = { str: s.str, mag: s.mag, both: Math.max(s.str, s.mag), tank: s.str, healer: s.mag, support: s.mag }[role];
  const work = role === 'tank' ? ehp / 4 * share + s.str * (1 - share) * 0.5
    : role === 'support' ? s.wp * 0.6 * share + s.str * (1 - share) * 0.5
    : hit * share * power + s.str * (1 - share) * 0.5;
  // staying alive is worth something to every role, more to the one taking the hits
  const stay = role === 'tank' ? ehp / 4 : ehp / 12;
  return { role, work, stay, value: work + stay, share, stats: s, ehp };
}

// ---------- catching up ----------

const xpFor = (lvl: number) => lvl ** 4 + 1000;
// wins needed to bring a pet up to the team's top level, with OwO's catch-up boost (2x plus 0.1x per level behind, up to 10x)
export function winsToCatchUp(level: number, xp: number, top: number, perWin = 200) {
  if (level >= top) return 0;
  let lvl = level;
  let have = xp;
  let wins = 0;
  while (lvl < top && wins < 100_000) {
    const mult = Math.min(10, 2 + (top - lvl) / 10);
    have += perWin * mult;
    wins++;
    while (have >= xpFor(lvl) && lvl < top) { have -= xpFor(lvl); lvl++; }
  }
  return wins;
}

// ---------- the best three ----------

export interface Plan { pets: { c: Candidate; arm: Arm | null; role: Role }[]; score: number }

function teamScore(picks: { c: Candidate; arm: Arm | null }[], L: number) {
  let score = 0;
  const roles = picks.map((p) => fit(p.c, p.arm, L));
  for (const r of roles) score += r.value;
  const has = (r: Role) => roles.some((x) => x.role === r);
  const count = (r: Role) => roles.filter((x) => x.role === r).length;
  // a team wants someone in front and someone keeping it going; two tanks or no damage at all is a mistake
  if (has('tank')) score *= 1.15;
  if (has('healer') || has('support')) score *= 1.1;
  if (count('tank') > 1) score *= 0.8;
  if (!roles.some((x) => ['str', 'mag', 'both'].includes(x.role))) score *= 0.75;
  return { score, roles };
}

export function bestTeam(candidates: Candidate[], arms: Arm[], L: number, size = 3): Plan | null {
  if (candidates.length < 1) return null;
  // the strongest of each weapon type is the one worth carrying
  const bestArm = new Map<string, Arm>();
  for (const a of arms) if (!bestArm.has(a.type) || a.quality > bestArm.get(a.type)!.quality) bestArm.set(a.type, a);
  const types = [...bestArm.values()];
  // shortlist pets on their best possible job so the search stays quick
  const ranked = candidates.map((c) => ({ c, top: Math.max(...types.map((a) => fit(c, a, L).value), fit(c, null, L).value) }))
    .sort((a, b) => b.top - a.top).slice(0, 10).map((x) => x.c);
  const shortArms = types.map((a) => ({ a, top: Math.max(...ranked.map((c) => fit(c, a, L).value)) })).sort((a, b) => b.top - a.top).slice(0, 10).map((x) => x.a);
  const n = Math.min(size, ranked.length);
  let best: Plan | null = null;
  const pick = (start: number, chosen: Candidate[]) => {
    if (chosen.length === n) {
      // give each chosen pet the weapon type that suits it, every way round
      const assign = (i: number, used: Set<string>, acc: { c: Candidate; arm: Arm | null }[]) => {
        if (i === chosen.length) {
          const { score, roles } = teamScore(acc, L);
          if (!best || score > best.score) best = { pets: acc.map((p, k) => ({ ...p, role: roles[k].role })), score };
          return;
        }
        for (const a of [...shortArms, null]) {
          if (a && used.has(a.type)) continue;
          if (a) used.add(a.type);
          assign(i + 1, used, [...acc, { c: chosen[i], arm: a }]);
          if (a) used.delete(a.type);
        }
      };
      assign(0, new Set(), []);
      return;
    }
    for (let i = start; i < ranked.length; i++) pick(i + 1, [...chosen, ranked[i]]);
  };
  pick(0, []);
  return best;
}

export function scoreOf(picks: { c: Candidate; arm: Arm | null }[], L: number) {
  return teamScore(picks, L).score;
}

// ---------- advice that stays honest ----------
// Weapon types are your call (comparing a Great Sword with a Crossbow needs a battle simulator), so the
// plan keeps the types your team uses and answers two questions it can judge well: which pet should hold
// each one, compared at the same level, and which copy of that weapon you own is the best one.

export interface Change { kind: 'pet' | 'swap' | 'weapon'; text: string; cmds: string[] }
export interface Advice { L: number; current: number; best: number; gain: number; picks: { c: Candidate; arm: Arm | null }[]; changes: Change[]; later: { c: Candidate; days: number; wins: number; role: string }[]; pace: number }

export function planFor(team: { animal: string; arm: Arm | null }[], candidates: Candidate[], arms: Arm[], pace: number, maxDays = 45): Advice | null {
  if (!team.length) return null;
  const byAnimal = new Map(candidates.map((c) => [c.animal, c]));
  const L = Math.max(...team.map((t) => byAnimal.get(t.animal)?.level ?? 1), ...candidates.map((c) => c.level));
  const top = Math.max(...team.map((t) => byAnimal.get(t.animal)?.level ?? 1));
  const daysFor = (c: Candidate) => winsToCatchUp(c.level, c.xp, top) / Math.max(1, pace);
  // the best copy of each weapon type: highest quality, as long as the WP cost isn't silly for the job
  const bestOf = (type: string) => arms.filter((a) => a.type === type).sort((a, b) => b.quality - a.quality)[0] ?? null;
  const slots = team.map((t) => t.arm ? bestOf(t.arm.type) ?? t.arm : null);
  const usable = candidates.filter((c) => daysFor(c) <= maxDays);
  const current = team.map((t) => ({ c: byAnimal.get(t.animal)!, arm: t.arm })).filter((p) => p.c);
  const curScore = scoreOf(current, L);
  // every way of putting usable pets on the team's weapons
  let best = { picks: current, score: curScore };
  const pool = [...usable].sort((a, b) => Math.max(...slots.map((s) => fit(b, s, L).value)) - Math.max(...slots.map((s) => fit(a, s, L).value))).slice(0, 9);
  const go = (i: number, used: Set<string>, acc: { c: Candidate; arm: Arm | null }[]) => {
    if (i === slots.length) {
      const sc = scoreOf(acc, L);
      if (sc > best.score) best = { picks: [...acc], score: sc };
      return;
    }
    for (const c of pool) {
      if (used.has(c.animal)) continue;
      used.add(c.animal);
      go(i + 1, used, [...acc, { c, arm: slots[i] }]);
      used.delete(c.animal);
    }
  };
  go(0, new Set(), []);
  const gain = curScore ? (best.score - curScore) / curScore : 0;
  const changes: Change[] = [];
  // only worth saying when it's a real difference, small shuffles aren't advice
  if (gain >= 0.06) {
    const curOn = new Map(current.map((p) => [p.c.animal, p.arm]));
    best.picks.forEach((p, i) => {
      const was = current[i];
      const arm = p.arm;
      const on = arm ? `the ${arm.type} \`${arm.id}\`` : 'no weapon';
      if (!curOn.has(p.c.animal)) {
        const wins = winsToCatchUp(p.c.level, p.c.xp, top);
        const s = statsAt(p.c.base, L);
        const old = was ? statsAt(was.c.base, L) : null;
        const role = arm ? ROLE[arm.type] ?? 'both' : 'str';
        const stat = role === 'tank' ? 'HP' : role === 'str' ? 'STR' : role === 'support' ? 'WP' : 'MAG';
        const val = (x: ReturnType<typeof statsAt>) => (stat === 'HP' ? x.hp : stat === 'STR' ? x.str : stat === 'WP' ? x.wp : x.mag);
        changes.push({
          kind: 'pet',
          text: `**${p.c.name}** ${was ? `replaces **${was.c.name}** on ` : 'takes '}${on} · ${stat} ${Math.round(val(s))}${old ? ` vs ${Math.round(val(old))}` : ''} at Lvl ${L}${wins ? ` · Lvl ${p.c.level} now, ~${wins.toLocaleString()} wins (~${Math.ceil(wins / Math.max(1, pace))}d) to catch up` : ''}`,
          cmds: [`w team add ${p.c.animal} ${i + 1}`, ...(arm ? [`w w ${arm.id} ${p.c.animal}`] : [])],
        });
      } else if (curOn.get(p.c.animal)?.id !== arm?.id) {
        changes.push({ kind: curOn.get(p.c.animal)?.type === arm?.type ? 'weapon' : 'swap', text: `**${p.c.name}** should hold ${on}${curOn.get(p.c.animal) ? ` instead of the ${curOn.get(p.c.animal)!.type} \`${curOn.get(p.c.animal)!.id}\`` : ''}.`, cmds: arm ? [`w w ${arm.id} ${p.c.animal}`] : [] });
      }
    });
  } else {
    // same pets, but a better copy of a weapon they already use is still worth a word
    current.forEach((p, i) => {
      const better = slots[i];
      if (p.arm && better && better.id !== p.arm.id && better.quality - p.arm.quality >= 3) {
        changes.push({ kind: 'weapon', text: `**${p.c.name}** has the ${p.arm.type} \`${p.arm.id}\` at ${p.arm.quality}%, you own a ${better.quality}% one: \`${better.id}\`.`, cmds: [`w w ${better.id} ${p.c.animal}`] });
      }
    });
  }
  // strong pets that are too far behind for now, shown as ideas and never as the advice
  const later = candidates.filter((c) => !best.picks.some((p) => p.c.animal === c.animal) && daysFor(c) > maxDays)
    .map((c) => ({ c, days: Math.round(daysFor(c)), wins: winsToCatchUp(c.level, c.xp, top), best: Math.max(...slots.map((s) => fit(c, s, L).value)), role: '' }))
    .filter((x) => slots.some((s, i) => fit(x.c, s, L).value > fit(best.picks[i]?.c ?? x.c, s, L).value * 1.15))
    .sort((a, b) => b.best - a.best).slice(0, 2).map(({ c, days, wins }) => ({ c, days, wins, role: '' }));
  return { L, current: curScore, best: best.score, gain, picks: best.picks, changes, later, pace };
}
