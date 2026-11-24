// OwO's gems (gems.json) and how a hunt uses them up (catch.js):
// Hunting adds its amount to every hunt and loses 1 a hunt, Empowering doubles the animals and loses half of them,
// Lucky and Special lose every animal, or only half when Hunting and Empowering are both running.

export type GemType = 'Hunting' | 'Patreon' | 'Empowering' | 'Lucky' | 'Special';
export interface Gem { key: string; id: number; type: GemType; amount: number; length: number }

const TIERS = ['c', 'u', 'r', 'e', 'm', 'l', 'f'];
const TIER_NAME: Record<string, string> = { c: 'common', u: 'uncommon', r: 'rare', e: 'epic', m: 'mythic', l: 'legendary', f: 'fabled' };
const TABLE: [GemType, number, number[], number[]][] = [
  ['Hunting', 51, [1, 3, 4, 5, 6, 7, 9], [25, 25, 50, 75, 75, 100, 100]],
  ['Patreon', 58, [0, 0, 0, 0, 0, 0, 0], [25, 50, 75, 100, 200, 300, 500]],
  ['Empowering', 65, [0, 0, 0, 0, 0, 0, 0], [50, 100, 250, 450, 525, 800, 1000]],
  ['Lucky', 72, [1, 2, 3, 4, 5, 6, 7], [50, 100, 250, 450, 525, 800, 1000]],
  ['Special', 79, [0, 0, 0, 0, 0, 0, 0], [50, 100, 250, 450, 525, 800, 1000]],
];
export const GEMS: Gem[] = TABLE.flatMap(([type, first, amounts, lengths], n) => TIERS.map((t, i) => ({ key: `${t}gem${n + 1}`, id: first + i, type, amount: amounts[i], length: lengths[i] })));
export const gemById = new Map(GEMS.map((g) => [g.id, g]));
export const gemByKey = new Map(GEMS.map((g) => [g.key, g]));
export const tierOf = (g: Gem) => TIER_NAME[g.key[0]];

export interface Active { gem: string; left: number; of: number }
export interface GemLine { type: GemType; active: { gem: Gem; left: number; of: number } | null; huntsLeft: number; stock: { gem: Gem; count: number }[]; stockHunts: number; next: Gem | null; total: number }

const ORDER: GemType[] = ['Hunting', 'Empowering', 'Lucky', 'Special', 'Patreon'];
export const gemName = (g: Gem) => `${tierOf(g)} ${g.type}`;

// animals one hunt brings back with this set running
export function animalsOf(running: Set<GemType>, huntingAmount: number) {
  return (1 + huntingAmount + (running.has('Patreon') ? 1 : 0)) * (running.has('Empowering') ? 2 : 1);
}

// how much of a gem one hunt uses, given what else is running
function perHunt(type: GemType, running: Set<GemType>, huntingAmount: number) {
  const animals = animalsOf(running, huntingAmount);
  if (type === 'Hunting' || type === 'Patreon') return 1;
  if (type === 'Empowering') return Math.max(1, Math.trunc(animals / 2));
  return running.has('Hunting') && running.has('Empowering') ? Math.max(1, Math.trunc(animals / 2)) : animals;
}

export function gemPlan(active: Active[], inventory: Record<string, number>) {
  const act = active.map((a) => ({ gem: gemByKey.get(a.gem), left: a.left, of: a.of })).filter((a) => a.gem && a.left > 0) as { gem: Gem; left: number; of: number }[];
  const running = new Set(act.map((a) => a.gem.type));
  const huntingAmount = act.find((a) => a.gem.type === 'Hunting')?.gem.amount ?? 0;
  // stock is planned with every type it has kept going, the way it should be played
  const kept = new Set<GemType>([...running, ...GEMS.filter((g) => (inventory[String(g.id)] ?? 0) > 0).map((g) => g.type)]);
  const keptHunting = Math.max(huntingAmount, ...GEMS.filter((g) => g.type === 'Hunting' && (inventory[String(g.id)] ?? 0) > 0).map((g) => g.amount));
  const lines: GemLine[] = [];
  for (const type of ORDER) {
    const a = act.find((x) => x.gem.type === type) ?? null;
    const stock = GEMS.filter((g) => g.type === type && (inventory[String(g.id)] ?? 0) > 0).map((gem) => ({ gem, count: inventory[String(gem.id)] }));
    if (!a && !stock.length) continue;
    const huntsLeft = a ? Math.ceil(a.left / perHunt(type, running, huntingAmount)) : 0;
    const use = perHunt(type, kept, keptHunting);
    const stockHunts = stock.reduce((n, x) => n + Math.floor((x.gem.length * x.count) / use), 0);
    // the strongest first where tiers differ in strength (more animals, better luck), oldest id otherwise
    const next = [...stock].sort((x, y) => (type === 'Hunting' || type === 'Lucky' ? y.gem.amount - x.gem.amount || y.gem.id - x.gem.id : x.gem.id - y.gem.id))[0]?.gem ?? null;
    lines.push({ type, active: a, huntsLeft, stock, stockHunts, next, total: huntsLeft + stockHunts });
  }
  // gems to put on now: a type with stock that's off, or about to run out
  const start = lines.filter((l) => l.next && (!l.active || l.huntsLeft <= 3)).map((l) => l.next!);
  // the full set only lasts as long as its shortest type, Patreon aside since it's a bonus
  const core = lines.filter((l) => l.type !== 'Patreon');
  const bottleneck = core.length > 1 ? core.reduce((a, b) => (b.total < a.total ? b : a)) : null;
  // Lucky and Special last twice as long with both Hunting and Empowering on
  const luckyAlone = (running.has('Lucky') || running.has('Special')) && !(running.has('Hunting') && running.has('Empowering'));
  return { lines, luckyAlone, animals: animalsOf(running, huntingAmount), start, bottleneck };
}

// what a fresh hunt shows against the last one: gems that were just put on, so they come off the stock count
export function newlyUsed(before: Active[], after: Active[]) {
  return after.filter((a) => {
    const b = before.find((x) => gemByKey.get(x.gem)?.type === gemByKey.get(a.gem)?.type);
    return !b || b.gem !== a.gem || a.left > b.left;
  }).map((a) => gemByKey.get(a.gem)).filter((g): g is Gem => !!g);
}

// how much one hunt takes from a gem, with whatever else is running in that hunt
export function useOf(active: Active[], key: string) {
  const act = active.map((a) => gemByKey.get(a.gem)).filter((g): g is Gem => !!g);
  const gem = gemByKey.get(key);
  if (!gem) return 1;
  return perHunt(gem.type, new Set(act.map((g) => g.type)), act.find((g) => g.type === 'Hunting')?.amount ?? 0);
}
