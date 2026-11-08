import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { report } from '../ops.js';

// an open 1,025 class pokémon classifier, fetched once on first start and kept out of the repo
export const modelDir = fileURLToPath(new URL('../../cache/model/', import.meta.url));
const BASE = 'https://huggingface.co/BiernyVR/pokemon-classifier-mobilenetv3/resolve/main/';
const FILES = ['pokemon_classifier.onnx', 'pokemon_labels.json'];

export async function ensureModel() {
  mkdirSync(modelDir, { recursive: true });
  for (const f of FILES) {
    if (existsSync(`${modelDir}${f}`)) continue;
    try {
      const res = await fetch(`${BASE}${f}`, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`${f}: ${res.status}`);
      writeFileSync(`${modelDir}${f}`, Buffer.from(await res.arrayBuffer()));
      console.log(`pokemon model: got ${f}`);
    } catch (e) {
      report('pokemon model download', e);
      return false;
    }
  }
  return true;
}

// spawn pictures with their names, kept so recognition can be checked and improved
const spawnDir = fileURLToPath(new URL('../../cache/spawns/', import.meta.url));
export function keepSpawn(image: Buffer, name: string) {
  try {
    mkdirSync(spawnDir, { recursive: true });
    writeFileSync(`${spawnDir}${name.replace(/[^\w-]+/g, '_')}-${Date.now()}.png`, image);
  } catch { /* nice to have */ }
}
