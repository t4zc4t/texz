import { fitRanges, rollOf, slotsOf, type Ranges, type Sample } from './ranges.js';
import type { OwoState } from './state.js';
import type { Reroll, RollSide } from './read.js';

// Weapon advice. Quality is only compared between weapons of the same type: a 60% Resurrection Staff
// can be worth more than a 90% Bow, so nothing here ranks different weapon types against each other.

export const SHARDS: Record<string, number> = { common: 1, uncommon: 3, rare: 5, epic: 25, mythic: 300, legendary: 1000, fabled: 5000 };
export const WEAR_BONUS: Record<string, number> = { pristine: 5, fine: 3, decent: 1, worn: 0, unknown: 0 };
const RANK = ['common', 'uncommon', 'rare', 'epic', 'mythic', 'legendary', 'fabled'];

let cached: { at: number; ranges: Ranges; count: number } | null = null;
export function rangesFrom(state: OwoState): Ranges {
  const samples = state.samples();
  if (cached && Date.now() - cached.at < 30 * 60_000 && cached.count === samples.length) return cached.ranges;
  const ranges = fitRanges(samples as Sample[]);
  cached = { at: Date.now(), ranges, count: samples.length };
  return ranges;
}

// chance that the average of k fresh 0-100 rolls beats a target, the Irwin-Hall sum of uniforms
export function chanceAbove(k: number, target: number): number {
  if (k <= 0) return 0;
  const x = Math.min(Math.max(target / 100, 0), 1) * k;
  let cdf = 0;
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  for (let j = 0; j <= Math.floor(x); j++) {
    let comb = 1;
    for (let i = 0; i < j; i++) comb = (comb * (k - i)) / (i + 1);
    cdf += (j % 2 ? -1 : 1) * comb * Math.pow(x - j, k);
  }
  return Math.min(1, Math.max(0, 1 - cdf / fact));
}

const label = (key: string, index: number) => {
  const [kind, name, i] = key.split(':');
  if (kind === 'p') return i === '0' ? name : `${name} (${Number(i) + 1})`;
  if (i === 'cost') return 'WP cost';
  return index === 0 ? 'Main effect' : `Effect ${index + 1}`;
};

export interface SlotRoll { key: string; label: string; value: number; roll: number | null; min: number | null; max: number | null; passive: boolean }

export function slotRolls(ranges: Ranges, x: { weapon: string; wpCost: number | null; rolls: number[]; passives: { name: string; rolls: number[] }[] }): SlotRoll[] {
  let wi = 0;
  return slotsOf(x).map(([key, value]) => {
    const s = ranges.slots.get(key);
    const roll = rollOf(ranges.slots, key, value);
    const isP = key.startsWith('p:');
    const out = { key, label: label(key, isP || key.endsWith(':cost') ? 0 : wi), value, roll, min: s?.sane ? s.min : null, max: s?.sane ? s.max : null, passive: isP };
    if (!isP && !key.endsWith(':cost')) wi++;
    return out;
  });
}

export interface Report {
  rolls: SlotRoll[];
  weaponPart: number | null;
  passivePart: number | null;
  advice: { kind: 'keep' | 'stat' | 'passive' | 'locked' | 'unknown'; why: string; chance: number | null; shards: number | null };
  sure: boolean;
}

// what a weapon's numbers say and whether it's worth shards. "target" is a quality worth chasing:
// the next rarity line or five points up, whichever is closer
export function report(ranges: Ranges, w: { name: string | null; quality: number | null; wear: string | null; empowered: boolean; wpCost: number | null; rolls: number[] | null; passives: { name: string; rolls: number[] }[] | null }): Report {
  const x = { weapon: w.name ?? '', wpCost: w.wpCost, rolls: w.rolls ?? [], passives: w.passives ?? [] };
  const rolls = slotRolls(ranges, x);
  const avg = (l: SlotRoll[]) => (l.length && l.every((r) => r.roll !== null) ? l.reduce((n, r) => n + r.roll!, 0) / l.length : null);
  const weaponPart = avg(rolls.filter((r) => !r.passive));
  const passivePart = avg(rolls.filter((r) => r.passive));
  const sure = rolls.length > 0 && rolls.every((r) => r.roll !== null);
  const q = w.quality ?? 0;
  const wear = WEAR_BONUS[w.wear ?? 'worn'] ?? 0;
  if (w.empowered) return { rolls, weaponPart, passivePart, sure, advice: { kind: 'locked', why: 'Empowered, can\'t be rerolled.', chance: null, shards: null } };
  // stat rerolls redraw every number, so the bar is the whole weapon's current quality
  const k = rolls.length || 2;
  const nextLine = [20, 40, 60, 80, 95, 100].find((l) => l > q) ?? 105;
  const target = Math.min(nextLine, q + 5);
  const chance = chanceAbove(k, target - wear);
  const shards = chance > 0 ? Math.round(100 / chance) : null;
  if (q >= 95) return { rolls, weaponPart, passivePart, sure, advice: { kind: 'keep', why: 'Already 95%+, keep it.', chance, shards } };
  // a strong weapon part with a weak passive: reroll the passive, it keeps the weapon's own numbers
  if (weaponPart !== null && passivePart !== null && weaponPart >= 75 && passivePart < 50) {
    return { rolls, weaponPart, passivePart, sure, advice: { kind: 'passive', why: `Stats ${Math.round(weaponPart)}%, passive ${Math.round(passivePart)}%.`, chance: null, shards: null } };
  }
  if (chance < 0.02) return { rolls, weaponPart, passivePart, sure, advice: { kind: 'keep', why: `~1 in ${Math.round(1 / Math.max(chance, 1e-6))} to beat ${target.toFixed(0)}%, not worth it.`, chance, shards } };
  return { rolls, weaponPart, passivePart, sure, advice: { kind: 'stat', why: `~1 in ${Math.max(1, Math.round(1 / chance))} to beat ${target.toFixed(0)}%.`, chance, shards } };
}

// ---------- live reroll verdict ----------

export interface Verdict { pick: 'confirm' | 'cancel' | 'your call'; headline: string; lines: string[]; odds: string | null; stop: boolean }

export function verdict(ranges: Ranges, r: Reroll, shards: number | null): Verdict {
  const toX = (s: RollSide) => ({ weapon: r.name, wpCost: s.wpCost, rolls: s.rolls, passives: s.passives });
  const a = slotRolls(ranges, toX(r.current));
  const b = slotRolls(ranges, toX(r.next));
  const lines: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (!y) continue;
    if (x && x.key === y.key) {
      if (x.value === y.value) continue;
      const better = y.key.endsWith(':cost') ? y.value < x.value : y.value > x.value;
      lines.push(`${better ? '▲' : '▼'} ${y.label} ${x.value} → **${y.value}**${y.roll !== null ? ` (${Math.round(y.roll)}%)` : ''}`);
    } else lines.push(`✦ ${y.label} **${y.value}**${y.roll !== null ? ` (${Math.round(y.roll)}%)` : ''}`);
  }
  const wearDown = (WEAR_BONUS[r.next.wear ?? 'worn'] ?? 0) < (WEAR_BONUS[r.current.wear ?? 'worn'] ?? 0);
  if (wearDown) lines.push(`⚠️ Wear ${r.current.wear} → ${r.next.wear}`);
  const diff = r.next.quality - r.current.quality;
  // the main effect counts most, then other effects, then WP cost and passives; plain quality when a range is unknown
  const weight = (x: SlotRoll, i: number) => (x.passive ? 1 : x.key.endsWith(':cost') ? 1 : i === 0 ? 2 : 1.5);
  const score = (l: SlotRoll[]) => (l.length && l.every((x) => x.roll !== null) ? l.reduce((n, x, i) => n + x.roll! * weight(x, i), 0) / l.reduce((n, x, i) => n + weight(x, i), 0) : null);
  const sa = score(a);
  const sb = score(b);
  const gain = sa !== null && sb !== null ? sb - sa : diff;
  const samePassive = r.current.passives.map((p) => p.name).join() === r.next.passives.map((p) => p.name).join();
  // how often a fresh roll beats what you'd keep, the better of the two sides
  const keep = Math.max(r.current.quality, r.next.quality);
  const k = b.length || 2;
  const p = chanceAbove(k, keep - (WEAR_BONUS[r.next.wear ?? 'worn'] ?? 0));
  const odds = p > 0 ? `~1 in ${Math.max(1, Math.round(1 / p))} to beat ${keep}% (~${Math.round(100 / p).toLocaleString()} shards${shards !== null ? `, you have ${shards.toLocaleString()}` : ''})` : null;
  const stop = p < 0.03;
  if (r.kind === 'passive' && !samePassive) {
    return { pick: 'your call', headline: `New passive: **${r.next.passives.map((x) => x.name).join(', ')}** · ${r.current.quality}% → ${r.next.quality}%. Your call.`, lines, odds, stop };
  }
  // the shards are spent either way, so a better roll is free to take unless confirming wears the weapon down
  const need = wearDown ? 2 : 0;
  if (gain > need) return { pick: 'confirm', headline: `**Confirm.** ${r.current.quality}% → ${r.next.quality}%`, lines, odds, stop };
  if (diff > 0 && gain <= need) return { pick: 'cancel', headline: `**Cancel.** ${wearDown ? 'Wear drops' : 'Weaker main effect'}, keep ${r.current.quality}%.`, lines, odds, stop };
  return { pick: 'cancel', headline: `**Cancel.** ${r.next.quality}% vs ${r.current.quality}%.`, lines, odds, stop };
}

// ---------- what can go ----------

export interface Scrap { id: string; name: string; rarity: string; quality: number; shards: number; why: string }

// never: weapons on a pet, favourites, empowered ones, pristine or fine wear, legendary and up.
// The best two of every weapon type stay too, so team building always has options of each kind
export function dismantleList(weapons: ReturnType<OwoState['weapons']>) {
  const name = (w: (typeof weapons)[number]) => w.name ?? w.type ?? '?';
  const byType = new Map<string, typeof weapons>();
  for (const w of weapons) byType.set(name(w), [...(byType.get(name(w)) ?? []), w]);
  const keepBest = new Set<string>();
  for (const list of byType.values()) for (const w of [...list].sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0)).slice(0, 2)) keepBest.add(w.id);
  const safe: Scrap[] = [];
  const think: Scrap[] = [];
  for (const w of weapons) {
    const rarity = w.rarity ?? 'common';
    if (w.on || w.favourite || w.empowered || keepBest.has(w.id)) continue;
    if (w.wear === 'pristine' || w.wear === 'fine') continue;
    if (RANK.indexOf(rarity) >= RANK.indexOf('legendary')) continue;
    const best = (byType.get(name(w)) ?? []).reduce((m, x) => Math.max(m, x.quality ?? 0), 0);
    const item = { id: w.id, name: name(w), rarity, quality: w.quality ?? 0, shards: SHARDS[rarity] ?? 0, why: `you have a ${best}% ${name(w)}` };
    if (rarity === 'mythic') think.push(item);
    else safe.push(item);
  }
  // a whole rarity can go with one OwO command when nothing of that rarity needs keeping
  const ranks = new Map<string, number>();
  for (const s of safe) ranks.set(s.rarity, (ranks.get(s.rarity) ?? 0) + 1);
  const whole = [...ranks.keys()].filter((r) => weapons.filter((w) => (w.rarity ?? '') === r && !w.on && !w.favourite).every((w) => safe.some((s) => s.id === w.id)));
  return { safe: safe.sort((a, b) => b.shards - a.shards || a.quality - b.quality), think: think.sort((a, b) => a.quality - b.quality), whole };
}
