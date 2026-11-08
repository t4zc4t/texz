import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// every pokémon name with its dex number, regional forms included, from PokeAPI's data
const file = fileURLToPath(new URL('../../assets/pokemon.json', import.meta.url));
let dex: [number, string][] | null = null;
const all = () => (dex ??= JSON.parse(readFileSync(file, 'utf8')) as [number, string][]);

const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Pokétwo's hint, "The pokémon is \_\_k\_\_\_u.", into a pattern
export function hintOf(text: string): string | null {
  const m = /the pok[eé]mon is\s+(.+?)\.?\s*$/im.exec(text.replace(/\\/g, ''));
  return m ? m[1].trim() : null;
}

// names that fit a hint, underscores are unknown letters and everything else has to line up
export function solve(pattern: string): { id: number; name: string }[] {
  const p = plain(pattern.trim());
  if (!p) return [];
  const blanks = p.includes('_');
  const re = new RegExp(`^${p.split('').map((c) => (c === '_' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('')}$`);
  const hits = all().filter(([, n]) => (blanks ? re.test(plain(n)) : plain(n).includes(p)));
  // without blanks it's a search, names that start with it first
  if (!blanks) hits.sort((a, b) => Number(!plain(a[1]).startsWith(p)) - Number(!plain(b[1]).startsWith(p)) || a[1].length - b[1].length);
  return hits.map(([id, name]) => ({ id, name }));
}

export const artwork = (id: number) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
// how people here actually catch, pasted as is it mentions Pokétwo
export const catchLine = (name: string) => `@Pokétwo#8236 c ${name}`;
