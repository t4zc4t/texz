import { GlobalFonts, createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';

// fonts ship with the bot so the card looks the same on Windows and on a bare Linux box
const fontDir = fileURLToPath(new URL('../../assets/fonts/', import.meta.url));
GlobalFonts.registerFromPath(`${fontDir}inter-latin-400-normal.woff2`, 'Texz Sans');
GlobalFonts.registerFromPath(`${fontDir}inter-latin-700-normal.woff2`, 'Texz Sans Bold');
GlobalFonts.registerFromPath(`${fontDir}cinzel-latin-700-normal.woff2`, 'Texz Serif');

const SAND = '#c2a46e';
const INK = '#14161c';
const W = 1000;
const H = 300;

export interface RankCardData {
  name: string;
  handle: string;
  avatar: Buffer | null;
  level: number;
  rank: string;
  position: number;
  totalXp: number;
  into: number;
  need: number;
  nextRank: string | null;
  boost: number;
}

// cuts long names with an ellipsis so they never run into the stats
function fit(ctx: SKRSContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

const short = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${+(n / 1000).toFixed(1)}K` : n.toLocaleString('en-US'));

function rounded(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export async function rankCard(d: RankCardData): Promise<Buffer> {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');

  // background, a dark desk with a warm lamp in the corner
  rounded(ctx, 0, 0, W, H, 28);
  ctx.clip();
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W - 120, 40, 10, W - 120, 40, 520);
  glow.addColorStop(0, 'rgba(194,164,110,0.28)');
  glow.addColorStop(1, 'rgba(194,164,110,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  // thin diagonal lines, like the pinstripes on a case folder
  ctx.strokeStyle = 'rgba(255,255,255,0.025)';
  ctx.lineWidth = 2;
  for (let x = -H; x < W; x += 22) {
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x + H, 0);
    ctx.stroke();
  }
  ctx.fillStyle = SAND;
  ctx.fillRect(0, 0, 8, H);

  // avatar in a ring
  const ax = 150;
  const ay = H / 2;
  const ar = 92;
  ctx.save();
  ctx.beginPath();
  ctx.arc(ax, ay, ar, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (d.avatar) {
    const img = await loadImage(d.avatar).catch(() => null);
    if (img) ctx.drawImage(img, ax - ar, ay - ar, ar * 2, ar * 2);
  } else {
    ctx.fillStyle = '#2a2d36';
    ctx.fillRect(ax - ar, ay - ar, ar * 2, ar * 2);
    ctx.fillStyle = SAND;
    ctx.font = '700 80px "Texz Sans Bold", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.name.slice(0, 1).toUpperCase(), ax, ay + 4);
  }
  ctx.restore();
  ctx.strokeStyle = SAND;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(ax, ay, ar + 5, 0, Math.PI * 2);
  ctx.stroke();

  const left = 290;
  const right = W - 50;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // rank title over the name
  ctx.fillStyle = SAND;
  ctx.font = '700 22px "Texz Serif", serif';
  ctx.fillText(d.rank.toUpperCase(), left, 72);

  // stats on the right: position and level
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 64px "Texz Sans Bold", sans-serif';
  const lvl = String(d.level);
  ctx.fillText(lvl, right, 138);
  const lvlW = ctx.measureText(lvl).width;
  ctx.fillStyle = '#8b8f9a';
  ctx.font = '400 22px "Texz Sans", sans-serif';
  ctx.fillText('LEVEL', right - lvlW - 12, 138);
  const lvlLabel = ctx.measureText('LEVEL').width;
  ctx.fillStyle = SAND;
  ctx.font = '700 40px "Texz Sans Bold", sans-serif';
  const pos = `#${d.position}`;
  ctx.fillText(pos, right - lvlW - lvlLabel - 40, 138);
  const statsW = lvlW + lvlLabel + 40 + ctx.measureText(pos).width;

  // name, squeezed to fit next to the stats
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 44px "Texz Sans Bold", sans-serif';
  ctx.fillText(fit(ctx, d.name, right - left - statsW - 30), left, 136);
  ctx.fillStyle = '#8b8f9a';
  ctx.font = '400 20px "Texz Sans", sans-serif';
  ctx.fillText(fit(ctx, `@${d.handle}`, right - left - statsW - 30), left, 166);

  // progress bar
  const by = 196;
  const bh = 30;
  const bw = right - left;
  rounded(ctx, left, by, bw, bh, bh / 2);
  ctx.fillStyle = '#262933';
  ctx.fill();
  const pct = d.need ? Math.min(1, d.into / d.need) : 0;
  if (pct > 0) {
    const g = ctx.createLinearGradient(left, 0, left + bw, 0);
    g.addColorStop(0, '#9c8358');
    g.addColorStop(1, '#e3c58f');
    rounded(ctx, left, by, Math.max(bh, bw * pct), bh, bh / 2);
    ctx.fillStyle = g;
    ctx.fill();
  }

  // numbers under the bar
  ctx.font = '400 20px "Texz Sans", sans-serif';
  ctx.fillStyle = '#c9ccd4';
  ctx.fillText(`${short(d.into)} / ${short(d.need)} xp  ·  ${short(d.totalXp)} total`, left, by + bh + 32);
  ctx.textAlign = 'right';
  ctx.fillStyle = d.boost > 1 ? '#f0b85a' : '#8b8f9a';
  ctx.fillText(d.boost > 1 ? `${+d.boost.toFixed(2)}x boost active` : d.nextRank ? `next: ${d.nextRank}` : 'top of the Agency', right, by + bh + 32);

  // a quiet signature in the corner
  ctx.textAlign = 'left';
  ctx.font = '700 13px "Texz Serif", serif';
  ctx.fillStyle = 'rgba(194,164,110,0.45)';
  ctx.fillText('ARMED DETECTIVE AGENCY', left, 36);

  return c.toBuffer('image/png');
}

// avatars come from Discord's CDN, a slow or failed fetch just means the letter fallback
export async function fetchAvatar(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

export interface ProfileData {
  name: string;
  handle: string;
  avatar: Buffer | null;
  title: string;
  bio: string | null;
  // short facts shown as chips, like "Level 12" or "¥4,200"
  chips: { label: string; value: string }[];
}

function wrap(ctx: SKRSContext2D, text: string, max: number, lines: number) {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(next).width > max && cur) {
      out.push(cur);
      cur = word;
      if (out.length === lines) break;
    } else cur = next;
  }
  if (out.length < lines && cur) out.push(cur);
  if (out.length === lines && text.length > out.join(' ').length) out[lines - 1] = fit(ctx, `${out[lines - 1]}…`, max);
  return out;
}

export async function profileCard(d: ProfileData): Promise<Buffer> {
  const PW = 1000;
  const PH = 420;
  const c = createCanvas(PW, PH);
  const ctx = c.getContext('2d');
  rounded(ctx, 0, 0, PW, PH, 28);
  ctx.clip();
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, PW, PH);
  const glow = ctx.createRadialGradient(140, 60, 10, 140, 60, 600);
  glow.addColorStop(0, 'rgba(194,164,110,0.25)');
  glow.addColorStop(1, 'rgba(194,164,110,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, PW, PH);
  ctx.fillStyle = SAND;
  ctx.fillRect(0, 0, PW, 6);

  // avatar
  const ax = 130;
  const ay = 140;
  const ar = 80;
  ctx.save();
  ctx.beginPath();
  ctx.arc(ax, ay, ar, 0, Math.PI * 2);
  ctx.clip();
  const img = d.avatar ? await loadImage(d.avatar).catch(() => null) : null;
  if (img) ctx.drawImage(img, ax - ar, ay - ar, ar * 2, ar * 2);
  else { ctx.fillStyle = '#2a2d36'; ctx.fillRect(ax - ar, ay - ar, ar * 2, ar * 2); }
  ctx.restore();
  ctx.strokeStyle = SAND;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(ax, ay, ar + 4, 0, Math.PI * 2);
  ctx.stroke();

  const left = 250;
  const right = PW - 50;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(194,164,110,0.45)';
  ctx.font = '700 13px "Texz Serif", serif';
  ctx.fillText('AGENCY PERSONNEL FILE', left, 52);
  ctx.fillStyle = SAND;
  ctx.font = '700 22px "Texz Serif", serif';
  ctx.fillText(fit(ctx, d.title.toUpperCase(), right - left), left, 88);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 46px "Texz Sans Bold", sans-serif';
  ctx.fillText(fit(ctx, d.name, right - left), left, 140);
  ctx.fillStyle = '#8b8f9a';
  ctx.font = '400 20px "Texz Sans", sans-serif';
  ctx.fillText(fit(ctx, `@${d.handle}`, right - left), left, 172);

  // bio, up to three lines
  ctx.fillStyle = '#c9ccd4';
  ctx.font = '400 21px "Texz Sans", sans-serif';
  const lines = wrap(ctx, d.bio || 'No bio yet. A person of mystery.', right - left, 3);
  lines.forEach((l, i) => ctx.fillText(l, left, 214 + i * 30));

  // chips along the bottom
  let x = 50;
  const y = 330;
  for (const chip of d.chips.slice(0, 5)) {
    ctx.font = '700 22px "Texz Sans Bold", sans-serif';
    const vw = ctx.measureText(chip.value).width;
    ctx.font = '400 15px "Texz Sans", sans-serif';
    const lw = ctx.measureText(chip.label.toUpperCase()).width;
    const w = Math.max(vw, lw) + 36;
    if (x + w > PW - 40) break;
    rounded(ctx, x, y, w, 64, 14);
    ctx.fillStyle = '#20232b';
    ctx.fill();
    ctx.fillStyle = '#8b8f9a';
    ctx.fillText(chip.label.toUpperCase(), x + 18, y + 24);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 22px "Texz Sans Bold", sans-serif';
    ctx.fillText(chip.value, x + 18, y + 52);
    x += w + 14;
  }
  return c.toBuffer('image/png');
}
