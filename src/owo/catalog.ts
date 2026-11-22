// OwO's own icon codes to plain names. A weapon icon is b (empowered), maybe p, a rarity letter, then
// the weapon: "brvban" is an empowered rare Vanguard's Banner. A passive icon is a rarity letter and the passive.

export const WEAPONS: Record<string, string> = {
  greatsword: 'Great Sword', healstaff: 'Healing Staff', hstaff: 'Healing Staff', bow: 'Bow', rune: 'Rune of the Forgotten', shield: "Defender's Aegis",
  orb: 'Orb of Potency', vampstaff: 'Vampiric Staff', vstaff: 'Vampiric Staff', pdagger: 'Poison Dagger', awand: 'Wand of Absorption',
  fstaff: 'Flame Staff', estaff: 'Energy Staff', sstaff: 'Spirit Staff', ascept: 'Arcane Scepter', rstaff: 'Resurrection Staff',
  gaxe: 'Glacial Axe', vban: "Vanguard's Banner", sythe: 'Culling Scythe', lsyth: 'Leeching Scythe', pstaff: 'Staff of Purity',
  ffish: 'Foul Fish', crune: 'Rune of Celebration', lrune: 'Rune of Luck', cstaff: 'Staff of Corruption', stithe: 'Soul Tithe',
  bhstaff: 'Briar-Heart Staff', aedge: "Arbiter's Edge", woundb: 'Wounding Crossbow', bgaz: 'Bleeding Gaze', cclaw: 'Conduit Claw',
};

export const PASSIVES: Record<string, string> = {
  hp: 'Health Point', att: 'Strength', mag: 'Magic', wp: 'Weapon Point', pr: 'Physical Resistance', mr: 'Magical Resistance',
  lifesteal: 'Lifesteal', thorns: 'Thorns', absolve: 'Absolve', critical: 'Critical', discharge: 'Discharge', energize: 'Energize', wgen: 'Energize',
  enrage: 'Enrage', kkaze: 'Kamikaze', kno: 'Knowledge', manatap: 'Mana Tap', regen: 'Regeneration', hgen: 'Regeneration', sac: 'Sacrifice', safeguard: 'Safeguard',
  snail: 'Snail', sprout: 'Sprout', dstrike: 'Double Strike', adapt: 'Adaptation', swarm: 'Living Hive', gslay: 'Giant Slayer',
  frarm: 'Frost Armor', resonance: 'Resonance', lwolf: 'Lone Wolf',
};

export const RARITY: Record<string, string> = { c: 'common', u: 'uncommon', r: 'rare', e: 'epic', m: 'mythic', l: 'legendary', f: 'fabled' };

export function weaponOf(icon: string): { name: string; empowered: boolean; rarity: string | null } {
  const m = icon.match(/^(b?)(p?)([curemlf])([a-z]+)$/);
  if (!m || !WEAPONS[m[4]]) return { name: WEAPONS[icon] ?? icon, empowered: false, rarity: null };
  return { name: WEAPONS[m[4]], empowered: m[1] === 'b', rarity: RARITY[m[3]] };
}

export function passiveOf(icon: string): { name: string; rarity: string | null } {
  const m = icon.match(/^([curemlf])([a-z]+)$/);
  if (m && PASSIVES[m[2]]) return { name: PASSIVES[m[2]], rarity: RARITY[m[1]] };
  return { name: PASSIVES[icon] ?? icon, rarity: null };
}
