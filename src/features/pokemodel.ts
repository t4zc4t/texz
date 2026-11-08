import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { nameById } from './pokedex.js';
import { fileURLToPath } from 'node:url';
import { report } from '../ops.js';

// an open 1,025 class pokémon classifier, fetched once on first start and kept out of the repo
export const modelDir = fileURLToPath(new URL('../../cache/model/', import.meta.url));
const BASE = 'https://huggingface.co/Sutadasuto/pokedex_project/resolve/main/';
export const FILES = ['pokemon_classifier_1025.onnx', 'pokemon_labels_1025.json'];

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

type Ort = typeof import('onnxruntime-node');
let session: Promise<{ ort: Ort; run: import('onnxruntime-node').InferenceSession; labels: { index: number; id: number }[] } | null> | null = null;

// the runtime lives in node_modules, if it's missing the bot installs it once and restarts itself
async function runtime(): Promise<Ort | null> {
  try {
    const mod = await import('onnxruntime-node');
    return ((mod as { default?: Ort }).default?.InferenceSession ? (mod as { default: Ort }).default : mod) as Ort;
  } catch {
    const flag = `${modelDir}.installing`;
    // one try a day, so a failed install doesn't loop
    if (existsSync(flag) && Date.now() - Number(readFileSync(flag, 'utf8')) < 24 * 3600_000) return null;
    writeFileSync(flag, String(Date.now()));
    const root = fileURLToPath(new URL('../../', import.meta.url));
    console.log('pokemon model: installing onnxruntime, back in a minute');
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], { cwd: root, shell: true, stdio: 'ignore', env: { ...process.env, ONNXRUNTIME_NODE_INSTALL: 'skip' } });
    child.on('exit', (code) => {
      console.log(`pokemon model: install finished (${code}), restarting`);
      if (code === 0) writeFileSync(`${root}.restart`, '');
    });
    return null;
  }
}

function load() {
  session ??= (async () => {
    if (!(await ensureModel())) return null;
    const ort = await runtime();
    if (!ort) { session = null; return null; }
    const run = await ort.InferenceSession.create(`${modelDir}${FILES[0]}`);
    const labels = JSON.parse(readFileSync(`${modelDir}${FILES[1]}`, 'utf8')) as { index: number; id: number }[];
    console.log('pokemon model: ready');
    return { ort, run, labels };
  })().catch((e) => { report('pokemon model load', e); session = null; return null; });
  return session;
}
export const warmModel = () => void load();

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

// best guesses for a spawn picture: the middle square, where Pokétwo puts the pokémon, at 224x224
export async function classify(image: Buffer): Promise<{ name: string; p: number }[]> {
  const m = await load();
  if (!m) return [];
  const img = await loadImage(image);
  const area = 224 * 224;
  // a few squares around the middle, tighter and looser, averaged, so a small pokémon still fills one of them
  const crops = [1, 0.75, 0.55];
  const t = new Float32Array(crops.length * 3 * area);
  crops.forEach((scale, n) => {
    const side = Math.min(img.width, img.height) * scale;
    const c = createCanvas(224, 224);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 224, 224);
    const px = ctx.getImageData(0, 0, 224, 224).data;
    for (let i = 0; i < area; i++) for (let ch = 0; ch < 3; ch++) t[n * 3 * area + ch * area + i] = (px[i * 4 + ch] / 255 - MEAN[ch]) / STD[ch];
  });
  const out = await m.run.run({ [m.run.inputNames[0]]: new m.ort.Tensor('float32', t, [crops.length, 3, 224, 224]) });
  const logits = out[m.run.outputNames[0]].data as Float32Array;
  const classes = logits.length / crops.length;
  const exp = new Array<number>(classes).fill(0);
  for (let n = 0; n < crops.length; n++) {
    const row = logits.subarray(n * classes, (n + 1) * classes);
    const top = Math.max(...row);
    const e = Array.from(row, (v) => Math.exp(v - top));
    const z = e.reduce((x, y) => x + y, 0);
    e.forEach((v, i) => { exp[i] += v / z / crops.length; });
  }
  const sum = 1;
  return exp.map((v, i) => ({ i, p: v / sum })).sort((a, b) => b.p - a.p).slice(0, 3)
    .map(({ i, p }) => ({ name: nameById(m.labels.find((l) => l.index === i)?.id ?? -1) ?? '?', p }));
}
