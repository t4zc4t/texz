import type { Client } from 'discord.js';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// the casino's art as app emoji: slot symbols and reel from assets/slots, coin, wheel and chips from assets/casino
// drawn by scripts/slots.mts and scripts/casinoart.mts
export const SLOT_SYMS = ['cherry', 'lemon', 'bell', 'gem', 'seven'] as const;
export type SlotSym = (typeof SLOT_SYMS)[number];
const STOCK: Record<string, string> = {
  cherry: '🍒', lemon: '🍋', bell: '🔔', gem: '💎', seven: '7️⃣', spin: '🎰',
  coin_heads: '🪙', coin_tails: '🪙', coin_spin: '🪙', wheel: '🎡', wheel_spin: '🎡', chip_red: '🔴', chip_black: '⚫', chip_green: '🟢',
};
const art: Record<string, string> = {};

// the emoji for a piece of art, or a stock one until it's in
export const slotEmoji = (s: string) => art[s] ?? STOCK[s] ?? '';
export const casinoEmoji = slotEmoji;

export async function loadSlotArt(client: Client) {
  const app = client.application;
  if (!app) return;
  const have = await app.emojis.fetch().catch(() => null);
  if (!have) return;
  const sets: [string, string][] = [['slots', 'sl_'], ['casino', 'cs_']];
  let total = 0;
  for (const [dir, prefix] of sets) {
    const at = fileURLToPath(new URL(`../../assets/${dir}/`, import.meta.url));
    if (!existsSync(at)) continue;
    for (const f of readdirSync(at).filter((x) => /\.(png|gif)$/.test(x))) {
      total++;
      const key = f.replace(/\.(png|gif)$/, '');
      const name = `${prefix}${key}`;
      let e = have.find((x) => x.name === name);
      if (!e) e = await app.emojis.create({ attachment: readFileSync(`${at}${f}`), name }).catch((err) => { console.log(`casino art ${key}: ${(err as Error).message}`); return undefined; });
      if (e) art[key] = `<${e.animated ? 'a' : ''}:${name}:${e.id}>`;
    }
  }
  console.log(`casino art: ${Object.keys(art).length}/${total}`);
}
