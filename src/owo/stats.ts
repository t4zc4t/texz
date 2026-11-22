// Numbers from your own OwO history: battles, catches and the daily collectibles.
// Everything here is worked out from what Texz has read since it started watching, nothing is guessed.

import { RANK_ORDER } from './catalog.js';
import { RANK_VALUE } from './huntbot.js';
import { nextOwoDay } from './pings.js';
import type { OwoState } from './state.js';

const DAY = 86_400_000;

// ---------- battles ----------

export interface BattleWindow { label: string; n: number; won: number; lost: number; tie: number; xp: number; turns: number; days: number }

export function battleStats(st: OwoState, userId: string, now = Date.now()) {
  const all = st.battles(userId);
  const windows: [string, number][] = [['Last 24 hours', DAY], ['Last 7 days', 7 * DAY], ['Everything logged', Infinity]];
  const out: BattleWindow[] = windows.map(([label, span]) => {
    const list = all.filter((b) => now - b.at <= span);
    const first = list.length ? list[list.length - 1].at : now;
    return {
      label, n: list.length,
      won: list.filter((b) => b.result === 'won').length,
      lost: list.filter((b) => b.result === 'lost').length,
      tie: list.filter((b) => b.result === 'tie').length,
      xp: list.reduce((s, b) => s + (b.xp ?? 0), 0),
      turns: list.reduce((s, b) => s + (b.turns ?? 0), 0),
      // a day's numbers are a day's; a short log isn't stretched into a whole week, nor squeezed below a day
      days: span === DAY ? 1 : Math.max(Math.min((now - first) / DAY, span / DAY), 1),
    };
  });
  const streaks = all.map((b) => b.streak ?? 0);
  return { windows: out, current: all[0]?.streak ?? null, best: streaks.length ? Math.max(...streaks) : null, since: all.length ? all[all.length - 1].at : null };
}

const xpFor = (lvl: number) => lvl ** 4 + 1000;

export interface Pace { xpPer: number; perDay: number; hbPerDay: number }

// your pace from the last week: xp a battle (what the top pet gets), battles a day, HuntBot xp a day
export function paceOf(st: OwoState, userId: string, hbPerDay = 0, now = Date.now()): Pace | null {
  const week = st.battles(userId, now - 7 * DAY);
  if (week.length < 5) return null;
  const xpPer = week.reduce((s, b) => s + (b.xp ?? 0), 0) / week.length;
  const first = week[week.length - 1].at;
  return { xpPer, perDay: week.length / Math.max((now - first) / DAY, 1), hbPerDay };
}

export interface TeamPetNow { animal: string; name: string; level: number; xp: number }

// plays the team forward battle by battle the way OwO pays out: the top pet gets the battle's xp,
// lower ones get 2× plus 0.1× per level behind (up to 10×), HuntBot xp goes to everyone in full
export function forecast(team: TeamPetNow[], pace: Pace, who: string, target: number, cap = 200_000) {
  const pets = team.map((p) => ({ ...p }));
  const me = pets.find((p) => p.animal === who);
  if (!me || me.level >= target) return { battles: 0, days: 0 };
  const hbPerBattle = pace.perDay > 0 ? pace.hbPerDay / pace.perDay : 0;
  let n = 0;
  while (me.level < target && n < cap) {
    const top = Math.max(...pets.map((p) => p.level));
    for (const p of pets) {
      const mult = p.level < top ? Math.min(10, 2 + (top - p.level) / 10) : 1;
      p.xp += pace.xpPer * mult + hbPerBattle;
      while (p.xp >= xpFor(p.level)) { p.xp -= xpFor(p.level); p.level++; }
    }
    n++;
  }
  return n >= cap ? null : { battles: n, days: n / pace.perDay };
}

// the newest team with each pet's level and xp
export function teamNow(st: OwoState, userId: string): TeamPetNow[] {
  const team = st.teams(userId).sort((a, b) => b.at - a.at)[0];
  if (!team) return [];
  const pets = new Map(st.pets(userId).map((p) => [p.animal, p]));
  return team.animals.map((a) => pets.get(a)).filter((p) => !!p).map((p) => ({ animal: p!.animal, name: p!.name, level: p!.level, xp: p!.xp }));
}

// ---------- catches ----------

export function catchStats(st: OwoState, userId: string) {
  const rows = st.tally(userId);
  const by = (source: string) => {
    const m = new Map<string, number>();
    for (const r of rows.filter((x) => x.source === source)) m.set(r.rank, r.n);
    return m;
  };
  const hunt = by('hunt');
  const bot = by('huntbot');
  const hunts = hunt.get('hunts') ?? 0;
  hunt.delete('hunts');
  const since = rows.length ? Math.min(...rows.map((r) => r.since)) : null;
  // your luck: what you got against what OwO's odds say you should have by now
  const luck = (m: Map<string, number>) => {
    const total = [...m.values()].reduce((s, n) => s + n, 0);
    return ['epic', 'mythic', 'legendary', 'fabled'].map((r) => {
      const expected = (total * RANK_VALUE[r].rarity) / 100;
      return { rank: r, got: m.get(r) ?? 0, expected };
    }).filter((x) => x.got > 0 || x.expected >= 0.5);
  };
  const idx = (r: string) => (RANK_ORDER.includes(r) ? RANK_ORDER.indexOf(r) : 99);
  const order = (m: Map<string, number>) => [...m].sort((a, b) => idx(a[0]) - idx(b[0]));
  return { hunts, hunt: order(hunt), bot: order(bot), since, luckHunt: luck(hunt), luckBot: luck(bot) };
}

// ---------- collectibles ----------

export const COLLECTIBLES: Record<string, { label: string; cmd: string; kind: 'pet' | 'game' }> = {
  alastor: { label: 'Alastor', cmd: 'w alastor', kind: 'pet' },
  babyyoda: { label: 'Baby Yoda', cmd: 'w babyyoda', kind: 'pet' },
  run: { label: 'Run', cmd: 'w run', kind: 'game' },
  piku: { label: 'PikPik carrots', cmd: 'w piku', kind: 'game' },
  puppy: { label: 'Puppies', cmd: 'w puppy', kind: 'game' },
};

export interface Collectible { key: string; label: string; cmd: string; today: boolean; done: boolean; line: string }

// what you keep up daily, and whether today's is done. OwO's day starts at midnight in Los Angeles
export function collectibles(st: OwoState, userId: string, now = Date.now()): Collectible[] {
  const dayStart = nextOwoDay(now) - 60_000 - DAY;
  const bits = st.bits(userId);
  const out: Collectible[] = [];
  for (const [key, c] of Object.entries(COLLECTIBLES)) {
    const b = bits.get(`${c.kind}:${key}`);
    if (!b) continue;
    const today = b.at >= dayStart;
    if (c.kind === 'pet') {
      const v = b.value as { streak: number };
      out.push({ key, label: c.label, cmd: c.cmd, today, done: today, line: `🔥 streak **${v.streak}**` });
    } else {
      const v = b.value as { done: number | null; of: number | null; total: number | null; out: boolean };
      const done = today && (v.out || (v.done !== null && v.of !== null && v.done >= v.of));
      const prog = today && v.done !== null ? `${v.done}/${v.of ?? '?'}` : '0 today';
      out.push({ key, label: c.label, cmd: c.cmd, today, done, line: `${prog}${v.total !== null ? ` · ${v.total.toLocaleString()} total` : ''}` });
    }
  }
  return out;
}
