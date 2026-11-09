import type { Client } from 'discord.js';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { typeIcons } from './pokedex.js';

// Pokémon HOME type badges from the Bulbagarden archives
const BASE = 'https://archives.bulbagarden.net/media/upload/';
const FILES: Record<string, string> = {
  Normal: '8/8c', Fire: 'f/f9', Water: 'e/e7', Grass: '8/81', Electric: 'c/cf', Ice: '8/86', Fighting: 'c/c2', Poison: '9/98', Ground: 'e/ee',
  Flying: 'c/c5', Psychic: '2/2d', Bug: '5/51', Rock: '5/51', Ghost: '2/23', Dragon: 'c/c6', Dark: '7/71', Steel: '7/78', Fairy: '0/0b',
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
// a local copy first, then the full file, the wiki's own thumbnail if the full one is refused
async function download(type: string, path: string): Promise<Buffer | null> {
  // a copy kept in assets wins, the archive refuses a few files to bots
  const local = fileURLToPath(new URL(`../../assets/types/${type.toLowerCase()}.png`, import.meta.url));
  if (existsSync(local)) return readFileSync(local);
  const file = `${type}_icon_HOME3.png`;
  for (const url of [`${BASE}${path}/${file}`, `${BASE}thumb/${path}/${file}/64px-${file}`, `${BASE}thumb/${path}/${file}/63px-${file}`]) {
    const res = await fetch(url, { headers: { 'user-agent': UA, referer: 'https://archives.bulbagarden.net/' } }).catch(() => null);
    if (res?.ok) return Buffer.from(await res.arrayBuffer());
    console.log(`type icon ${type}: http ${res?.status ?? 'error'} for ${url.slice(BASE.length)}`);
  }
  return null;
}
const nameOf = (t: string) => `t_${t.toLowerCase()}`;

// app emoji work in every server, so they are made once and reused
export async function loadTypeIcons(client: Client, tries = 3): Promise<void> {
  const app = client.application;
  if (!app) return;
  const have = await app.emojis.fetch().catch(() => null);
  if (!have) { console.log('type icons: could not list app emoji'); return; }
  for (const [type, path] of Object.entries(FILES)) {
    const name = nameOf(type);
    let e = have.find((x) => x.name === name);
    if (!e) {
      try {
        const png = await download(type, path);
        if (!png) continue;
        e = await app.emojis.create({ attachment: png, name });
      } catch (err) { console.log(`type icon ${type}: ${(err as Error).message}`); continue; }
    }
    typeIcons[type] = { id: e.id, name };
  }
  console.log(`type icons: ${Object.keys(typeIcons).length}/${Object.keys(FILES).length}`);
  // one that failed to download gets another go a minute later
  if (Object.keys(typeIcons).length < Object.keys(FILES).length && tries > 1) setTimeout(() => void loadTypeIcons(client, tries - 1).catch(() => {}), 60_000);
}
