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

// the five animals of each plain rank, from OwO's animal list; everything rarer is a custom emoji learnt from zoos
const PLAIN: Record<string, string[]> = {
  common: ['bee', 'bug', 'snail', 'beetle', 'butterfly'],
  uncommon: ['baby_chick', 'mouse2', 'rooster', 'rabbit2', 'chipmunk'],
  rare: ['sheep', 'pig2', 'cow2', 'dog2', 'cat2'],
  epic: ['crocodile', 'tiger2', 'penguin', 'elephant', 'whale'],
  mythic: ['dragon', 'unicorn', 'snowman2', 'ghost', 'dove'],
};
const PLAIN_RANK = new Map(Object.entries(PLAIN).flatMap(([r, list]) => list.map((a) => [a, r] as const)));
export const RANK_ORDER = ['common', 'uncommon', 'rare', 'epic', 'mythic', 'special', 'gem', 'patreon', 'legendary', 'fabled', 'cpatreon', 'bot', 'distorted', 'hidden'];
// mythic and everything beyond it is worth a line in the catch log
export const RARE_RANKS = new Set(['mythic', 'special', 'patreon', 'legendary', 'fabled', 'cpatreon', 'bot', 'distorted', 'hidden']);

export function rankOfAnimal(animal: string, learnt: Map<string, string>): string | null {
  return PLAIN_RANK.get(animal) ?? learnt.get(animal) ?? null;
}
