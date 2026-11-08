import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { Store } from '../db.js';

// Pokétwo draws each species the same way every time, so a small fingerprint of the picture is enough to know it again.
// The bot starts knowing nothing and learns from every catch, every hint it solves and every name another helper bot gives.

const SIZE = 16;

// a difference hash: shrink to 17x16 in grey, then one bit per pixel for "brighter than the one to its right"
export async function fingerprint(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const img = await loadImage(Buffer.from(await res.arrayBuffer()));
    const c = createCanvas(SIZE + 1, SIZE);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, SIZE + 1, SIZE);
    const px = ctx.getImageData(0, 0, SIZE + 1, SIZE).data;
    const grey = (x: number, y: number) => {
      const i = (y * (SIZE + 1) + x) * 4;
      return px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
    };
    let bits = '';
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) bits += grey(x, y) > grey(x + 1, y) ? '1' : '0';
    let hex = '';
    for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex;
  } catch {
    return null;
  }
}

const POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
export function distance(a: string, b: string) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return d;
}

type Known = [hash: string, name: string];
let known: Known[] | null = null;
const load = (store: Store) => (known ??= JSON.parse(store.getKv('p2:known') ?? '[]') as Known[]);

// close enough counts, the background can shift a little between day and night
const LIMIT = 24;

export function recognise(store: Store, hash: string): { name: string; sure: boolean } | null {
  let best: Known | null = null;
  let bestD = Infinity;
  for (const k of load(store)) {
    const d = distance(hash, k[0]);
    if (d < bestD) { bestD = d; best = k; }
  }
  return best && bestD <= LIMIT ? { name: best[1], sure: bestD <= 10 } : null;
}

export function learn(store: Store, hash: string, name: string) {
  const list = load(store);
  // the same picture already filed under this name, nothing new
  if (list.some(([h, n]) => n === name && distance(h, hash) <= 4)) return false;
  // a near match filed under another name was a wrong guess, it goes
  known = list.filter(([h, n]) => n === name || distance(h, hash) > 4);
  known.push([hash, name]);
  store.setKv('p2:known', JSON.stringify(known));
  return true;
}

export const knownCount = (store: Store) => new Set(load(store).map(([, n]) => n)).size;
