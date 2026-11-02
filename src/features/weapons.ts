import type { Pet, Weapon } from '../owo/parse.js';

export interface PetDamage {
  pet: string;
  perCast: number;
  total: number;
  perWp: number | null;
  mismatch: boolean;
}

// rough damage before enemy resistance, good enough to compare weapons and pets
export function damageOn(w: Weapon, pet: Pet, enemies = 3): PetDamage {
  let perCast = 0;
  let total = 0;
  for (const h of w.hits) {
    const dmg = (h.percent / 100) * (h.stat === 'STR' ? pet.str : pet.mag);
    perCast += dmg;
    total += h.allEnemies ? dmg * enemies : dmg;
  }
  const main = w.hits[0]?.stat;
  const mismatch = !!main && (main === 'STR' ? pet.str < pet.mag : pet.mag < pet.str);
  return {
    pet: pet.name,
    perCast: Math.round(perCast),
    total: Math.round(total),
    perWp: w.wpCost ? Math.round((total / w.wpCost) * 100) / 100 : null,
    mismatch,
  };
}

export function weaponReport(w: Weapon, team: Pet[]): string[] {
  if (!w.hits.length) {
    return [`${w.name} doesn't deal plain % damage, so there's nothing to calculate. It's a support or special weapon, judge it by its passives.`];
  }
  const rows = team.map((p) => damageOn(w, p)).sort((a, b) => b.total - a.total);
  const lines = rows.map((r) => {
    const tail = r.perWp !== null ? `, ${r.perWp} per WP` : '';
    const warn = r.mismatch ? ' (wrong stat for this pet)' : '';
    return `**${r.pet}**: ${r.perCast} per hit, ${r.total} total${tail}${warn}`;
  });
  const best = rows.find((r) => !r.mismatch) ?? rows[0];
  if (best) lines.push(`Best fit on your team: **${best.pet}**: \`owo weapon ${w.id} ${best.pet}\``);
  return lines;
}

// flags pets holding a weapon that scales on their weaker stat
export function teamCheck(team: Pet[], weapons: Map<string, Weapon>): string[] {
  const out: string[] = [];
  for (const p of team) {
    const w = p.weaponId ? weapons.get(p.weaponId) : undefined;
    if (!w || !w.hits.length) continue;
    const d = damageOn(w, p);
    if (d.mismatch) {
      out.push(`${p.name} holds ${w.name}, which uses ${w.hits[0].stat} but ${p.name}'s stronger stat is ${p.str > p.mag ? 'STR' : 'MAG'}.`);
    }
  }
  return out;
}
