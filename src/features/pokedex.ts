import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// every pokémon name with its dex number, regional forms included, from PokeAPI's data
const file = fileURLToPath(new URL('../../assets/pokemon.json', import.meta.url));
const plain = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
type Row = [number, string, string, string?];
let dex: Row[] | null = null;
const all = () => (dex ??= JSON.parse(readFileSync(file, 'utf8')) as Row[]);

// legendary, mythical or ultra beast, nothing for the rest
const row = (name: string) => all().find(([, n]) => n.toLowerCase() === name.toLowerCase());
export const rarityOf = (name: string) => row(name)?.[3] ?? null;
// "Fire/Flying" as a list, regional forms have their own
export const typesOf = (name: string) => (row(name)?.[2] ?? '').split('/').filter(Boolean);
export const TYPES = ['Normal', 'Fire', 'Water', 'Grass', 'Electric', 'Ice', 'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy'];
export const typeMark: Record<string, string> = {
  Normal: '⚪', Fire: '🔥', Water: '💧', Grass: '🌿', Electric: '⚡', Ice: '❄️', Fighting: '🥊', Poison: '☠️', Ground: '⛰️',
  Flying: '🪶', Psychic: '🔮', Bug: '🐛', Rock: '🪨', Ghost: '👻', Dragon: '🐉', Dark: '🌑', Steel: '⚙️', Fairy: '🧚',
};
export const idOf = (name: string) => row(name)?.[0] ?? null;
// the plain species name for a dex number, the first entry is never a regional form
export const nameById = (id: number) => all().find(([i]) => i === id)?.[1] ?? null;

// the longest pokémon name that shows up in a line of text, "a level 12 Alolan Vulpix (♀)" gives Alolan Vulpix
export function nameIn(text: string): string | null {
  const t = ` ${plain(text).replace(/[^a-z0-9.'é: -]/g, ' ')} `;
  let best: string | null = null;
  for (const [, n] of all()) {
    if (n.length > (best?.length ?? 0) && t.includes(` ${plain(n)} `)) best = n;
  }
  return best;
}


// Pokétwo's hint, "The pokémon is \_\_k\_\_\_u.", into a pattern
export function hintOf(text: string): string | null {
  const m = /the pok[eé]mon is\s+(.+?)\.?\s*$/im.exec(text.replace(/\\/g, ''));
  return m ? m[1].trim() : null;
}

// Pokétwo's own forms learned from catches, like Mosslax, so hints can find them too
const extra = new Set<string>();
export const addExtra = (names: string[]) => names.forEach((n) => extra.add(n));

// names that fit a hint, underscores are unknown letters and everything else has to line up
export function solve(pattern: string): { id: number; name: string }[] {
  const p = plain(pattern.trim());
  if (!p) return [];
  const blanks = p.includes('_');
  const re = new RegExp(`^${p.split('').map((c) => (c === '_' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('')}$`);
  const pool: Row[] = [...all(), ...[...extra].filter((n) => !row(n)).map((n): Row => [0, n, ''])];
  const hits = pool.filter(([, n]) => (blanks ? re.test(plain(n)) : plain(n).includes(p)));
  // without blanks it's a search, names that start with it first
  if (!blanks) hits.sort((a, b) => Number(!plain(a[1]).startsWith(p)) - Number(!plain(b[1]).startsWith(p)) || a[1].length - b[1].length);
  return hits.map(([id, name, , rare]) => ({ id, name, rare: rare ?? null }));
}

export const artwork = (id: number) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
// how people here actually catch, pasted as is it mentions Pokétwo
export const catchLine = (name: string) => `@Pokétwo#8236 c ${name}`;
