import { weaponType, type ListedWeapon, type Pet, type ShopWeapon, type Weapon } from '../owo/parse.js';
import { damageOn } from './weapons.js';

// what each weapon type is for, filled in from playing and the wiki, unknown ones are left out
export const roles: Record<string, { stat?: 'STR' | 'MAG'; role: 'damage' | 'heal' | 'tank' | 'support' }> = {
  'Great Sword': { stat: 'STR', role: 'damage' },
  'Bow': { stat: 'STR', role: 'damage' },
  'Wounding Crossbow': { stat: 'STR', role: 'damage' },
  'Glacial Axe': { stat: 'STR', role: 'damage' },
  'Culling Scythe': { stat: 'STR', role: 'damage' },
  'Poison Dagger': { stat: 'STR', role: 'damage' },
  'Energy Staff': { stat: 'MAG', role: 'damage' },
  'Soul Tithe': { stat: 'MAG', role: 'damage' },
  'Conduit Claw': { stat: 'MAG', role: 'damage' },
  'Flame Staff': { stat: 'MAG', role: 'damage' },
  'Vampiric Staff': { stat: 'MAG', role: 'damage' },
  'Wand of Absorption': { stat: 'MAG', role: 'damage' },
  'Healing Staff': { stat: 'MAG', role: 'heal' },
  'Resurrection Staff': { stat: 'MAG', role: 'heal' },
  'Spirit Staff': { role: 'support' },
  'Arcane Scepter': { stat: 'MAG', role: 'support' },
  "Vanguard's Banner": { role: 'support' },
  'Orb of Potency': { role: 'support' },
  "Defender's Aegis": { role: 'tank' },
};

const rarityRank: Record<string, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, mythic: 4, legendary: 5, fabled: 6 };
const shards: Record<string, number> = { common: 1, uncommon: 3, rare: 5, epic: 25, mythic: 300, legendary: 1000, fabled: 5000 };

export interface ArmouryAnalysis {
  summary: string;
  picks: string[];
  junk: ListedWeapon[];
  junkShards: number;
}

export function analyseArmoury(list: ListedWeapon[], team: Pet[] | null, seen: Map<string, Weapon>): ArmouryAnalysis {
  const counts = new Map<string, number>();
  for (const w of list) counts.set(w.rarity, (counts.get(w.rarity) ?? 0) + 1);
  const summary = `**${list.length} weapons** · ${[...counts].sort((a, b) => (rarityRank[b[0]] ?? 0) - (rarityRank[a[0]] ?? 0)).map(([r, n]) => `${n} ${r}`).join(', ')}`;

  // best damage weapon for each pet by its stronger stat, strongest pets pick first, one weapon per pet
  const picks: string[] = [];
  if (team?.length) {
    const used = new Set<string>();
    const order = [...team].sort((a, b) => Math.max(b.str, b.mag) - Math.max(a.str, a.mag));
    for (const p of order) {
      const stat = p.str >= p.mag ? 'STR' : 'MAG';
      const fits = list
        .filter((w) => roles[weaponType(w.name)]?.stat === stat && roles[weaponType(w.name)]?.role === 'damage')
        .filter((w) => !used.has(w.id) && (!w.equippedOn || w.equippedOn === p.name || !team.some((t) => t.name === w.equippedOn)))
        .map((w) => {
          const full = seen.get(w.id);
          return { w, est: full ? damageOn(full, p).total : null };
        })
        .sort((a, b) => (b.est ?? -1) - (a.est ?? -1) || (rarityRank[b.w.rarity] ?? 0) - (rarityRank[a.w.rarity] ?? 0) || b.w.quality - a.w.quality)
        .slice(0, 2);
      if (!fits.length) { picks.push(`${p.name} (${stat}): nothing that fits yet`); continue; }
      used.add(fits[0].w.id);
      const est = (f: (typeof fits)[number]) => {
        if (f.est) return ` ~${f.est} dmg`;
        const full = seen.get(f.w.id);
        return full && !full.hits.length ? ' (scales with the fight)' : '';
      };
      picks.push(`${p.name} (${stat}): ${fits.map((f) => `\`${f.w.id}\` ${f.w.name} ${f.w.quality}%${est(f)}`).join(', then ')}`);
    }
  }

  // only plain rares that nobody holds, and only once a better copy of the same type exists
  const keep = new Map<string, ListedWeapon>();
  for (const w of list) {
    const t = weaponType(w.name);
    const best = keep.get(t);
    if (!best || (rarityRank[w.rarity] ?? 0) > (rarityRank[best.rarity] ?? 0) || (w.rarity === best.rarity && w.quality > best.quality)) keep.set(t, w);
  }
  const junk = list.filter((w) =>
    (rarityRank[w.rarity] ?? 9) <= rarityRank.rare && !w.equippedOn && !w.empowered && keep.get(weaponType(w.name))?.id !== w.id);
  const junkShards = junk.reduce((a, w) => a + (shards[w.rarity] ?? 0), 0);
  return { summary, picks, junk, junkShards };
}

export function armouryReport(list: ListedWeapon[], team: Pet[] | null, seen: Map<string, Weapon>, shardBalance: number | null): string[] {
  const a = analyseArmoury(list, team, seen);
  const lines = [a.summary];
  if (shardBalance !== null) lines.push(`Shards: **${shardBalance.toLocaleString()}**`);
  if (a.picks.length) lines.push('', '**Best damage pick per pet**', ...a.picks);
  if (a.junk.length) {
    lines.push('', `**Safe to dismantle** (${a.junk.length}, about ${a.junkShards} shards): weaker duplicates nobody is holding`);
    lines.push(a.junk.map((w) => `\`${w.id}\` ${w.name} ${w.quality}%`).join('\n'));
    lines.push(`One at a time: \`owo dismantle ${a.junk[0].id}\``);
  }
  lines.push('', 'I keep anything equipped, empowered, epic or better, and the best copy of each type.');
  return lines;
}

export interface Deal { item: ShopWeapon; verdict: 'new' | 'upgrade' | 'have'; note: string }

// how today's shop compares to what you own: a type you don't have, a better rarity than your best copy, or nothing new
export function shopDeals(items: ShopWeapon[], list: ListedWeapon[], team: Pet[] | null): Deal[] {
  const best = new Map<string, number>();
  for (const w of list) {
    const t = weaponType(w.name);
    best.set(t, Math.max(best.get(t) ?? -1, rarityRank[w.rarity] ?? 0));
  }
  const wants = new Set((team ?? []).map((p) => (p.str >= p.mag ? 'STR' : 'MAG')));
  const order = { upgrade: 0, new: 1, have: 2 };
  return items.map((item): Deal => {
    const mine = best.get(item.type);
    const r = rarityRank[item.rarity] ?? 0;
    const role = roles[item.type];
    const fit = role?.stat && wants.has(role.stat) ? ` · suits your ${role.stat} pets` : role ? ` · ${role.role}` : '';
    if (mine === undefined) return { item, verdict: 'new', note: `you don't own one${fit}` };
    if (r > mine) return { item, verdict: 'upgrade', note: `beats your best ${Object.keys(rarityRank)[mine]}${fit}` };
    return { item, verdict: 'have', note: 'you already have one as good' };
  }).sort((a, b) => order[a.verdict] - order[b.verdict] || (rarityRank[b.item.rarity] ?? 0) - (rarityRank[a.item.rarity] ?? 0));
}
