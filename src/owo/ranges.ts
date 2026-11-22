// How good each number on a weapon is. OwO rolls every number on a weapon 0-100 and scales it into
// that number's range: value = min + (max - min) * roll / 100. Quality is the average roll, plus the wear
// bonus, and the wear bonus cancels out, so every weapon seen with full numbers gives one equation:
//   sum over its numbers of (value - min) / (max - min) * 100 = count * quality
// OwO's public code gives the ranges it had in 2024. Those are the starting point, and every sample
// (weapon cards, the shop, each reroll try) pulls them towards what OwO does today.

// [min, max] from OwO's code; for WP cost min is the cost at roll 0 (the expensive end)
const WEAPON_PRIOR: Record<string, { rolls: [number, number][]; cost?: [number, number] }> = {
  'Wand of Absorption': { rolls: [[80, 100], [20, 40]], cost: [250, 150] },
  'Arcane Scepter': { rolls: [[40, 70]], cost: [200, 125] },
  'Bow': { rolls: [[110, 160]], cost: [220, 120] },
  'Culling Scythe': { rolls: [[70, 100]], cost: [200, 100] },
  'Energy Staff': { rolls: [[35, 65]], cost: [200, 100] },
  'Flame Staff': { rolls: [[75, 95]], cost: [200, 100] },
  'Foul Fish': { rolls: [[50, 80]], cost: [280, 180] },
  'Glacial Axe': { rolls: [[20, 40]], cost: [280, 180] },
  'Great Sword': { rolls: [[35, 55]], cost: [200, 100] },
  'Healing Staff': { rolls: [[100, 150]], cost: [225, 150] },
  'Leeching Scythe': { rolls: [[50, 80], [40, 60]], cost: [230, 130] },
  'Poison Dagger': { rolls: [[70, 100]], cost: [200, 100] },
  'Staff of Purity': { rolls: [[50, 100], [50, 100]], cost: [200, 125] },
  'Resurrection Staff': { rolls: [[50, 80]], cost: [400, 300] },
  'Rune of the Forgotten': { rolls: [[5, 15]] },
  'Spirit Staff': { rolls: [[30, 50]], cost: [225, 125] },
  'Vampiric Staff': { rolls: [[25, 45]], cost: [200, 100] },
  "Defender's Aegis": { rolls: [], cost: [250, 150] },
  "Vanguard's Banner": { rolls: [], cost: [300, 250] },
};
const PASSIVE_PRIOR: Record<string, [number, number][]> = {
  'Absolve': [[60, 80]], 'Critical': [[10, 30], [25, 50]], 'Discharge': [[100, 140]], 'Energize': [[20, 40]], 'Enrage': [[1, 4]],
  'Health Point': [[5, 20]], 'Kamikaze': [[50, 75]], 'Knowledge': [[5, 15]], 'Lifesteal': [[15, 35]], 'Magic': [[5, 20]],
  'Magical Resistance': [[15, 35]], 'Mana Tap': [[15, 30]], 'Physical Resistance': [[15, 35]], 'Regeneration': [[5, 10]],
  'Sacrifice': [[50, 75], [50, 75]], 'Safeguard': [[20, 40]], 'Snail': [[5, 15]], 'Sprout': [[20, 40]], 'Strength': [[5, 20]],
  'Thorns': [[15, 35]], 'Weapon Point': [[10, 30]],
};

export interface Sample { weapon: string; quality: number; wpCost: number | null; rolls: number[]; passives: { name: string; rolls: number[] }[] }
export interface Slot { min: number; max: number; samples: number; known: boolean; sane: boolean }
export interface Ranges { slots: Map<string, Slot>; fit: Map<string, { samples: number; error: number }> }

// the numbers on one weapon as named slots: "w:Great Sword:0", "w:Great Sword:cost", "p:Strength:0"
export function slotsOf(x: { weapon: string; wpCost: number | null; rolls: number[]; passives: { name: string; rolls: number[] }[] }): [string, number][] {
  const out: [string, number][] = x.rolls.map((v, i) => [`w:${x.weapon}:${i}`, v]);
  if (x.wpCost !== null) out.push([`w:${x.weapon}:cost`, x.wpCost]);
  for (const p of x.passives) p.rolls.forEach((v, i) => out.push([`p:${p.name}:${i}`, v]));
  return out;
}

function prior(key: string): [number, number] | null {
  const [kind, name, i] = key.split(':');
  if (kind === 'w') {
    const w = WEAPON_PRIOR[name];
    if (!w) return null;
    return i === 'cost' ? w.cost ?? null : w.rolls[Number(i)] ?? null;
  }
  return PASSIVE_PRIOR[name]?.[Number(i)] ?? null;
}

// solves (A'A + L) x = A'y + L x0 by elimination, small enough to do directly
function solve(M: number[][], b: number[]): number[] {
  const n = b.length;
  const a = M.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c || !a[r][c]) continue;
      const f = a[r][c] / d;
      for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
    }
  }
  return a.map((r, i) => r[n] / (r[i] || 1e-12));
}

// every slot as roll = c * (value / scale) + e, linear in c and e, priors keep slots with little data sensible
export function fitRanges(samples: Sample[], stale = new Set<string>()): Ranges {
  const keys = new Map<string, { scale: number; lo: number; hi: number; n: number }>();
  for (const s of samples) for (const [k, v] of slotsOf(s)) {
    const cur = keys.get(k) ?? { scale: 0, lo: Infinity, hi: -Infinity, n: 0 };
    cur.scale = Math.max(cur.scale, Math.abs(v), 1e-6);
    cur.lo = Math.min(cur.lo, v);
    cur.hi = Math.max(cur.hi, v);
    cur.n++;
    keys.set(k, cur);
  }
  for (const [k, info] of keys) { const p = stale.has(k) ? null : prior(k); if (p) info.scale = Math.max(Math.abs(p[0]), Math.abs(p[1])); }
  const list = [...keys.keys()];
  const at = new Map(list.map((k, i) => [k, i]));
  const n = list.length * 2;
  const AtA = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const Aty = new Array<number>(n).fill(0);
  for (const s of samples) {
    const sl = slotsOf(s);
    if (!sl.length) continue;
    const row = new Map<number, number>();
    for (const [k, v] of sl) {
      const i = at.get(k)! * 2;
      row.set(i, (row.get(i) ?? 0) + v / keys.get(k)!.scale);
      row.set(i + 1, (row.get(i + 1) ?? 0) + 1);
    }
    const y = sl.length * s.quality;
    for (const [i, vi] of row) {
      Aty[i] += vi * y;
      for (const [j, vj] of row) AtA[i][j] += vi * vj;
    }
  }
  // priors: OwO's own ranges weigh like a few samples, a guess from what was seen weighs much less
  for (const [k, info] of keys) {
    const i = at.get(k)! * 2;
    const p = stale.has(k) ? null : prior(k);
    let lo: number, hi: number, w: number, we: number;
    // passives are shared by every weapon, so holding them firm pins everything else; WP costs have
    // clearly been retuned since OwO's code was published, so those follow the samples
    if (p) { [lo, hi] = p; w = k.startsWith('p:') ? 30 : 3; we = k.startsWith('p:') ? 30 : k.endsWith(':cost') ? 0.03 : 1; } else {
      const spread = Math.max(info.hi - info.lo, Math.abs(info.hi) * 0.3, 1e-3);
      const cost = k.endsWith(':cost');
      lo = cost ? info.hi + spread * 0.3 : Math.max(0, info.lo - spread * 0.3);
      hi = cost ? Math.max(1, info.lo - spread * 0.3) : info.hi + spread * 0.3;
      w = 0.05; we = 0.05;
    }
    const c0 = (100 * info.scale) / (hi - lo);
    const e0 = (-100 * lo) / (hi - lo);
    AtA[i][i] += w; Aty[i] += w * c0;
    AtA[i + 1][i + 1] += we; Aty[i + 1] += we * e0;
  }
  const x = solve(AtA, Aty);
  const slots = new Map<string, Slot>();
  for (const [k, info] of keys) {
    const i = at.get(k)! * 2;
    const c = x[i] / info.scale;
    const e = x[i + 1];
    const min = -e / c;
    const max = (100 - e) / c;
    // a range has to make sense: positive, the right way round, and holding every value seen,
    // allowing the wear bonus that can push a value up to 5% of the range past the top
    const cost = k.endsWith(':cost');
    const pad = Math.abs(max - min) * 0.06 + 0.05;
    const sane = Number.isFinite(min) && Number.isFinite(max) && min >= 0 && max >= 0 && (cost ? min > max : max > min)
      && Math.min(min, max) - pad <= info.lo && Math.max(min, max) + pad >= info.hi;
    slots.set(k, { min: Math.round(min * 100) / 100, max: Math.round(max * 100) / 100, samples: info.n, known: !!prior(k) && !stale.has(k), sane });
  }
  const fit = new Map<string, { samples: number; error: number }>();
  for (const s of samples) {
    const q = estimate(s, slots);
    if (q === null) continue;
    const f = fit.get(s.weapon) ?? { samples: 0, error: 0 };
    f.samples++;
    f.error += Math.abs(q - s.quality);
    fit.set(s.weapon, f);
  }
  for (const f of fit.values()) f.error = f.samples ? f.error / f.samples : 0;
  // a range from OwO's old code that the samples don't fit has changed since, fit it again from the samples alone
  const wrong = [...slots].filter(([k, sl]) => sl.known && !sl.sane && !stale.has(k)).map(([k]) => k);
  if (wrong.length && stale.size === 0) return fitRanges(samples, new Set(wrong));
  return { slots, fit };
}

// how high one number rolled in its range, 0-100 (a bit over 100 with a wear bonus)
export function rollOf(slots: Map<string, Slot>, key: string, value: number): number | null {
  const s = slots.get(key);
  if (!s || s.max === s.min || !s.sane) return null;
  return ((value - s.min) / (s.max - s.min)) * 100;
}

// the quality these numbers add up to with the learnt ranges, to check the ranges against OwO's own figure
export function estimate(x: Sample, slots: Map<string, Slot>): number | null {
  const sl = slotsOf(x);
  if (!sl.length) return null;
  let sum = 0;
  for (const [k, v] of sl) {
    const r = rollOf(slots, k, v);
    if (r === null) return null;
    sum += r;
  }
  return sum / sl.length;
}
