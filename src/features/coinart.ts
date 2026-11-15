import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import gifenc from 'gifenc';
import { fileURLToPath } from 'node:url';

// the Lupin coin: the Agency on one side, the Port Mafia on the other, tossed on the bar counter
const { GIFEncoder, quantize } = gifenc;

// every pixel to its nearest palette colour, remembered across frames so a colour never changes between frames
function mapper(palette: number[][]) {
  const seen = new Map<number, number>();
  return (px: Uint8ClampedArray) => {
    const out = new Uint8Array(px.length / 4);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
      let best = seen.get(key);
      if (best === undefined) {
        let d = Infinity;
        best = 0;
        for (let k = 0; k < palette.length; k++) {
          const c = palette[k];
          const e = (c[0] - px[i]) ** 2 + (c[1] - px[i + 1]) ** 2 + (c[2] - px[i + 2]) ** 2;
          if (e < d) { d = e; best = k; }
        }
        seen.set(key, best);
      }
      out[j] = best;
    }
    return out;
  };
}
const fontDir = fileURLToPath(new URL('../../assets/fonts/', import.meta.url));
GlobalFonts.registerFromPath(`${fontDir}cinzel-latin-700-normal.woff2`, 'Coin Serif');

const W = 360;
const H = 260;
const R = 56;
const INK = '#141010';
const PANEL = '#1C1716';

export type Side = 'Heads' | 'Tails';

function ringText(ctx: SKRSContext2D, text: string, radius: number) {
  ctx.save();
  ctx.font = '700 10px "Coin Serif"';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = Math.min(0.3, (Math.PI * 1.55) / text.length);
  let a = -(step * (text.length - 1)) / 2;
  for (const ch of text) {
    ctx.save();
    ctx.rotate(a);
    ctx.translate(0, -radius);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    a += step;
  }
  ctx.restore();
}

// one face, drawn at the origin
function face(ctx: SKRSContext2D, side: Side) {
  const mafia = side === 'Tails';
  const g = ctx.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.1, 0, 0, R);
  g.addColorStop(0, mafia ? '#7a2a30' : '#f1dcb0');
  g.addColorStop(0.7, mafia ? '#4e0910' : '#c8a97e');
  g.addColorStop(1, mafia ? '#2a0508' : '#7a5a2e');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  // milled rim
  ctx.strokeStyle = mafia ? '#c8283c' : '#7a5a2e';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(0, 0, R - 3, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, 0, R - 19, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = mafia ? '#e8b4ba' : '#3a2a16';
  ringText(ctx, mafia ? 'PORT MAFIA' : 'ARMED DETECTIVE AGENCY', R - 11);
  if (mafia) {
    // a blood moon for the Mafia
    ctx.fillStyle = '#e8475b';
    ctx.beginPath(); ctx.arc(0, 4, 19, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4e0910';
    ctx.beginPath(); ctx.arc(8, -1, 17, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.font = '700 36px "Coin Serif"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('¥', 0, 6);
  }
}

// the counter, the coin at height `lift`, turned `turn` radians about its flip axis, tilted `tilt`
function scene(ctx: SKRSContext2D, faces: Record<Side, CanvasImage>, side: Side, turn: number, lift: number, tilt: number) {
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  // the counter, polished wood with a red edge
  const top = H - 54;
  ctx.fillStyle = PANEL;
  ctx.fillRect(0, top, W, H - top);
  ctx.fillStyle = '#c8283c';
  ctx.fillRect(0, top, W, 2);
  const rest = top + 22;
  // the shadow tightens as the coin comes down
  const k = 1 - Math.min(1, lift / 90) * 0.65;
  ctx.fillStyle = `rgba(0,0,0,${0.25 + 0.4 * k})`;
  ctx.beginPath(); ctx.ellipse(W / 2, rest + 2, R * k, 8 * k, 0, 0, Math.PI * 2); ctx.fill();
  const drawCoin = (t: number, l: number, alpha: number) => {
    const c = Math.cos(t);
    const h = Math.abs(c);
    const showing: Side = c >= 0 ? side : side === 'Heads' ? 'Tails' : 'Heads';
    // a coin lying flat sits on its edge's bottom, a flipping one spins about its middle
    const cy = rest - R * 0.92 - l;
    const thick = 7 * Math.sqrt(Math.max(0, 1 - h * h));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2, cy);
    ctx.rotate(tilt);
    // the milled edge shows as a band when the coin is turned
    if (thick > 0.6) {
      ctx.fillStyle = showing === 'Tails' ? '#5a0c14' : '#7a5a2e';
      ctx.beginPath(); ctx.ellipse(0, thick, R, R * h, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(-R, 0, R * 2, thick);
      ctx.strokeStyle = showing === 'Tails' ? '#3a0509' : '#5a3f1c';
      ctx.lineWidth = 1;
      for (let x = -R + 3; x < R; x += 5) { ctx.beginPath(); ctx.moveTo(x, 1); ctx.lineTo(x, thick); ctx.stroke(); }
    }
    ctx.scale(1, Math.max(0.03, h));
    ctx.drawImage(faces[showing], -R, -R, R * 2, R * 2);
    // light runs across the face as it turns
    ctx.globalCompositeOperation = 'source-atop';
    const sheen = ctx.createLinearGradient(-R, -R, R, R);
    const at = (Math.sin(t * 2) + 1) / 2;
    sheen.addColorStop(Math.max(0, at - 0.15), 'rgba(255,255,255,0)');
    sheen.addColorStop(at, `rgba(255,248,230,${0.35 * h})`);
    sheen.addColorStop(Math.min(1, at + 0.15), 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    // and it darkens edge on
    ctx.fillStyle = `rgba(0,0,0,${0.45 * (1 - h)})`;
    ctx.fill();
    ctx.restore();
  };
  drawCoin(turn, lift, 1);
}

type CanvasImage = Awaited<ReturnType<typeof faceImage>>;
async function faceImage(side: Side) {
  const c = createCanvas(R * 2, R * 2);
  const ctx = c.getContext('2d');
  ctx.translate(R, R);
  face(ctx, side);
  const { loadImage } = await import('@napi-rs/canvas');
  return loadImage(c.toBuffer('image/png'));
}

function frames(faces: Record<Side, CanvasImage>, side: Side): Uint8ClampedArray[] {
  const out: Uint8ClampedArray[] = [];
  const shot = (turn: number, lift: number, tilt: number) => {
    const c = createCanvas(W, H);
    const ctx = c.getContext('2d');
    scene(ctx, faces, side, turn, lift, tilt);
    // copied, the canvas memory goes away with the canvas
    out.push(new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data));
  };
  // resting on the other face, so the first frame gives nothing away, then a thumb flick
  const start = Math.PI;
  for (let i = 0; i < 3; i++) shot(start, 0, 0);
  // up and down: nine half turns, fast off the thumb, slowing as it falls
  const air = 34;
  const spins = 9 * Math.PI;
  const end = start + spins;
  for (let f = 1; f <= air; f++) {
    const t = f / air;
    const lift = Math.sin(t * Math.PI) * 92;
    const turn = start + spins * (1 - (1 - t) ** 1.6);
    shot(turn, lift, Math.sin(t * Math.PI * 2) * 0.08);
  }
  // it lands, hops once, then rocks to a stop
  const hop = 8;
  for (let f = 1; f <= hop; f++) {
    const t = f / hop;
    shot(end + Math.sin(t * Math.PI) * 0.5, Math.sin(t * Math.PI) * 14, Math.sin(t * Math.PI * 3) * 0.06 * (1 - t));
  }
  for (let f = 1; f <= 8; f++) {
    const fade = 1 - f / 8;
    shot(end + Math.sin(f * 1.6) * 0.35 * fade, 0, Math.sin(f * 1.3) * 0.05 * fade);
  }
  return out;
}

const still = (faces: Record<Side, CanvasImage>, side: Side) => {
  const c = createCanvas(W, H);
  scene(c.getContext('2d'), faces, side, 0, 0, 0);
  return c.toBuffer('image/png');
};

function toss(faces: Record<Side, CanvasImage>, side: Side): Buffer {
  const shots = frames(faces, side);
  const enc = GIFEncoder();
  // one palette from frames across the whole toss keeps the colours steady
  const palette = quantize(concat([shots[0], shots[10], shots[20], shots[30], shots[shots.length - 1]]), 256);
  const map = mapper(palette);
  shots.forEach((px, i) => enc.writeFrame(map(px), W, H, { palette, delay: i === shots.length - 1 ? 2000 : i < 3 ? 60 : 30, repeat: -1 }));
  enc.finish();
  return Buffer.from(enc.bytes());
}
const concat = (parts: Uint8ClampedArray[]) => {
  const out = new Uint8ClampedArray(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

// drawn once at start, ready for the first flip
let made: { still: Record<Side, Buffer>; toss: Record<Side, Buffer> } | null = null;
export async function prepareCoin() {
  if (made) return made;
  const faces = { Heads: await faceImage('Heads'), Tails: await faceImage('Tails') };
  made = { still: { Heads: still(faces, 'Heads'), Tails: still(faces, 'Tails') }, toss: { Heads: toss(faces, 'Heads'), Tails: toss(faces, 'Tails') } };
  return made;
}
export const coinArt = () => made;

// the coin as small emoji art: each face on its own, and a coin turning over and over
export async function coinEmojiArt(size = 128) {
  const faces = { Heads: await faceImage('Heads'), Tails: await faceImage('Tails') };
  const flat = (side: Side) => {
    const c = createCanvas(size, size);
    c.getContext('2d').drawImage(faces[side], 4, 4, size - 8, size - 8);
    return c.toBuffer('image/png');
  };
  const shots: Uint8ClampedArray[] = [];
  const n = 16;
  for (let f = 0; f < n; f++) {
    const t = (f / n) * Math.PI * 2;
    const c = createCanvas(size, size);
    const x = c.getContext('2d');
    const h = Math.abs(Math.cos(t));
    const showing: Side = Math.cos(t) >= 0 ? 'Heads' : 'Tails';
    const r = size / 2 - 4;
    x.translate(size / 2, size / 2);
    x.scale(Math.max(0.06, h), 1);
    x.drawImage(faces[showing], -r, -r, r * 2, r * 2);
    x.setTransform(1, 0, 0, 1, 0, 0);
    const d = x.getImageData(0, 0, size, size);
    for (let p = 3; p < d.data.length; p += 4) d.data[p] = d.data[p] > 110 ? 255 : 0;
    shots.push(new Uint8ClampedArray(d.data));
  }
  // the colours from the solid pixels, and one more slot kept for see-through
  const solid = concat(shots.map((p) => p.filter((_, i) => p[i - (i % 4) + 3] === 255)));
  const palette = quantize(solid, 255);
  const near = mapper(palette);
  palette.push([0, 0, 0]);
  const clear = palette.length - 1;
  const enc = GIFEncoder();
  for (const p of shots) {
    const idx = near(p);
    for (let i = 0; i < idx.length; i++) if (p[i * 4 + 3] === 0) idx[i] = clear;
    enc.writeFrame(idx, size, size, { palette, delay: 40, transparent: true, transparentIndex: clear, repeat: 0 } as never);
  }
  enc.finish();
  return { heads: flat('Heads'), tails: flat('Tails'), spin: Buffer.from(enc.bytes()) };
}
