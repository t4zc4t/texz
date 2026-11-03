// gem ids from owo inv, tiers run common to fabled
const tiers = ['common', 'uncommon', 'rare', 'epic', 'mythical', 'legendary', 'fabled'] as const;
const base = { hunting: 51, empowering: 65, lucky: 72, special: 79 } as const;
type Kind = keyof typeof base;

// how many animals each tier lasts, from the OwO wiki
export const durability = [50, 100, 250, 450, 525, 800, 1000];

export interface GemPlan {
  lines: string[];
  owned: Record<Kind, number[]>;
}

export function planGems(inv: Map<number, number>): GemPlan {
  const owned = {} as Record<Kind, number[]>;
  for (const k of Object.keys(base) as Kind[]) owned[k] = tiers.map((_, i) => inv.get(base[k] + i) ?? 0);

  const lines: string[] = [];
  const left = { hunting: [...owned.hunting], empowering: [...owned.empowering], lucky: [...owned.lucky] };

  // same-tier gems run out together, so full sets of one tier waste nothing
  for (let i = tiers.length - 1; i >= 0; i--) {
    const full = Math.min(left.hunting[i], left.empowering[i], left.lucky[i]);
    if (full > 0) {
      lines.push(`${full}x ${tiers[i]} full set: \`owo use ${base.hunting + i} ${base.empowering + i} ${base.lucky + i}\` (${durability[i]} animals each)`);
      left.hunting[i] -= full; left.empowering[i] -= full; left.lucky[i] -= full;
    }
  }
  for (let i = tiers.length - 1; i >= 0; i--) {
    const pair = Math.min(left.hunting[i], left.empowering[i]);
    if (pair > 0) {
      lines.push(`${pair}x ${tiers[i]} hunting + empowering: \`owo use ${base.hunting + i} ${base.empowering + i}\``);
      left.hunting[i] -= pair; left.empowering[i] -= pair;
    }
  }
  const spare: string[] = [];
  for (const k of ['hunting', 'empowering', 'lucky'] as const) {
    left[k].forEach((n, i) => { if (n > 0) spare.push(`${n} ${tiers[i]} ${k}`); });
  }
  if (spare.length) lines.push(`Leftovers to use once the sets run out: ${spare.join(', ')}.`);

  const specials = owned.special.reduce((a, b) => a + b, 0);
  if (specials) lines.push(`You have ${specials} special gems, keep them for events, they do nothing otherwise.`);

  const emp = owned.empowering.reduce((a, b) => a + b, 0);
  const hunt = owned.hunting.reduce((a, b) => a + b, 0);
  if (emp < hunt / 2) lines.push('Empowering gems are your bottleneck, open every lootbox you get.');
  if (!lines.length) lines.push('No hunting gems in this inventory, open lootboxes with `owo lb all` first.');
  lines.push('Before using any, do one `owo hunt` to see what is already active, an active gem cannot be swapped out.');
  return { lines, owned };
}

// gems left of each kind that matters for hunting, every tier added up
export function gemTotals(inv: Map<number, number>) {
  const out = {} as Record<'hunting' | 'empowering' | 'lucky', number>;
  for (const k of ['hunting', 'empowering', 'lucky'] as const) out[k] = tiers.reduce((a, _, i) => a + (inv.get(base[k] + i) ?? 0), 0);
  return out;
}
