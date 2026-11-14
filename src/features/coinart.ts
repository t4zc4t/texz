import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import gifenc from 'gifenc';
import { fileURLToPath } from 'node:url';

// the Lupin coin: the Agency on one side, the Port Mafia on the other, tossed on the bar counter
const { GIFEncoder, applyPalette, quantize } = gifenc;
const fontDir = fileURLToPath(new URL('../../assets/fonts/', import.meta.url));
GlobalFonts.registerFromPath(`${fontDir}cinzel-latin-700-normal.woff2`, 'Coin Serif');

const W = 320;
const H = 240;
const R = 54;
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

function scene(ctx: SKRSContext2D, side: Side, squash: number, lift: number, spin: number) {
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  // the counter
  ctx.fillStyle = PANEL;
  ctx.fillRect(0, H - 52, W, 52);
  ctx.fillStyle = '#c8283c';
  ctx.fillRect(0, H - 52, W, 2);
  // shadow shrinks while the coin is up
  const sh = 1 - Math.min(1, lift / 78) * 0.6;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath(); ctx.ellipse(W / 2, H - 34, R * sh, 9 * sh, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(W / 2, H - 34 - R * 0.95 - lift);
  ctx.rotate(spin);
  ctx.scale(1, Math.max(0.04, Math.abs(squash)));
  if (Math.abs(squash) < 0.12) {
    // edge on: just the rim
    ctx.fillStyle = '#7a5a2e';
    ctx.fillRect(-R, -R, R * 2, R * 2);
  } else face(ctx, side);
  ctx.restore();
}

const still = (side: Side) => {
  const c = createCanvas(W, H);
  scene(c.getContext('2d'), side, 1, 0, 0);
  return c.toBuffer('image/png');
};

// a toss: up, eight half turns, down, landing on `side`
function toss(side: Side): Buffer {
  const frames = 30;
  const enc = GIFEncoder();
  const shots: Uint8ClampedArray[] = [];
  for (let f = 0; f <= frames; f++) {
    const t = f / frames;
    const lift = Math.sin(t * Math.PI) * 78;
    const turns = 8 * Math.PI * (1 - (1 - t) ** 2);
    // the face showing flips every half turn, ending on the right one
    const showing: Side = Math.floor(turns / Math.PI) % 2 === 0 ? side : side === 'Heads' ? 'Tails' : 'Heads';
    const c = createCanvas(W, H);
    const ctx = c.getContext('2d');
    scene(ctx, showing, Math.cos(turns), lift, Math.sin(t * Math.PI) * 0.4);
    shots.push(ctx.getImageData(0, 0, W, H).data);
  }
  const palette = quantize(shots[Math.floor(frames / 2)].length ? concat([shots[0], shots[8], shots[frames]]) : shots[0], 128);
  shots.forEach((px, i) => enc.writeFrame(applyPalette(px, palette), W, H, { palette, delay: i === shots.length - 1 ? 1500 : 40, repeat: -1 }));
  enc.finish();
  return Buffer.from(enc.bytes());
}
const concat = (parts: Uint8ClampedArray[]) => {
  const out = new Uint8ClampedArray(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

// drawn once, the first time someone flips
let made: { still: Record<Side, Buffer>; toss: Record<Side, Buffer> } | null = null;
export function coinArt() {
  made ??= { still: { Heads: still('Heads'), Tails: still('Tails') }, toss: { Heads: toss('Heads'), Tails: toss('Tails') } };
  return made;
}
