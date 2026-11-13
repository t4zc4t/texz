import { createCanvas, loadImage } from '@napi-rs/canvas';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Store } from '../db.js';
import { canonical, formsOf, nameIn } from './pokedex.js';

// Pokétwo draws each species the same way every time, so a small fingerprint of the picture is enough to know it again.
// The bot starts knowing nothing and learns from every catch, every hint it solves and every name another helper bot gives.

const SIZE = 16;

// a difference hash: shrink to 17x16 in grey, then one bit per pixel for "brighter than the one to its right"
export async function download(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  } catch { return null; }
}

export async function fingerprint(buf: Buffer | null): Promise<string | null> {
  if (!buf) return null;
  try {
    const img = await loadImage(buf);
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

// what the classifier saw, kept as its 20 strongest answers: two spawns of the same variant land close together
export type Sparse = [number, number][];

const cosine = (a: Sparse, b: Sparse) => {
  const mb = new Map(b);
  let dot = 0;
  for (const [i, v] of a) dot += v * (mb.get(i) ?? 0);
  const n = (x: Sparse) => Math.sqrt(x.reduce((s, [, v]) => s + v * v, 0));
  return dot / (n(a) * n(b) || 1);
};

type Memory = [name: string, vec: Sparse];
let memory: Memory[] | null = null;
const mem = (store: Store) => (memory ??= JSON.parse(store.getKv('p2:mem') ?? '[]') as Memory[]);

// every confirmed spawn is remembered with what the classifier saw, newest kept when it gets long
export function remember(store: Store, vec: Sparse, name: string) {
  const list = mem(store);
  list.push([canonical(name), vec.map(([i, v]) => [i, Math.round(v * 1e4) / 1e4])]);
  if (list.length > 4000) list.splice(0, list.length - 4000);
  store.setKv('p2:mem', JSON.stringify(list));
}

export const memorySize = (store: Store) => mem(store).length;

// older entries spelled differently are merged into one name, once
export function foldMemory(store: Store) {
  const list = mem(store);
  let n = 0;
  for (const e of list) { const c = canonical(e[0]); if (c !== e[0]) { e[0] = c; n++; } }
  if (n) store.setKv('p2:mem', JSON.stringify(list));
  return n;
}

// keeps at most `keep` of the newest entries for each of these names
export function trimMemory(store: Store, names: string[], keep: number) {
  const want = new Set(names.map((n) => n.toLowerCase()));
  const count = new Map<string, number>();
  const list = mem(store);
  const kept = list.reverse().filter(([n]) => {
    const k = n.toLowerCase();
    if (!want.has(k)) return true;
    count.set(k, (count.get(k) ?? 0) + 1);
    return count.get(k)! <= keep;
  }).reverse();
  memory = kept;
  store.setKv('p2:mem', JSON.stringify(kept));
  return list.length - kept.length;
}

export function nearest(store: Store, vec: Sparse): { name: string; cos: number; votes: number } | null {
  const scored = mem(store).map(([name, v]) => ({ name, cos: cosine(vec, v) })).sort((a, b) => b.cos - a.cos).slice(0, 5);
  if (!scored.length) return null;
  const best = scored[0];
  return { ...best, votes: scored.filter((s) => s.name === best.name && s.cos >= 0.8).length };
}

export interface Guess { name: string; p: number; how: 'picture' | 'memory' | 'model'; others: string[] }

// the classifier knows species, the memory knows what this server's spawns turned out to be, variants included
export function decide(store: Store, cls: { top: { name: string; p: number }[]; vec: Sparse } | null, seen: { name: string; sure: boolean } | null): Guess | null {
  if (seen?.sure) return { name: seen.name, p: 1, how: 'picture', others: [] };
  const top = cls?.top[0];
  const nn = cls ? nearest(store, cls.vec) : null;
  // a species that has forms here (Alolan Muk, Prof Tangrowth) gets those offered too, the model only knows the plain one
  const forms = top ? formsOf(top.name).filter((f) => !/^(gigantamax|mega|eternamax|primal)/i.test(f)).slice(0, 3) : [];
  const others = [...forms, ...(cls?.top ?? []).slice(1).filter((g) => g.p >= 0.1).map((g) => g.name)].slice(0, 4);
  if (nn && top && nn.cos >= 0.85 && (nameIn(nn.name) === top.name || top.p < 0.6 || nn.votes >= 2)) {
    return { name: nn.name, p: Math.max(top.p, nn.cos), how: 'memory', others: nn.name === top.name ? others : [top.name, ...others].filter((x) => x !== nn.name).slice(0, 2) };
  }
  if (top && top.p >= 0.35) return { name: top.name, p: top.p, how: 'model', others };
  if (seen) return { name: seen.name, p: 0.5, how: 'picture', others: [] };
  return null;
}

// one line per spawn: what was guessed and what it really was, to see where recognition goes wrong
const logFile = fileURLToPath(new URL('../../cache/spawnlog.jsonl', import.meta.url));
export function logSpawn(entry: object) {
  try {
    mkdirSync(dirname(logFile), { recursive: true });
    appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
  } catch { /* only for checking later */ }
}
