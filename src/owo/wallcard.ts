import { GlobalFonts, createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';

// An OwO profile drawn over a wallpaper, so you can see one before buying it.
// OwO's profile is a 400×300 card on top of the wallpaper; the boxes and text sit where OwO puts them.
// Drawn at twice the size so it stays sharp in Discord.

const fontDir = fileURLToPath(new URL('../../assets/fonts/', import.meta.url));
for (const [file, family] of [['roboto-latin-300-normal', 'OwO Light'], ['roboto-latin-300-italic', 'OwO Light Italic'], ['roboto-latin-400-normal', 'OwO Regular'], ['roboto-latin-500-normal', 'OwO Medium'], ['roboto-latin-700-normal', 'OwO Bold']]) {
  GlobalFonts.registerFromPath(`${fontDir}${file}.woff2`, family);
}

const S = 2;
const W = 400;
const H = 300;

export interface WallPet { image: Buffer | null; label: string; level: number | null }
export interface WallCard {
  wallpaper: Buffer;
  avatar: Buffer | null;
  name: string;
  title: string;
  accent: string; // name and title colour
  level: number | null;
  rank: string | null;
  xp: [number, number] | null;
  cookies: number | null;
  teamName: string;
  pets: WallPet[];
  about: string;
  partner: string | null;
}

const font = (px: number, family: string) => `${px}px "${family}"`;

function shade(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, grey: number, a: number) {
  ctx.fillStyle = `rgba(${grey},${grey},${grey + 2},${a})`;
  ctx.fillRect(x, y, w, h);
}

function fit(ctx: SKRSContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

// the name shrinks to fit the space beside the avatar, the way OwO does it
function sized(ctx: SKRSContext2D, text: string, max: number, from: number, family: string) {
  let px = from;
  ctx.font = font(px, family);
  while (px > 14 && ctx.measureText(text).width > max) ctx.font = font(--px, family);
  return px;
}

function wrap(ctx: SKRSContext2D, text: string, max: number, lines: number) {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(next).width <= max) { cur = next; continue; }
    if (cur) out.push(cur);
    cur = word;
    if (out.length === lines) break;
  }
  if (cur && out.length < lines) out.push(cur);
  if (out.length === lines) out[lines - 1] = fit(ctx, out[lines - 1], max);
  return out.slice(0, lines);
}

export async function wallCard(d: WallCard): Promise<Buffer> {
  const c = createCanvas(W * S, H * S);
  const ctx = c.getContext('2d');
  ctx.scale(S, S);
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 6);
  ctx.clip();

  // the wallpaper, stretched over the whole card
  const wall = await loadImage(d.wallpaper);
  ctx.drawImage(wall, 0, 0, W, H);

  // the shaded boxes, measured off a real OwO profile: under the name, the stats, and about me
  shade(ctx, 10, 88, 380, 33, 20, 0.75);
  shade(ctx, 10, 121, 110, 90, 51, 0.75);
  shade(ctx, 120, 121, 270, 90, 39, 0.85);
  shade(ctx, 10, 211, 380, 80, 58, 0.65);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(10, 162, 110, 1);

  // avatar
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(14, 14, 102, 102);
  if (d.avatar) ctx.drawImage(await loadImage(d.avatar), 15, 15, 100, 100);

  // name and title in the accent colour
  ctx.fillStyle = d.accent;
  ctx.textBaseline = 'alphabetic';
  sized(ctx, d.name, 262, 36, 'OwO Light');
  ctx.fillText(d.name, 126, 58);
  if (d.title) {
    ctx.font = font(17, 'OwO Light Italic');
    ctx.fillText(fit(ctx, d.title, 262), 128, 82);
  }

  // level and cookies on the left
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'right';
  ctx.font = font(15, 'OwO Light');
  ctx.fillText('Level', 66, 157);
  ctx.font = font(38, 'OwO Light');
  ctx.textAlign = 'left';
  ctx.fillText(d.level === null ? '?' : String(d.level), 76, 157);
  ctx.textAlign = 'right';
  ctx.font = font(26, 'OwO Light');
  ctx.fillText(d.cookies === null ? '+?' : `+${d.cookies.toLocaleString('en-US')}`, 116, 188);
  ctx.font = font(15, 'OwO Light');
  ctx.fillText('Cookies', 116, 203);

  // rank, xp and the xp bar
  ctx.textAlign = 'left';
  ctx.font = font(14, 'OwO Bold');
  ctx.fillText('Rank:', 126, 138);
  ctx.fillText('XP:', 262, 138);
  ctx.font = font(13, 'OwO Light');
  ctx.fillText(d.rank ?? '#?', 174, 138);
  ctx.textAlign = 'right';
  ctx.fillText(d.xp ? `${d.xp[0].toLocaleString('en-US')}/${d.xp[1].toLocaleString('en-US')}` : '?/?', 380, 138);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.strokeRect(126.5, 145.5, 253, 8);
  ctx.fillStyle = '#ffffff';
  const part = d.xp && d.xp[1] ? Math.min(1, d.xp[0] / d.xp[1]) : 0;
  if (part > 0) ctx.fillRect(128, 147, Math.max(1, 250 * part), 5);

  // the team: its name between bars, then each pet with its level
  ctx.textAlign = 'center';
  ctx.font = font(15, 'OwO Regular');
  const tn = fit(ctx, `| ${d.teamName} |`, 230);
  ctx.fillText(tn, 252, 177);
  const half = ctx.measureText(tn).width / 2 + 10;
  ctx.fillRect(252 - half, 164, 1, 17);
  ctx.fillRect(252 + half, 164, 1, 17);
  const n = d.pets.length;
  const step = 58;
  for (const [i, p] of d.pets.entries()) {
    const x = 252 - ((n - 1) * step) / 2 + i * step - 2;
    if (p.image) ctx.drawImage(await loadImage(p.image), x - 11, 181, 23, 23);
    else {
      ctx.textAlign = 'center';
      ctx.font = font(11, 'OwO Regular');
      ctx.fillText(fit(ctx, p.label, 30), x, 197);
    }
    ctx.textAlign = 'left';
    ctx.font = font(14, 'OwO Regular');
    if (p.level !== null) ctx.fillText(String(p.level), x + 19, 197);
  }

  // about me, and who they're married to
  ctx.textAlign = 'left';
  ctx.font = font(18.5, 'OwO Regular');
  ctx.fillText('About me', 20, 232);
  ctx.font = font(12.5, 'OwO Light');
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  for (const [i, l] of wrap(ctx, d.about, 360, 3).entries()) ctx.fillText(l, 20, 252 + i * 15);
  if (d.partner) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = font(17, 'OwO Light');
    const who = fit(ctx, d.partner, 130);
    ctx.fillText(who, 380, 230);
    // a little ring before the name
    const rx = 380 - ctx.measureText(who).width - 12;
    ctx.strokeStyle = '#e6e6ea';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(rx, 226, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#b27cff';
    ctx.beginPath();
    ctx.moveTo(rx, 216); ctx.lineTo(rx + 3, 219); ctx.lineTo(rx, 222); ctx.lineTo(rx - 3, 219);
    ctx.fill();
  }
  return c.toBuffer('image/png');
}
