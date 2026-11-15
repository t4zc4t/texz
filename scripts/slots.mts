import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc as any;
for (const f of readdirSync('assets/fonts')) GlobalFonts.registerFromPath(`assets/fonts/${f}`);
// the reel symbols and the spinning reel for the slots, drawn once into assets/slots
// run: npx tsx scripts/slots.mts <path to lucide-static/icons>
const ICONS = process.argv[2] ?? 'node_modules/lucide-static/icons';
mkdirSync('assets/slots', { recursive: true });
// symbol: lucide glyph or a big seven, a colour, drawn thick with a soft glow
const SYMS = [
  { id: 'cherry', icon: 'cherry', c: '#FF4D5E' },
  { id: 'lemon', icon: 'citrus', c: '#FFD23F' },
  { id: 'bell', icon: 'bell', c: '#FFA62B' },
  { id: 'gem', icon: 'gem', c: '#3DE0FF' },
  { id: 'seven', icon: null, c: '#FF3355' },
];
async function sym(s: (typeof SYMS)[number], size = 128, glow = true) {
  const c = createCanvas(size, size); const x = c.getContext('2d');
  const k = size / 128;
  if (s.icon) {
    const svg = readFileSync(`${ICONS}/${s.icon}.svg`, 'utf8').replace(/<!--.*?-->/s, '').replace(/currentColor/g, s.c).replace(/stroke-width="2"/, 'stroke-width="2.6"').replace(/width="24"\s+height="24"/, 'width="256" height="256"').replace(/fill="none"/, `fill="${s.c}33"`);
    const img = await loadImage(Buffer.from(svg));
    x.shadowColor = s.c; x.shadowBlur = glow ? 14 * k : 0;
    x.drawImage(img, 10 * k, 10 * k, 108 * k, 108 * k);
  } else {
    x.font = `900 ${132 * k}px "Texz Serif", serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = '#FFB000'; x.shadowBlur = glow ? 14 * k : 0;
    const g = x.createLinearGradient(0, 10 * k, 0, 118 * k); g.addColorStop(0, '#FF7A85'); g.addColorStop(1, '#D9142E');
    x.lineWidth = 9 * k; x.strokeStyle = '#FFC93C'; x.strokeText('7', 64 * k, 70 * k);
    x.fillStyle = g; x.fillText('7', 64 * k, 70 * k);
  }
  return c;
}
const tiles = await Promise.all(SYMS.map((s) => sym(s)));
for (const [i, t] of tiles.entries()) writeFileSync(`assets/slots/${SYMS[i].id}.png`, t.toBuffer('image/png'));
// the spinning reel: symbols sliding down a window with a blur, looped
const S = 128, frames = 12, enc = GIFEncoder();
const strip = createCanvas(S, S * SYMS.length); const st = strip.getContext('2d');
const flat = await Promise.all(SYMS.map((q) => sym(q, 128, false)));
flat.forEach((t, i) => st.drawImage(t, 0, i * S + 0));
const shots: Uint8ClampedArray[] = [];
for (let f = 0; f < frames; f++) {
  const c = createCanvas(S, S); const x = c.getContext('2d');
  const off = (f / frames) * S * SYMS.length;
  // a short smear along the drop, solid so it survives the gif's on/off transparency
  for (const [b, al] of [[14, 0.5], [7, 0.8], [0, 1]] as const) { x.globalAlpha = al; const o = (off + b) % (S * SYMS.length); x.drawImage(strip, 0, -o); x.drawImage(strip, 0, -o + S * SYMS.length); }
  x.globalAlpha = 1;
  // a hard alpha edge: half-see-through pixels become solid or gone
  const d = x.getImageData(0, 0, S, S);
  for (let p = 3; p < d.data.length; p += 4) d.data[p] = d.data[p] > 110 ? 255 : 0;
  x.putImageData(d, 0, 0);
  shots.push(new Uint8ClampedArray(x.getImageData(0, 0, S, S).data));
}
const all = new Uint8ClampedArray(shots.length * S * S * 4); shots.forEach((s, i) => all.set(s, i * S * S * 4));
const palette = quantize(all, 255, { format: 'rgba4444', oneBitAlpha: true });
for (const s of shots) enc.writeFrame(applyPalette(s, palette, 'rgba4444'), S, S, { palette, delay: 50, transparent: true, repeat: 0 });
enc.finish(); writeFileSync('assets/slots/spin.gif', enc.bytes());
