import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import gifenc from 'gifenc';
import { coinEmojiArt } from '../src/features/coinart.ts';
const { GIFEncoder, quantize, applyPalette } = gifenc as any;
// the casino's small art: coin faces and spin, a roulette wheel that spins, and the colour chips
mkdirSync('assets/casino', { recursive: true });
const coin = await coinEmojiArt();
writeFileSync('assets/casino/coin_heads.png', coin.heads);
writeFileSync('assets/casino/coin_tails.png', coin.tails);
writeFileSync('assets/casino/coin_spin.gif', coin.spin);

const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colourOf = (n: number) => (n === 0 ? '#1E9E5A' : REDS.has(n) ? '#D7263D' : '#1A1A1E');
function wheel(S: number, turn: number, ball: number | null) {
  const c = createCanvas(S, S); const x = c.getContext('2d');
  const cx = S / 2, R = S / 2 - 3;
  // gold rim
  x.fillStyle = '#C8A24A'; x.beginPath(); x.arc(cx, cx, R, 0, 7); x.fill();
  x.fillStyle = '#5A3A1C'; x.beginPath(); x.arc(cx, cx, R - 5, 0, 7); x.fill();
  const step = (Math.PI * 2) / 37;
  ORDER.forEach((n, i) => {
    const a = turn + i * step;
    x.fillStyle = colourOf(n);
    x.beginPath(); x.moveTo(cx, cx); x.arc(cx, cx, R - 8, a, a + step); x.closePath(); x.fill();
  });
  // the inner cone and the turret
  const g = x.createRadialGradient(cx - 6, cx - 6, 2, cx, cx, R * 0.5);
  g.addColorStop(0, '#E9D3A0'); g.addColorStop(1, '#7A5A2E');
  x.fillStyle = g; x.beginPath(); x.arc(cx, cx, R * 0.48, 0, 7); x.fill();
  x.strokeStyle = '#C8A24A'; x.lineWidth = 5;
  for (let k = 0; k < 4; k++) { const a = -turn * 1.5 + (k * Math.PI) / 2; x.beginPath(); x.moveTo(cx, cx); x.lineTo(cx + Math.cos(a) * R * 0.38, cx + Math.sin(a) * R * 0.38); x.stroke(); }
  x.fillStyle = '#F2E2B8'; x.beginPath(); x.arc(cx, cx, 7, 0, 7); x.fill();
  if (ball !== null) { x.fillStyle = '#FFFFFF'; x.beginPath(); x.arc(cx + Math.cos(ball) * (R - 16), cx + Math.sin(ball) * (R - 16), 6, 0, 7); x.fill(); }
  return c;
}
// spinning: the wheel one way, the ball the other
{
  const S = 128, n = 18, shots: Uint8ClampedArray[] = [];
  for (let f = 0; f < n; f++) {
    const c = wheel(S, (f / n) * ((Math.PI * 2) / 37) * 6, -(f / n) * Math.PI * 2);
    const d = c.getContext('2d').getImageData(0, 0, S, S);
    for (let p = 3; p < d.data.length; p += 4) d.data[p] = d.data[p] > 110 ? 255 : 0;
    shots.push(new Uint8ClampedArray(d.data));
  }
  const all = new Uint8ClampedArray(shots.length * S * S * 4); shots.forEach((s, i) => all.set(s, i * S * S * 4));
  const palette = quantize(all, 255, { format: 'rgba4444', oneBitAlpha: true });
  const enc = GIFEncoder();
  for (const s of shots) enc.writeFrame(applyPalette(s, palette, 'rgba4444'), S, S, { palette, delay: 40, transparent: true, repeat: 0 });
  enc.finish(); writeFileSync('assets/casino/wheel_spin.gif', enc.bytes());
  writeFileSync('assets/casino/wheel.png', wheel(S, 0, null).toBuffer('image/png'));
}
// chips: a poker chip in each pocket colour
for (const [name, col] of [['red', '#D7263D'], ['black', '#2A2A30'], ['green', '#1E9E5A']] as const) {
  const S = 128, c = createCanvas(S, S), x = c.getContext('2d'), cx = S / 2;
  x.fillStyle = col; x.beginPath(); x.arc(cx, cx, 60, 0, 7); x.fill();
  x.fillStyle = '#F4EBD6';
  for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; x.save(); x.translate(cx, cx); x.rotate(a); x.fillRect(-7, -60, 14, 16); x.restore(); }
  x.strokeStyle = '#F4EBD6'; x.lineWidth = 3; x.setLineDash([6, 6]); x.beginPath(); x.arc(cx, cx, 36, 0, 7); x.stroke(); x.setLineDash([]);
  x.fillStyle = name === 'black' ? '#3A3A42' : col; x.beginPath(); x.arc(cx, cx, 30, 0, 7); x.fill();
  writeFileSync(`assets/casino/chip_${name}.png`, c.toBuffer('image/png'));
}
