import type { Client } from 'discord.js';
import { typeIcons } from './pokedex.js';

// Pokémon HOME type badges from the Bulbagarden archives
const BASE = 'https://archives.bulbagarden.net/media/upload/';
const FILES: Record<string, string> = {
  Normal: '8/8c', Fire: 'f/f9', Water: 'e/e7', Grass: '8/81', Electric: 'c/cf', Ice: '8/86', Fighting: 'c/c2', Poison: '9/98', Ground: 'e/ee',
  Flying: 'c/c5', Psychic: '2/2d', Bug: '5/51', Rock: '5/51', Ghost: '2/23', Dragon: 'c/c6', Dark: '7/71', Steel: '7/78', Fairy: '0/0b',
};
const nameOf = (t: string) => `t_${t.toLowerCase()}`;

// app emoji work in every server, so they are made once and reused
export async function loadTypeIcons(client: Client, tries = 3): Promise<void> {
  const app = client.application;
  if (!app) return;
  const have = await app.emojis.fetch().catch(() => null);
  if (!have) return;
  for (const [type, path] of Object.entries(FILES)) {
    const name = nameOf(type);
    let e = have.find((x) => x.name === name);
    if (!e) {
      try {
        const res = await fetch(`${BASE}${path}/${type}_icon_HOME3.png`, { headers: { 'user-agent': 'texz-bot' } });
        if (!res.ok) continue;
        e = await app.emojis.create({ attachment: Buffer.from(await res.arrayBuffer()), name });
      } catch { continue; }
    }
    typeIcons[type] = { id: e.id, name };
  }
  // one that failed to download gets another go a minute later
  if (Object.keys(typeIcons).length < Object.keys(FILES).length && tries > 1) setTimeout(() => void loadTypeIcons(client, tries - 1).catch(() => {}), 60_000);
}
