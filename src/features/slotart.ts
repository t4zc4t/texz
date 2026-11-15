import type { Client } from 'discord.js';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// the slot reels as app emoji: five symbols and one spinning reel, drawn by scripts/slots.mts
export const SLOT_SYMS = ['cherry', 'lemon', 'bell', 'gem', 'seven'] as const;
export type SlotSym = (typeof SLOT_SYMS)[number];
const STOCK: Record<SlotSym | 'spin', string> = { cherry: '🍒', lemon: '🍋', bell: '🔔', gem: '💎', seven: '7️⃣', spin: '🎰' };
const art: Partial<Record<SlotSym | 'spin', string>> = {};

// the emoji for a symbol, or a stock one until the art is in
export const slotEmoji = (s: SlotSym | 'spin') => art[s] ?? STOCK[s];

export async function loadSlotArt(client: Client) {
  const app = client.application;
  if (!app) return;
  const have = await app.emojis.fetch().catch(() => null);
  if (!have) return;
  for (const s of [...SLOT_SYMS, 'spin'] as const) {
    const name = `sl_${s}`;
    const file = fileURLToPath(new URL(`../../assets/slots/${s}.${s === 'spin' ? 'gif' : 'png'}`, import.meta.url));
    let e = have.find((x) => x.name === name);
    if (!e && existsSync(file)) e = await app.emojis.create({ attachment: readFileSync(file), name }).catch((err) => { console.log(`slot art ${s}: ${(err as Error).message}`); return undefined; });
    if (e) art[s] = `<${e.animated ? 'a' : ''}:${name}:${e.id}>`;
  }
  console.log(`slot art: ${Object.keys(art).length}/6`);
}
