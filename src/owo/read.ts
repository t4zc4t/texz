// Reads OwO's replies. OwO mixes three layouts: plain text, classic embeds and the newer component
// cards, so everything is first boiled down to one Said shape. Each reader looks only for the bits it
// needs and returns null when they're missing, a layout change then just means "didn't recognise it".

export const OWO_BOT_ID = '408785106942164992';

export interface Field { name: string; value: string }
export interface Embedish { author?: string | null; title?: string | null; description?: string | null; fields?: Field[]; footer?: string | null }
export interface Said {
  content: string;
  embeds: Embedish[];
  // text from component cards, in order
  blocks: string[];
  buttons: { label: string | null; id: string | null; disabled?: boolean }[];
}

// OwO sprinkles zero width spaces through warnings so they can't be matched, take them out first
export const clean = (s: string) => s.replace(/[​‌‍⁠﻿]/g, '');
const num = (s: string) => Number(s.replace(/,/g, ''));
const sup: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
const unsup = (s: string) => s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => sup[c]);
// <:name:123> and <a:name:123> to just the name
const emojiNames = (s: string) => [...s.matchAll(/<a?:(\w+):\d+>|:(\w+):/g)].map((m) => m[1] ?? m[2]);

export function allText(s: Said): string {
  const parts = [s.content];
  for (const e of s.embeds) {
    parts.push(e.author ?? '', e.title ?? '', e.description ?? '');
    for (const f of e.fields ?? []) parts.push(f.name, f.value);
    parts.push(e.footer ?? '');
  }
  parts.push(...s.blocks);
  return clean(parts.filter(Boolean).join('\n'));
}

// turns a discord.js-style message JSON (content, embeds, components) into a Said
export function said(raw: { content?: string | null; embeds?: unknown[]; components?: unknown[] }): Said {
  const embeds: Embedish[] = (raw.embeds ?? []).map((x) => {
    const e = x as { author?: { name?: string }; title?: string; description?: string; fields?: Field[]; footer?: { text?: string } };
    return { author: e.author?.name ?? null, title: e.title ?? null, description: e.description ?? null, fields: e.fields ?? [], footer: e.footer?.text ?? null };
  });
  const blocks: string[] = [];
  const buttons: Said['buttons'] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const c = n as { type?: number; content?: string; label?: string; custom_id?: string; disabled?: boolean; components?: unknown[]; accessory?: unknown };
    if (c.type === 10 && typeof c.content === 'string') blocks.push(c.content);
    if (c.type === 2) buttons.push({ label: c.label ?? null, id: c.custom_id ?? null, disabled: c.disabled });
    walk(c.components);
    walk(c.accessory);
  };
  walk(raw.components ?? []);
  return { content: raw.content ?? '', embeds, blocks, buttons };
}

// "3H 43M 29S", "5H 30M", "45M" to milliseconds
export function duration(text: string): number | null {
  const m = text.match(/(?:(\d+)\s*D)?\s*(?:(\d+)\s*H)?\s*(?:(\d+)\s*M(?!S))?\s*(?:(\d+)\s*S)?/i);
  if (!m || (!m[1] && !m[2] && !m[3] && !m[4])) return null;
  return ((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 60_000 + Number(m[4] ?? 0) * 1000;
}

// ---------- who is OwO talking to ----------

// the first user mention or the bolded name after the icon, "**🌱 | Kunikida**," or "**| Kunikida**"
export function addressee(s: Said): { id: string | null; name: string | null } {
  const t = allText(s);
  const id = t.match(/<@!?(\d{17,20})>/)?.[1] ?? null;
  const name = t.match(/\*\*[^*\n|]*\|\s*([^*,!\n]+?)\s*\*\*/)?.[1]
    ?? s.embeds[0]?.author?.match(/^(.+?)(?:'s\b| goes into battle| fed )/)?.[1]
    ?? t.match(/\*\*\s*([^*\n]+?)'s (?:zoo|Inventory)/)?.[1]
    ?? null;
  return { id, name: name ? name.replace(/^[^\p{L}\p{N}]+/u, '').trim() || null : null };
}

// ---------- captcha ----------

export function captcha(s: Said): { strike: number | null } | null {
  const t = allText(s);
  if (!/real human|complete your captcha|verify that you are human/i.test(t)) return null;
  const strike = t.match(/\((\d)\/5\)/);
  return { strike: strike ? Number(strike[1]) : null };
}

// ---------- team ----------

export interface TeamPet {
  slot: number;
  animal: string;
  name: string;
  level: number;
  xp: number;
  xpNeed: number;
  hp: number; wp: number; str: number; mag: number; pr: number; mr: number;
  weapon: { id: string; rarity: string; type: string; passives: string[]; quality: number } | null;
}
export interface Team { owner: string | null; name: string; page: number; pages: number; streak: number | null; best: number | null; pets: TeamPet[] }

export function team(s: Said): Team | null {
  // teams can be renamed, the help lines in the description are the steady part
  const e = s.embeds.find((x) => /owo team add/i.test(x.description ?? '') && /'s /.test(x.author ?? ''));
  if (!e) return null;
  const pets: TeamPet[] = [];
  for (const f of e.fields ?? []) {
    const head = f.name.match(/\[(\d)\]\s*(<a?:(\w+):\d+>|:(\w+):)\s*\*\*(.+?)\*\*/);
    const lvl = f.value.match(/Lvl\s*(\d+)\s*`\[([\d,]+)\/([\d,]+)\]`/);
    const stats = [...f.value.replace(/`\[[\d,/]+\]`/, '').matchAll(/`(\d+)%?`/g)].map((m) => Number(m[1]));
    if (!head || !lvl || stats.length < 6) continue;
    const w = f.value.match(/`([A-Z0-9]{6})`\s*((?:<a?:\w+:\d+>\s*)+)\s*([\d.]+)%/);
    let weapon: TeamPet['weapon'] = null;
    if (w) {
      const [rarity, type, ...passives] = emojiNames(w[2]);
      weapon = { id: w[1], rarity, type, passives, quality: Number(w[3]) };
    }
    pets.push({
      slot: Number(head[1]), animal: head[3] ?? head[4], name: head[5],
      level: Number(lvl[1]), xp: num(lvl[2]), xpNeed: num(lvl[3]),
      hp: stats[0], wp: stats[1], str: stats[2], mag: stats[3], pr: stats[4], mr: stats[5],
      weapon,
    });
  }
  const page = s.buttons.map((b) => b.label?.match(/^(\d+)\/(\d+)$/)).find(Boolean);
  const foot = e.footer ?? '';
  return {
    owner: e.author!.split("'s ")[0],
    name: e.author!.split("'s ").slice(1).join("'s ").replace(/[│|]/g, '').trim(),
    page: page ? Number(page[1]) : 1, pages: page ? Number(page[2]) : 1,
    streak: foot.match(/Current Streak:\s*([\d,]+)/i) ? num(foot.match(/Current Streak:\s*([\d,]+)/i)![1]) : null,
    best: foot.match(/Highest Streak:\s*([\d,]+)/i) ? num(foot.match(/Highest Streak:\s*([\d,]+)/i)![1]) : null,
    pets,
  };
}

// ---------- every pet, from w pets ----------

export interface PetRow { animal: string; name: string; level: number; xp: number; xpNeed: number; hp: number; wp: number; str: number; mag: number; pr: number; mr: number }

export function pets(s: Said): { owner: string | null; pets: PetRow[] } | null {
  const e = s.embeds.find((x) => /'s pets$/i.test(x.author ?? ''));
  if (!e) return null;
  const out: PetRow[] = [];
  for (const f of e.fields ?? []) {
    const head = f.name.match(/(?:<a?:(\w+):\d+>|:(\w+):)\s*(.+)/);
    const lvl = f.value.match(/Lvl\.?\s*(\d+)\s*`\[([\d,]+)\/([\d,]+)\]`/);
    const stats = [...f.value.replace(/`\[[\d,/]+\]`/, '').matchAll(/`(\d+)%?`/g)].map((m) => Number(m[1]));
    if (!head || !lvl || stats.length < 6) continue;
    out.push({ animal: head[1] ?? head[2], name: head[3].trim(), level: Number(lvl[1]), xp: num(lvl[2]), xpNeed: num(lvl[3]), hp: stats[0], wp: stats[1], str: stats[2], mag: stats[3], pr: stats[4], mr: stats[5] });
  }
  return { owner: e.author!.replace(/'s pets$/i, ''), pets: out };
}

// ---------- one animal's dex card, base stats included ----------

export interface Dex { animal: string; rank: string | null; hp: number; str: number; pr: number; wp: number; mag: number; mr: number; points: number | null; sell: number | null; essence: number | null; aliases: string[] }

export function dex(s: Said): Dex | null {
  const e = s.embeds.find((x) => /\*\*Rank:\*\*/.test(x.description ?? '') && /\*\*Alias:\*\*/.test(x.description ?? ''));
  if (!e) return null;
  const d = e.description!;
  const animal = (e.title ?? '').match(/(?:<a?:(\w+):\d+>|:(\w+):)/);
  const stat = (k: string) => Number(d.match(new RegExp(`<:${k}:\\d+>\\s*\`(\\d+)\``))?.[1] ?? NaN);
  const out = { hp: stat('hp'), str: stat('att'), pr: stat('pr'), wp: stat('wp'), mag: stat('mag'), mr: stat('mr') };
  if (!animal || Object.values(out).some((v) => Number.isNaN(v))) return null;
  const n = (re: RegExp) => { const m = d.match(re); return m ? num(m[1]) : null; };
  return {
    animal: animal[1] ?? animal[2], rank: d.match(/\*\*Rank:\*\*\s*(?:<a?:\w+:\d+>\s*)?(\w+)/)?.[1]?.toLowerCase() ?? null, ...out,
    points: n(/\*\*Points:\*\*\s*([\d,]+)/), sell: n(/\*\*Sell:\*\*\s*([\d,]+)/), essence: n(/\*\*Sacrifice:\*\*\s*([\d,]+)/),
    aliases: (d.match(/\*\*Alias:\*\*\s*([^\n]+)/)?.[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean),
  };
}

// base stats from a pet's own numbers, OwO grows each stat in a straight line with level:
// hp and wp 500 + 2*base*level, str and mag 100 + base*level. Resistances only show as a rounded %, so those are rough
export function baseFrom(p: { level: number; hp: number; wp: number; str: number; mag: number }) {
  const L = Math.max(1, p.level);
  return { hp: (p.hp - 500) / (2 * L), wp: (p.wp - 500) / (2 * L), str: (p.str - 100) / L, mag: (p.mag - 100) / L };
}

// ---------- zoo ----------

export const RANKS = ['common', 'uncommon', 'rare', 'epic', 'mythic', 'special', 'gem', 'legendary', 'fabled', 'bot', 'distorted', 'patreon', 'cpatreon', 'hidden'] as const;
export interface Zoo { owner: string | null; animals: { animal: string; rank: string; count: number }[]; points: number | null; caught: Record<string, number> }

export function zoo(s: Said): Zoo | null {
  const t = allText(s);
  if (!/'s zoo!/i.test(t) || !/Zoo Points/i.test(t)) return null;
  const animals: Zoo['animals'] = [];
  for (const line of t.split('\n')) {
    const head = line.match(/^\s*<a?:(\w+):\d+>/);
    if (!head || !(RANKS as readonly string[]).includes(head[1].toLowerCase())) continue;
    for (const m of line.slice(head[0].length).matchAll(/(?:<a?:(\w+):\d+>|:(\w+):)([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g)) {
      animals.push({ animal: m[1] ?? m[2], rank: head[1].toLowerCase(), count: Number(unsup(m[3])) });
    }
  }
  // "G-11, L-10, M-35, S-1, E-342, R-3220, U-9671, C-18900" is how many of each rank were ever caught
  const caught: Record<string, number> = {};
  const tally = t.match(/\*\*((?:[A-Z]+-\d+,?\s*)+)\*\*/);
  if (tally) for (const m of tally[1].matchAll(/([A-Z]+)-(\d+)/g)) caught[m[1]] = Number(m[2]);
  const points = t.match(/Zoo Points:\s*_*([\d,]+)/i);
  return { owner: t.match(/\*\*\s*(.+?)'s zoo!/i)?.[1] ?? null, animals, points: points ? num(points[1]) : null, caught };
}

// ---------- one weapon, from w {id}, a reroll or the weapon shop ----------

export interface WeaponCard {
  id: string | null;
  shopId: number | null;
  price: number | null;
  name: string;
  owner: string | null;
  rarity: string | null;
  quality: number | null;
  wear: string | null;
  wpCost: number | null;
  kills: number | null;
  empowered: boolean;
  // every number in the weapon's own description, in order, like [51.4] for Great Sword
  rolls: number[];
  passives: { emoji: string; name: string; rolls: number[] }[];
  rerollChanges: number | null;
  rerollAttempts: number | null;
}

export function weapon(s: Said): WeaponCard | null {
  const t = allText(s);
  const name = t.match(/\*\*Name:\*\*\s*([^\n]+)/);
  const quality = t.match(/\*\*Quality:\*\*\s*(?:<a?:(\w+):\d+>\s*)?([\d.]+)%/);
  if (!name || !quality) return null;
  const desc = t.split(/### __Description__/)[1] ?? '';
  // the description ends where the first passive line starts
  const passiveRe = /^<a?:(\w+):\d+>\s*\*\*__(.+?)__\*\*\s*-\s*([^\n]*)/gm;
  const firstPassive = desc.search(/\n<a?:\w+:\d+>\s*\*\*__/);
  const body = firstPassive >= 0 ? desc.slice(0, firstPassive) : desc;
  const rollsOf = (x: string) => [...x.replace(/<a?:\w+:\d+>/g, '').matchAll(/\*\*[+-]?([\d.]+)%?\*\*/g)].map((m) => Number(m[1]));
  const passives: WeaponCard['passives'] = [];
  for (const m of (firstPassive >= 0 ? desc.slice(firstPassive) : '').matchAll(passiveRe)) {
    passives.push({ emoji: m[1], name: m[2], rolls: rollsOf(m[3]) });
  }
  const pick = (re: RegExp) => t.match(re)?.[1] ?? null;
  const title = t.match(/##\s*(.+?)'s\s+(.+?)(?:\s*\[\d+\])?\n/);
  return {
    id: pick(/\*\*ID:\*\*\s*`([A-Z0-9]{6})`/),
    shopId: pick(/\*\*Shop ID:\*\*\s*(\d+)/) ? Number(pick(/\*\*Shop ID:\*\*\s*(\d+)/)) : null,
    price: pick(/\*\*Price:\*\*\s*([\d,]+)/) ? num(pick(/\*\*Price:\*\*\s*([\d,]+)/)!) : null,
    name: name[1].trim(),
    owner: title?.[1] ?? null,
    rarity: quality[1] ?? null,
    quality: Number(quality[2]),
    wear: pick(/\*\*Wear:\*\*\s*`(\w+)`/)?.toLowerCase() ?? null,
    wpCost: pick(/\*\*Weapon Cost:\*\*\s*([\d,]+)/) ? num(pick(/\*\*Weapon Cost:\*\*\s*([\d,]+)/)!) : null,
    kills: pick(/\*\*Kills:\*\*\s*`([\d,]+)`/) ? num(pick(/\*\*Kills:\*\*\s*`([\d,]+)`/)!) : null,
    empowered: /empowered/i.test(title?.[2] ?? name[1]),
    rolls: rollsOf(body),
    passives,
    rerollChanges: pick(/Reroll Changes:\s*(\d+)/) ? Number(pick(/Reroll Changes:\s*(\d+)/)) : null,
    rerollAttempts: pick(/Reroll Attempts:\s*(\d+)/) ? Number(pick(/Reroll Attempts:\s*(\d+)/)) : null,
  };
}

// ---------- the weapon list, one page of w ----------

export interface ListedWeapon { favourite: boolean; id: string; rarity: string; type: string; passives: string[]; name: string; wear: string | null; empowered: boolean; kills: number | null; quality: number; on: string | null }
export interface WeaponList { page: number; pages: number; filtered: boolean; weapons: ListedWeapon[] }

export function weaponList(s: Said): WeaponList | null {
  const t = allText(s);
  if (!/'s Weapons/i.test(t)) return null;
  const weapons: ListedWeapon[] = [];
  const re = /`([A-Z0-9]{6})`\s*((?:<a?:\w+:\d+>)+)([^*\n]*)\*\*(.+?)\*\*\s*([\d.]+)%(?:\s*➤\s*(?:<a?:(\w+):\d+>|:(\w+):))?/g;
  for (const m of t.matchAll(re)) {
    const [rarity, type, ...passives] = emojiNames(m[2]);
    const full = m[4].trim();
    const kills = full.match(/\[(\d+)\]$/);
    const wear = full.match(/\b(Pristine|Fine|Decent)\b/i)?.[1].toLowerCase() ?? null;
    weapons.push({
      id: m[1], rarity, type, passives,
      name: full.replace(/\s*\[\d+\]$/, '').replace(/\b(Pristine|Fine|Decent|Empowered)\b\s*/gi, '').trim(),
      wear, empowered: /empowered/i.test(full), kills: kills ? Number(kills[1]) : null,
      quality: Number(m[5]), on: m[6] ?? m[7] ?? null, favourite: m[3].includes('⭐'),
    });
  }
  const page = s.buttons.map((b) => b.label?.match(/^(\d+)\/(\d+)$/)).find(Boolean);
  return { page: page ? Number(page[1]) : 1, pages: page ? Number(page[2]) : 1, filtered: !/Weapon Filters:\*\*\s*`None`/i.test(t), weapons };
}

// ---------- huntbot ----------

export const TRAITS = ['efficiency', 'duration', 'cost', 'gain', 'experience', 'radar'] as const;
export type Trait = (typeof TRAITS)[number];
export interface Huntbot {
  traits: Partial<Record<Trait, { value: string; level: number; progress: number; need: number }>>;
  essence: number | null;
  maxRun: { animals: number; essence: number; xp: number; cost: number } | null;
  hunting: { backInMs: number; percent: number; captured: number } | null;
}

export function huntbot(s: Said): Huntbot | null {
  const e = s.embeds.find((x) => /HuntBot$/i.test(x.author ?? ''));
  if (!e) return null;
  const out: Huntbot = { traits: {}, essence: null, maxRun: null, hunting: null };
  for (const f of e.fields ?? []) {
    const name = f.name.replace(/<a?:\w+:\d+>/g, '').toLowerCase();
    const trait = TRAITS.find((x) => name.includes(x));
    const lvl = f.value.match(/Lvl\s*(\d+)\s*\[([\d,]+)\/([\d,]+)\]/);
    if (trait && lvl) out.traits[trait] = { value: f.name.match(/`([^`]+)`/)?.[1] ?? '', level: Number(lvl[1]), progress: num(lvl[2]), need: num(lvl[3]) };
    if (/Animal Essence/i.test(f.name)) {
      out.essence = num(f.name.match(/`([\d,]+)`/)?.[1] ?? '0');
      const run = f.value.match(/([\d,]+) animals,\s*([\d,]+) essence,\s*and\s*([\d,]+) xp for\s*([\d,]+) cowoncy/i);
      if (run) out.maxRun = { animals: num(run[1]), essence: num(run[2]), xp: num(run[3]), cost: num(run[4]) };
    }
    if (/currently hunting/i.test(f.name)) {
      const back = f.value.match(/BACK IN\s*([\dDHMS ]+)/i);
      const pct = f.value.match(/([\d.]+)%\s*DONE\s*\|\s*([\d,]+)\s*ANIMALS/i);
      if (back) out.hunting = { backInMs: duration(back[1]) ?? 0, percent: pct ? Number(pct[1]) : 0, captured: pct ? num(pct[2]) : 0 };
    }
  }
  return Object.keys(out.traits).length || out.hunting ? out : null;
}

// the plain text huntbot replies: sent off, still hunting, back with animals, or asking for a password
export type HuntbotNote =
  | { kind: 'sent'; spent: number; backInMs: number; animals: number; essence: number; xp: number }
  | { kind: 'hunting'; backInMs: number; percent: number; captured: number }
  | { kind: 'back'; animals: number; essence: number; xp: number; byRank: Record<string, number> }
  | { kind: 'password' };

export function huntbotNote(s: Said): HuntbotNote | null {
  const t = allText(s).replace(/`/g, '');
  if (/Here is your password/i.test(t)) return { kind: 'password' };
  const sent = t.match(/YOU SPENT ([\d,]+) cowoncy[\s\S]*?BACK IN ([\dDHMS ]+?) WITH ([\d,]+) ANIMALS,[\s\S]*?([\d,]+) ESSENCE, AND ([\d,]+) EXPERIENCE/i);
  if (sent) return { kind: 'sent', spent: num(sent[1]), backInMs: duration(sent[2]) ?? 0, animals: num(sent[3]), essence: num(sent[4]), xp: num(sent[5]) };
  const still = t.match(/STILL HUNTING\. I WILL BE BACK IN ([\dDHMS ]+)[\s\S]*?([\d.]+)% DONE \| ([\d,]+) ANIMALS/i);
  if (still) return { kind: 'hunting', backInMs: duration(still[1]) ?? 0, percent: Number(still[2]), captured: num(still[3]) };
  const back = t.match(/I AM BACK WITH ([\d,]+) ANIMALS,[\s\S]*?([\d,]+) ESSENCE, AND ([\d,]+) EXPERIENCE/i);
  if (back) {
    const byRank: Record<string, number> = {};
    for (const line of t.split('\n')) {
      const head = line.match(/^\s*<a?:(\w+):\d+>\s*\*\*\|/);
      if (!head) continue;
      let n = 0;
      for (const m of line.matchAll(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g)) n += Number(unsup(m[0]));
      byRank[head[1].toLowerCase()] = n;
    }
    return { kind: 'back', animals: num(back[1]), essence: num(back[2]), xp: num(back[3]), byRank };
  }
  return null;
}

// ---------- battle ----------

export interface Battle { owner: string | null; result: 'won' | 'lost' | 'tie'; turns: number; xp: number; streak: number | null; streakEnded: number | null; levels: number[]; enemyLevels: number[] }

export function battle(s: Said): Battle | null {
  const e = s.embeds.find((x) => /goes into battle/i.test(x.author ?? ''));
  const foot = e?.footer ?? '';
  const r = foot.match(/You (won|lost) in (\d+) turns|It's a (tie) in (\d+) turns/i);
  if (!e || !r) return null;
  const lv = (f?: Field) => [...(f?.value ?? '').matchAll(/L\.\s*(\d+)/g)].map((m) => Number(m[1]));
  return {
    owner: e.author!.replace(/ goes into battle!?$/i, ''),
    result: (r[1] ?? r[3]).toLowerCase() as Battle['result'],
    turns: Number(r[2] ?? r[4]),
    xp: num(foot.match(/\+([\d,]+)\s*xp/i)?.[1] ?? '0'),
    streak: foot.match(/Streak:\s*([\d,]+)/i) ? num(foot.match(/Streak:\s*([\d,]+)/i)![1]) : null,
    streakEnded: foot.match(/Streak ended at\s*([\d,]+)/i) ? num(foot.match(/Streak ended at\s*([\d,]+)/i)![1]) : null,
    levels: lv(e.fields?.[0]),
    enemyLevels: lv(e.fields?.[1]),
  };
}

// ---------- hunt ----------

export interface Hunt { gems: { gem: string; left: number; of: number }[]; found: string[]; xp: number | null }

export function hunt(s: Said): Hunt | null {
  const t = allText(s);
  // without gems or a full team OwO catches one: "spent 5 cowoncy and caught a common :bee:!"
  const one = t.match(/spent [\d,]+ <a?:\w+:\d+> and caught an? \*\*\w+\*\*\s*<a?:\w+:\d+>\s*(<a?:\w+:\d+>|:\w+:)/i);
  if (one) {
    const xp = t.match(/gained \*\*([\d,]+)xp\*\*/i);
    return { gems: [], found: emojiNames(one[1]), xp: xp ? num(xp[1]) : null };
  }
  if (!/You found:/i.test(t)) return null;
  const gems = [...t.matchAll(/<a?:(\w+):\d+>`\[(\d+)\/(\d+)\]`/g)].map((m) => ({ gem: m[1], left: Number(m[2]), of: Number(m[3]) }));
  const found = emojiNames(t.split(/You found:/i)[1]?.split('\n')[0] ?? '');
  const xp = t.match(/gained \*\*([\d,]+)xp\*\*/i);
  return { gems, found, xp: xp ? num(xp[1]) : null };
}

// ---------- small replies ----------

export type Note =
  | { kind: 'shards'; n: number }
  | { kind: 'cash'; n: number }
  | { kind: 'cookies'; n: number; readyInMs: number | null }
  | { kind: 'wait'; ms: number }
  | { kind: 'waitUntil'; at: number }
  | { kind: 'tooFast' }
  | { kind: 'vote'; ready: boolean }
  | { kind: 'daily'; cowoncy: number; streak: number | null }
  | { kind: 'opened'; what: 'crate' | 'lootbox'; count: number; found: string[] }
  | { kind: 'pray'; luck: number }
  | { kind: 'sacrifice'; essence: number; byRank: Record<string, number> }
  | { kind: 'upgrade'; trait: string; essence: number; level: number; progress: number; need: number }
  | { kind: 'minigame'; game: string; done: number | null; of: number | null; total: number | null; out: boolean }
  | { kind: 'pet'; game: string; streak: number; resetsInMs: number | null }
  | { kind: 'checklist'; board: 'daily' | 'weekly' | 'quests'; claimable: boolean; claimed: boolean; allDone: boolean; resetsAt: number | null; seals: number | null };

export function note(s: Said): Note | null {
  const t = allText(s);
  let m: RegExpMatchArray | null;
  if ((m = t.match(/currently have \*\*([\d,]+)\*\* Weapon Shards/i))) return { kind: 'shards', n: num(m[1]) };
  if ((m = t.match(/currently have \*\*__([\d,]+)__ cowoncy/i))) return { kind: 'cash', n: num(m[1]) };
  if ((m = t.match(/currently have \*\*([\d,]+)\*\* cookies/i))) {
    const w = t.match(/send a cookie in \*\*([^*]+)\*\*/i);
    return { kind: 'cookies', n: num(m[1]), readyInMs: w ? duration(w[1]) : 0 };
  }
  if ((m = t.match(/try the command again \*\*<t:(\d+):R>\*\*/i))) return { kind: 'waitUntil', at: Number(m[1]) * 1000 };
  if ((m = t.match(/You need to wait \*\*([^*]+)\*\*/i))) return { kind: 'wait', ms: duration(m[1]) ?? 0 };
  if (/too fast/i.test(t)) return { kind: 'tooFast' };
  if (/daily vote is available/i.test(t)) return { kind: 'vote', ready: true };
  if ((m = t.match(/Here is your daily \*\*(?:<a?:\w+:\d+>\s*)?([\d,]+) Cowoncy/i))) {
    const st = t.match(/on a \*\*([\d,]+)\*\* daily streak|daily streak[^\d]*([\d,]+)/i);
    return { kind: 'daily', cowoncy: num(m[1]), streak: st ? num(st[1] ?? st[2]) : null };
  }
  if ((m = t.match(/opens ([\d,]+) (weapon crates?|lootbox(?:es)?)[\s\S]*?and finds:?\s*([^\n]*)/i))) {
    return { kind: 'opened', what: /crate/i.test(m[2]) ? 'crate' : 'lootbox', count: num(m[1]), found: emojiNames(m[3]) };
  }
  if ((m = t.match(/You have \*\*([\d,]+)\*\* luck point/i))) return { kind: 'pray', luck: num(m[1]) };
  if ((m = t.match(/sacrificed \*\*(.+?)\*\* for a total of \*\*(?:<a?:\w+:\d+>\s*)?([\d,]+)/i))) {
    const byRank: Record<string, number> = {};
    for (const x of m[1].matchAll(/<a?:(\w+):\d+>x([\d,]+)/g)) byRank[x[1]] = num(x[2]);
    return { kind: 'sacrifice', essence: num(m[2]), byRank };
  }
  if ((m = t.match(/upgraded `(\w+)` with\s*\*\*([\d,]+) Animal Essence[\s\S]*?Lvl (\d+) \[([\d,]+)\/([\d,]+)\]/i))) {
    return { kind: 'upgrade', trait: m[1].toLowerCase(), essence: num(m[2]), level: Number(m[3]), progress: num(m[4]), need: num(m[5]) };
  }
  const games: [RegExp, string][] = [[/kilomet/i, 'run'], [/carrot/i, 'piku'], [/pupp/i, 'puppy']];
  for (const [re, game] of games) {
    if (!re.test(t) || !/today|tomorrow|total/i.test(t)) continue;
    const today = t.match(/(\d+)\/(\d+) (?:kilometers|today|puppies)/i);
    const total = t.match(/(?:in total|Total distance traveled:)\D*([\d,]+)/i);
    return { kind: 'minigame', game, done: today ? Number(today[1]) : null, of: today ? Number(today[2]) : null, total: total ? num(total[1]) : null, out: /too tired|out of carrots|no puppies/i.test(t) };
  }
  const pet = s.embeds.find((e) => /STREAK:\s*\d+\s*\|\s*Resets in/.test(e.footer ?? ''));
  if (pet) {
    const game = /alastor/i.test(pet.author ?? '') ? 'alastor' : /baby yoda/i.test(pet.author ?? '') ? 'babyyoda' : 'pet';
    const r = pet.footer!.match(/Resets in:\s*([\dHMS ]+)/i);
    return { kind: 'pet', game, streak: Number(pet.footer!.match(/STREAK:\s*(\d+)/)![1]), resetsInMs: r ? duration(r[1]) : null };
  }
  if ((m = t.match(/'s (Daily Checklist|Weekly Checklist|Quest Log)/i))) {
    const board = /Daily/i.test(m[1]) ? 'daily' : /Weekly/i.test(m[1]) ? 'weekly' : 'quests';
    const claim = s.buttons.find((b) => /checklist:claim|weeklyChecklist:claim|quests:claim/.test(b.id ?? ''));
    const reset = t.match(/(?:resets|Next quest:)\s*\**<t:(\d+):R>/i);
    const seals = t.match(/Balance:\s*\*\*([\d,]+)\*\*/i);
    return {
      kind: 'checklist', board, claimable: !!claim && !claim.disabled && !/Claimed/i.test(claim.label ?? ''),
      claimed: /Claimed!|already claimed/i.test(t), allDone: /finished all of your quests/i.test(t),
      resetsAt: reset ? Number(reset[1]) * 1000 : null, seals: seals ? num(seals[1]) : null,
    };
  }
  return null;
}

// ---------- inventory ----------

export function inventory(s: Said): Map<number, number> | null {
  const t = allText(s);
  if (!/'s Inventory/i.test(t)) return null;
  const items = new Map<number, number>();
  for (const m of t.matchAll(/`(\d{3})`\s*<a?:\w+:\d+>\s*([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g)) items.set(Number(m[1]), Number(unsup(m[2])));
  return items;
}
