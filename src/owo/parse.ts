// Everything here reads OwO's replies as plain text. OwO changes its layout now and then,
// so each parser only looks for the few bits it needs and returns null when they're missing.

export const OWO_BOT_ID = '408785106942164992';

export interface Field {
  name: string;
  value: string;
}

export interface Embedish {
  title?: string | null;
  author?: string | null;
  description?: string | null;
  fields?: Field[];
  footer?: string | null;
}

export function flatten(content: string, embeds: Embedish[]): string {
  const parts = [content];
  for (const e of embeds) {
    parts.push(e.author ?? '', e.title ?? '', e.description ?? '');
    for (const f of e.fields ?? []) parts.push(f.name, f.value);
    parts.push(e.footer ?? '');
  }
  return parts.filter(Boolean).join('\n');
}

// custom emojis like <:hp:123> get in the way of most patterns
export const stripEmoji = (s: string) => s.replace(/<a?:(\w+):\d+>/g, ':$1:');
const num = (s: string) => Number(s.replace(/,/g, ''));

const superscripts: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
};
const unsuper = (s: string) => s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => superscripts[c]);

// ---------- huntbot ----------

export const traits = ['efficiency', 'duration', 'cost', 'gain', 'experience', 'radar'] as const;
export type Trait = (typeof traits)[number];

export interface TraitState {
  value: string;
  level: number;
  progress: number;
  needed: number;
}

export interface Huntbot {
  traits: Partial<Record<Trait, TraitState>>;
  essence: number | null;
  maxRunCost: number | null;
  backInMs: number | null;
  percentDone: number | null;
}

export function parseDuration(text: string): number | null {
  const m = text.match(/(?:(\d+)\s*D)?\s*(?:(\d+)\s*H)?\s*(?:(\d+)\s*M)?/i);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return ((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 60_000;
}

export function parseHuntbot(raw: string): Huntbot | null {
  const text = stripEmoji(raw);
  const out: Huntbot = { traits: {}, essence: null, maxRunCost: null, backInMs: null, percentDone: null };

  for (const t of traits) {
    const re = new RegExp(`${t}\\s*-\\s*\`?([^\`\\n]+?)\`?\\s*\\n[\\s\\S]*?Lvl\\s*(\\d+)[\\s\\S]*?\\[([\\d,]+)\\/([\\d,]+)\\]`, 'i');
    const m = text.match(re);
    if (m) out.traits[t] = { value: m[1].trim(), level: Number(m[2]), progress: num(m[3]), needed: num(m[4]) };
  }

  const ess = text.match(/Animal Essence\s*-\s*`?([\d,]+)/i);
  if (ess) out.essence = num(ess[1]);

  const cost = text.match(/for\s*([\d,]+)\s*cowoncy/i);
  if (cost) out.maxRunCost = num(cost[1]);

  const back = text.match(/BACK IN\s*([\dDHM\s]+)/i);
  if (back) out.backInMs = parseDuration(back[1]);

  const pct = text.match(/([\d.]+)%\s*DONE/i);
  if (pct) out.percentDone = Number(pct[1]);

  const found = Object.keys(out.traits).length > 0 || out.backInMs !== null;
  return found ? out : null;
}

// ---------- inventory ----------

export function parseInventory(raw: string): Map<number, number> {
  const items = new Map<number, number>();
  const text = stripEmoji(raw);
  const re = /`(\d{3})`\s*(?::\w+:)?\s*`?([⁰¹²³⁴⁵⁶⁷⁸⁹\d]+)`?/g;
  for (const m of text.matchAll(re)) items.set(Number(m[1]), Number(unsuper(m[2])));
  return items;
}

// ---------- team ----------

export interface Pet {
  slot: number;
  name: string;
  level: number | null;
  hp: number;
  wp: number;
  str: number;
  mag: number;
  pr: number;
  mr: number;
  weaponId: string | null;
}

export function parsePetField(f: Field): Pet | null {
  // OwO wraps names in its own bold/code marks, drop them before reading the name
  const head = stripEmoji(f.name).replace(/[*_`~]/g, '').match(/\[(\d)\]\s*(?::\w+:\s*)?(\S+)/);
  if (!head) return null;
  const body = stripEmoji(f.value);
  const level = body.match(/Lvl\s*(\d+)/i);
  // stat boxes come after the xp bracket, six numbers in hp wp str mag pr mr order
  const afterXp = body.replace(/\[[\d,]+\/[\d,]+\]/, '');
  const stats = [...afterXp.matchAll(/`(\d+)%?`/g)].map((m) => Number(m[1]));
  if (stats.length < 6) return null;
  const weapon = afterXp.match(/`([A-Z0-9]{6})`/);
  return {
    slot: Number(head[1]),
    name: head[2],
    level: level ? Number(level[1]) : null,
    hp: stats[0], wp: stats[1], str: stats[2], mag: stats[3], pr: stats[4], mr: stats[5],
    weaponId: weapon ? weapon[1] : null,
  };
}

export function parseTeam(embeds: Embedish[]): Pet[] {
  const pets: Pet[] = [];
  for (const e of embeds) for (const f of e.fields ?? []) {
    const p = parsePetField(f);
    if (p) pets.push(p);
  }
  return pets;
}

// ---------- weapon ----------

export interface Hit {
  percent: number;
  stat: 'STR' | 'MAG';
  allEnemies: boolean;
}

export interface Weapon {
  id: string;
  name: string;
  quality: number | null;
  wpCost: number | null;
  hits: Hit[];
  text: string;
}

export function parseWeapon(raw: string): Weapon | null {
  const text = stripEmoji(raw).replace(/\*\*/g, '');
  const id = text.match(/ID:\s*`?([A-Z0-9]{6})`?/);
  const name = text.match(/Name:\s*([^\n]+)/);
  if (!id || !name) return null;
  const quality = text.match(/Quality:\s*(?::\w+:\s*)?([\d.]+)%/);
  const cost = text.match(/Weapon Cost:\s*([\d,]+)/);
  const hits: Hit[] = [];
  // sentences like "Deals 51.4% of your :att: STR to all opponents."
  for (const m of text.matchAll(/(?:deals?|deal)\s+([\d.]+)%\s+of your\s*(?::\w+:\s*)?(STR|MAG)([^.\n]*)/gi)) {
    // "for every 1 WP absorbed" style damage depends on the fight, not a flat %
    if (/for every/i.test(m[3])) continue;
    hits.push({
      percent: Number(m[1]),
      stat: m[2].toUpperCase() as 'STR' | 'MAG',
      allEnemies: /all (opponents|enemies)/i.test(m[3]),
    });
  }
  return {
    id: id[1],
    name: name[1].trim(),
    quality: quality ? Number(quality[1]) : null,
    wpCost: cost ? num(cost[1]) : null,
    hits,
    text,
  };
}

// saved weapons get read again with the current reader, so fixes apply to old data too
export const refresh = (w: Weapon): Weapon => parseWeapon(w.text) ?? w;

// ---------- captcha ----------

export function isCaptcha(raw: string): boolean {
  return /real human|captcha|verify that you are human|link below to verify/i.test(raw);
}

// ---------- zoo ----------

// OwO's rank emoji names, in zoo order
export const zooRanks = ['common', 'uncommon', 'rare', 'epic', 'mythic', 'special', 'gem', 'legendary', 'fabled', 'bot', 'distorted', 'patreon', 'cpatreon', 'hidden'] as const;
export type ZooRank = (typeof zooRanks)[number];

export function parseZoo(raw: string): Partial<Record<ZooRank, number>> | null {
  if (!/zoo/i.test(raw) || !/Zoo Points/i.test(raw)) return null;
  const out: Partial<Record<ZooRank, number>> = {};
  for (const line of raw.split('\n')) {
    const head = line.match(/^\s*<a?:(\w+):\d+>/);
    if (!head) continue;
    const rank = head[1].toLowerCase() as ZooRank;
    if (!zooRanks.includes(rank)) continue;
    const rest = line.slice(head[0].length);
    let total = 0;
    for (const m of rest.matchAll(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g)) total += Number(unsuper(m[0]));
    out[rank] = (out[rank] ?? 0) + total;
  }
  return Object.keys(out).length ? out : null;
}

// ---------- weapon list ----------

export interface ListedWeapon {
  id: string;
  rarity: string;
  name: string;
  quality: number;
  equippedOn: string | null;
  empowered: boolean;
}

export function parseWeaponList(raw: string): ListedWeapon[] {
  const out: ListedWeapon[] = [];
  const re = /`([A-Z0-9]{6})`\s*<a?:(\w+):\d+>[^*\n]*\*\*([^*]+)\*\*\s*([\d.]+)%(?:\s*➤\s*(?:<a?:\w+:\d+>|:\w+:)?\s*(\S+))?/g;
  for (const m of raw.matchAll(re)) {
    const name = m[3].trim();
    out.push({
      id: m[1],
      rarity: m[2].toLowerCase(),
      name,
      quality: Number(m[4]),
      equippedOn: m[5] ?? null,
      empowered: /empowered/i.test(name),
    });
  }
  return out;
}

// "Great Sword [12]" and "Fine Resurrection Staff" both mean the same weapon type
export function weaponType(name: string): string {
  return name
    .replace(/\[\d+\]/g, '')
    .replace(/\b(Worn|Decent|Fine|Pristine|Empowered)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- weapon shop ----------

export interface ShopWeapon {
  id: string;
  name: string;
  type: string;
  rarity: string;
  price: number;
  // [D] in the shop name, OwO's own tag
  tagged: boolean;
}

const rarityWords: Record<string, string> = { common: 'common', uncommon: 'uncommon', rare: 'rare', epic: 'epic', mythical: 'mythic', mythic: 'mythic', legendary: 'legendary', fabled: 'fabled' };

// the weapon page of owo shop, `101` <emoji><emoji> **`[D] Epic Staff of Purity`**`----- 63` <weaponshard>
export function parseShopWeapons(raw: string): { items: ShopWeapon[]; resetsInMs: number | null } | null {
  if (!/OwO Shop: Weapons/i.test(raw)) return null;
  const items: ShopWeapon[] = [];
  for (const m of raw.matchAll(/`(\d{3})`[^*\n]*\*\*`([^`]+)`\*\*`[-\s]*([\d.,]+[KM]?)`/g)) {
    const name = m[2].replace(/^\*/, '').trim();
    if (/crate/i.test(name)) continue;
    const words = name.replace(/\[D\]\s*/, '').split(' ');
    const rarity = rarityWords[words[0].toLowerCase()];
    if (!rarity) continue;
    const n = m[3].replace(/,/g, '');
    const price = Number.parseFloat(n) * (n.endsWith('K') ? 1_000 : n.endsWith('M') ? 1_000_000 : 1);
    items.push({ id: m[1], name, type: words.slice(1).join(' '), rarity, price, tagged: /\[D\]/.test(name) });
  }
  const reset = raw.match(/Resets in:\s*([\dHMS ]+)/i);
  return { items, resetsInMs: reset ? parseDuration(reset[1]) : null };
}

// ---------- plain replies ----------

export const numberAfter = (raw: string, re: RegExp): number | null => {
  const m = raw.replace(/[*_]/g, '').match(re);
  return m ? Number(m[1].replace(/,/g, '')) : null;
};

export function parseQuestLog(raw: string): { allDone: boolean; lines: string[] } | null {
  if (!/Quest Log/i.test(raw)) return null;
  if (/finished all of your quests/i.test(raw)) return { allDone: true, lines: [] };
  const lines = raw.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/Quest Log|Complete quests|Balance:|Next quest|^#|^-#/.test(l) && !/^(Daily|Weekly|Quests|Claim)$/i.test(l));
  return { allDone: false, lines };
}
