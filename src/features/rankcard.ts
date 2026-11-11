import { GlobalFonts, createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import { drawMedal, type Medal } from './medals.js';

// fonts ship with the bot so the card looks the same on Windows and on a bare Linux box
const fontDir = fileURLToPath(new URL('../../assets/fonts/', import.meta.url));
GlobalFonts.registerFromPath(`${fontDir}inter-latin-400-normal.woff2`, 'Texz Sans');
GlobalFonts.registerFromPath(`${fontDir}inter-latin-700-normal.woff2`, 'Texz Sans Bold');
GlobalFonts.registerFromPath(`${fontDir}cinzel-latin-700-normal.woff2`, 'Texz Serif');
GlobalFonts.registerFromPath(`${fontDir}playfair-display-latin-400-italic.woff2`, 'Texz Quote');

const SAND = '#c2a46e';
const SAND_DEFAULT = SAND;
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
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
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
  chips: { label: string; value: string; color?: string }[];
  accent?: string;
  // the medals picked for show, with names, and how many of all of them are earned
  medals?: (Medal & { name: string })[];
  medalCount?: { won: number; total: number };
  // favourite team, club, anime and manga drawn as glowing tiles with their logo or cover
  favs?: Fav[];
}

export interface Fav { label: string; name: string; image?: string | null; color?: string | null; kind: 'badge' | 'crest' | 'cover' }

// pictures from other sites, kept for a while so profile cards don't refetch them every time
const pics = new Map<string, { at: number; img: Awaited<ReturnType<typeof loadImage>> | null }>();
async function picture(url?: string | null) {
  if (!url) return null;
  const hit = pics.get(url);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.img;
  const img = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'Mozilla/5.0 texz' } })
    .then(async (r) => (r.ok ? loadImage(Buffer.from(await r.arrayBuffer())) : null)).catch(() => null);
  pics.set(url, { at: Date.now(), img });
  if (pics.size > 300) pics.delete(pics.keys().next().value!);
  return img;
}

function favTiles(ctx: SKRSContext2D, favs: Fav[], imgs: (Awaited<ReturnType<typeof loadImage>> | null)[], top: number, PW: number, SAND: string) {
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(194,164,110,0.55)';
  ctx.font = '700 13px "Texz Serif", serif';
  ctx.fillText('FAVOURITES', 50, top + 26);
  const gap = 16;
  const n = favs.length;
  const w = (PW - 100 - gap * (n - 1)) / n;
  const h = 118;
  const y = top + 42;
  favs.forEach((f, i) => {
    const x = 50 + i * (w + gap);
    const color = f.color && /^#[0-9a-f]{6}$/i.test(f.color) ? f.color : SAND;
    ctx.save();
    rounded(ctx, x, y, w, h, 18);
    ctx.clip();
    ctx.fillStyle = '#181b22';
    ctx.fillRect(x, y, w, h);
    // the team colour glowing from behind the logo
    const glow = ctx.createRadialGradient(x + 62, y + h / 2, 4, x + 62, y + h / 2, w * 0.9);
    glow.addColorStop(0, `${color}66`);
    glow.addColorStop(1, `${color}00`);
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, w, h);
    // a thin bar of the colour along the bottom
    ctx.fillStyle = color;
    ctx.fillRect(x, y + h - 4, w, 4);
    ctx.restore();
    const img = imgs[i];
    const cx = x + 62;
    const cy = y + h / 2 - 2;
    ctx.save();
    ctx.shadowColor = `${color}cc`;
    ctx.shadowBlur = 22;
    if (f.kind === 'badge') {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(cx, cy, 38, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = color; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(cx, cy, 38, 0, Math.PI * 2); ctx.stroke();
      if (img) { const s = Math.min(54 / img.width, 54 / img.height); ctx.drawImage(img, cx - (img.width * s) / 2, cy - (img.height * s) / 2, img.width * s, img.height * s); }
    } else if (f.kind === 'crest') {
      if (img) { const s = Math.min(84 / img.width, 84 / img.height); ctx.drawImage(img, cx - (img.width * s) / 2, cy - (img.height * s) / 2, img.width * s, img.height * s); }
      else { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx, cy, 34, 0, Math.PI * 2); ctx.fill(); }
    } else {
      // a cover, tilted a touch like a card on a desk
      ctx.translate(cx, cy);
      ctx.rotate(-0.06);
      const cw = 64, ch = 92;
      rounded(ctx, -cw / 2, -ch / 2, cw, ch, 8);
      ctx.fillStyle = color;
      ctx.fill();
      if (img) { ctx.save(); rounded(ctx, -cw / 2, -ch / 2, cw, ch, 8); ctx.clip(); ctx.shadowBlur = 0; const s = Math.max(cw / img.width, ch / img.height); ctx.drawImage(img, -(img.width * s) / 2, -(img.height * s) / 2, img.width * s, img.height * s); ctx.restore(); }
    }
    ctx.restore();
    const tx = x + 118;
    const tw = w - 130;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8b8f9a';
    ctx.font = '400 13px "Texz Sans", sans-serif';
    ctx.fillText(f.label.toUpperCase(), tx, y + 42);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 19px "Texz Sans Bold", sans-serif';
    const lines = wrap(ctx, f.name, tw, 2);
    lines.forEach((l, k) => ctx.fillText(l, tx, y + 68 + k * 23));
  });
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
  const SAND = d.accent ?? SAND_DEFAULT;
  const PW = 1000;
  const favs = (d.favs ?? []).slice(0, 4);
  const FH = favs.length ? 175 : 0;
  const PH = 420 + FH + (d.medalCount ? 190 : 0);
  const favImgs = await Promise.all(favs.map((f) => picture(f.image)));
  const c = createCanvas(PW, PH);
  const ctx = c.getContext('2d');
  rounded(ctx, 0, 0, PW, PH, 28);
  ctx.clip();
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, PW, PH);
  const glow = ctx.createRadialGradient(140, 60, 10, 140, 60, 600);
  glow.addColorStop(0, `${SAND}40`);
  glow.addColorStop(1, `${SAND}00`);
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
    const w = Math.max(vw, lw) + 36 + (chip.color ? 16 : 0);
    if (x + w > PW - 40) break;
    rounded(ctx, x, y, w, 64, 14);
    ctx.fillStyle = '#20232b';
    ctx.fill();
    // a little colour dot for teams, drawn since emoji don't render here
    if (chip.color) { ctx.fillStyle = chip.color; ctx.beginPath(); ctx.arc(x + w - 16, y + 18, 6, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#8b8f9a';
    ctx.fillText(chip.label.toUpperCase(), x + 18, y + 24);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 22px "Texz Sans Bold", sans-serif';
    ctx.fillText(chip.value, x + 18, y + 52);
    x += w + 14;
  }

  if (favs.length) {
    ctx.strokeStyle = 'rgba(194,164,110,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(50, 420); ctx.lineTo(PW - 50, 420); ctx.stroke();
    favTiles(ctx, favs, favImgs, 420, PW, SAND);
  }
  // commendations: the medals someone picked to show, under a thin rule
  if (d.medalCount) {
    ctx.save();
    ctx.translate(0, FH);
    ctx.strokeStyle = 'rgba(194,164,110,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(50, 420); ctx.lineTo(PW - 50, 420); ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(194,164,110,0.55)';
    ctx.font = '700 13px "Texz Serif", serif';
    ctx.fillText('COMMENDATIONS', 50, 446);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#8b8f9a';
    ctx.font = '400 14px "Texz Sans", sans-serif';
    ctx.fillText(`${d.medalCount.won} of ${d.medalCount.total} earned`, PW - 50, 446);
    const shown = d.medals ?? [];
    if (!shown.length) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#6f7380';
      ctx.font = '400 17px "Texz Sans", sans-serif';
      ctx.fillText('No medals yet. tz achievements shows how to earn them.', PW / 2, 530);
    }
    // up to six, spaced evenly and centred so a short rack still looks deliberate
    const step = 150;
    const start = PW / 2 - ((shown.length - 1) * step) / 2;
    shown.forEach((m, n) => {
      const x = start + n * step;
      drawMedal(ctx, m.id, true, x, 460, 30);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e8e2d6';
      ctx.font = '700 14px "Texz Sans Bold", sans-serif';
      let name = m.name;
      while (ctx.measureText(name).width > step - 12 && name.length > 4) name = `${name.slice(0, -2)}…`;
      ctx.fillText(name, x, 590);
    });
    ctx.restore();
  }
  return c.toBuffer('image/png');
}

export interface QuoteData { name: string; avatar: Buffer | null; text: string; at: number; image: Buffer | null; where: string }

// a message turned into a picture: avatar on the left, words on the right, any picture underneath
export async function quoteCard(d: QuoteData): Promise<Buffer> {
  const QW = 1000;
  const probe = createCanvas(10, 10).getContext('2d');
  probe.font = '400 30px "Texz Sans", sans-serif';
  const lines = d.text ? wrap(probe, d.text, QW - 260, 9) : [];
  const img = d.image ? await loadImage(d.image).catch(() => null) : null;
  const imgW = img ? Math.min(QW - 260, img.width) : 0;
  const imgH = img ? Math.min(420, Math.round(img.height * (imgW / img.width))) : 0;
  const QH = Math.max(260, 150 + lines.length * 42 + (img ? imgH + 30 : 0) + 40);
  const c = createCanvas(QW, QH);
  const ctx = c.getContext('2d');
  rounded(ctx, 0, 0, QW, QH, 28);
  ctx.clip();
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, QW, QH);
  ctx.fillStyle = SAND;
  ctx.fillRect(0, 0, 8, QH);
  // a big quote mark in the corner
  ctx.fillStyle = 'rgba(194,164,110,0.12)';
  ctx.font = '700 260px "Texz Serif", serif';
  ctx.fillText('"', QW - 170, 230);
  const av = d.avatar ? await loadImage(d.avatar).catch(() => null) : null;
  ctx.save();
  ctx.beginPath();
  ctx.arc(120, 120, 70, 0, Math.PI * 2);
  ctx.clip();
  if (av) ctx.drawImage(av, 50, 50, 140, 140);
  else { ctx.fillStyle = '#2a2d36'; ctx.fillRect(50, 50, 140, 140); }
  ctx.restore();
  ctx.strokeStyle = SAND;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(120, 120, 73, 0, Math.PI * 2);
  ctx.stroke();
  const left = 230;
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 34px "Texz Sans Bold", sans-serif';
  ctx.fillText(fit(ctx, d.name, QW - left - 60), left, 82);
  ctx.fillStyle = '#8b8f9a';
  ctx.font = '400 18px "Texz Sans", sans-serif';
  ctx.fillText(fit(ctx, `${new Date(d.at).toISOString().slice(0, 16).replace('T', ' ')} UTC · ${d.where}`, QW - left - 60), left, 112);
  ctx.fillStyle = '#e6e1d6';
  ctx.font = '400 30px "Texz Sans", sans-serif';
  lines.forEach((l, i) => ctx.fillText(l, left, 165 + i * 42));
  if (img) {
    const y = 150 + lines.length * 42 + 20;
    ctx.save();
    rounded(ctx, left, y, imgW, imgH, 14);
    ctx.clip();
    ctx.drawImage(img, left, y, imgW, imgH);
    ctx.restore();
  }
  return c.toBuffer('image/png');
}

// the classic one: their face in black and white fading into the dark, the words in italics on the right
export async function classicQuote(d: { name: string; handle: string; text: string; avatar: Buffer | null; at: number }): Promise<Buffer> {
  const W = 1200, H = 630;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const av = d.avatar ? await loadImage(d.avatar).catch(() => null) : null;
  if (av) {
    ctx.drawImage(av, 0, 0, H, H);
    // grey it out
    const px = ctx.getImageData(0, 0, H, H);
    for (let i = 0; i < px.data.length; i += 4) {
      const g = px.data[i] * 0.299 + px.data[i + 1] * 0.587 + px.data[i + 2] * 0.114;
      px.data[i] = px.data[i + 1] = px.data[i + 2] = g;
    }
    ctx.putImageData(px, 0, 0);
    const fade = ctx.createLinearGradient(H * 0.35, 0, H, 0);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, H, H);
  }
  // the words, as big as they can be while still fitting
  const box = { x: 600, w: 540, top: 70, bottom: H - 150 };
  let size = 54, lines: string[] = [];
  for (; size >= 22; size -= 2) {
    ctx.font = `${size}px "Texz Quote", serif`;
    lines = wrap(ctx, d.text, box.w, 40);
    if (lines.length * size * 1.3 <= box.bottom - box.top) break;
  }
  const lh = size * 1.3;
  let y = box.top + (box.bottom - box.top - lines.length * lh) / 2 + size;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  for (const l of lines) { ctx.fillText(l, box.x + box.w / 2, y); y += lh; }
  ctx.font = '30px "Texz Quote", serif';
  ctx.fillText(`- ${d.name}`, box.x + box.w / 2, H - 100);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '20px "Texz Sans", sans-serif';
  ctx.fillText(`@${d.handle}`, box.x + box.w / 2, H - 68);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.font = '14px "Texz Sans", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('Texz', W - 20, H - 16);
  return c.toBuffer('image/png');
}

// a birthday card: their face in a gold ring, confetti, and the day written big
export async function birthdayCard(d: { name: string; avatar: Buffer | null; server: string; age?: number | null }): Promise<Buffer> {
  const W = 1100, H = 520;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#16131c');
  bg.addColorStop(1, '#2a1d14');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // confetti, the same pattern for the same name so it doesn't look random every time
  let seed = 0;
  for (const ch of d.name) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const colours = ['#c2a46e', '#e8c87a', '#c0272f', '#e8e2d6', '#8fb3c9'];
  for (let n = 0; n < 90; n++) {
    ctx.save();
    ctx.translate(rnd() * W, rnd() * H);
    ctx.rotate(rnd() * Math.PI);
    ctx.fillStyle = colours[n % colours.length];
    ctx.globalAlpha = 0.35 + rnd() * 0.5;
    ctx.fillRect(-6, -2, 12 + rnd() * 8, 4);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  const cx = 260, cy = H / 2, r = 150;
  const av = d.avatar ? await loadImage(d.avatar).catch(() => null) : null;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  if (av) ctx.drawImage(av, cx - r, cy - r, r * 2, r * 2);
  else { ctx.fillStyle = '#2b2f3a'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2); }
  ctx.restore();
  ctx.strokeStyle = '#c2a46e';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#c2a46e';
  ctx.font = '700 34px "Texz Serif", serif';
  ctx.fillText('HAPPY BIRTHDAY', 470, 170);
  ctx.fillStyle = '#ffffff';
  let size = 76;
  ctx.font = `700 ${size}px "Texz Sans Bold", sans-serif`;
  while (ctx.measureText(d.name).width > 580 && size > 36) { size -= 4; ctx.font = `700 ${size}px "Texz Sans Bold", sans-serif`; }
  ctx.fillText(d.name, 470, 260);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '34px "Texz Quote", serif';
  ctx.fillText(d.age ? `${d.age} years of being wonderful` : 'from everyone at the Agency', 470, 320);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '22px "Texz Sans", sans-serif';
  ctx.fillText(d.server, 470, 380);
  return c.toBuffer('image/png');
}
