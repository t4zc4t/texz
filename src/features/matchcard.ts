import { createCanvas, loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import './rankcard.js';

// crests are fetched once from ESPN and kept on disk, so a busy matchday doesn't hit their servers again and again
const crestDir = fileURLToPath(new URL('../../cache/crests/', import.meta.url));
const crests = new Map<string, Image | null>();

async function crest(url: string | null): Promise<Image | null> {
  if (!url) return null;
  if (crests.has(url)) return crests.get(url)!;
  const file = `${crestDir}${createHash('sha1').update(url).digest('hex').slice(0, 16)}.png`;
  let img: Image | null = null;
  try {
    if (existsSync(file)) img = await loadImage(readFileSync(file));
    else {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        img = await loadImage(buf);
        mkdirSync(crestDir, { recursive: true });
        writeFileSync(file, buf);
      }
    }
  } catch { img = null; }
  crests.set(url, img);
  return img;
}

const INK = '#101218';
const SAND = '#c2a46e';

function fit(ctx: SKRSContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

const hex = (c: string | null | undefined, fallback: string) => (c && /^#?[0-9a-f]{6}$/i.test(c) ? `#${c.replace('#', '')}` : fallback);

// two letters in a circle when a club has no crest
function badge(ctx: SKRSContext2D, x: number, y: number, r: number, color: string, text: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `${Math.round(r * 0.7)}px "Texz Sans Bold"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.slice(0, 3).toUpperCase(), x, y + 2);
}

export interface Side { name: string; short: string; color: string | null; logo: string | null; score?: string; winner?: boolean }
export interface MatchCardData {
  home: Side;
  away: Side;
  league: string;
  // "FT", "Kick-off 20:30" or anything short for the middle
  status: string;
  venue?: string | null;
  goals?: { who: string; clock: string; home: boolean }[];
}

// a matchday card: both crests with VS between them, or the score once it's played
export async function matchCard(d: MatchCardData): Promise<Buffer> {
  const W = 1000;
  const played = d.home.score !== undefined && d.away.score !== undefined;
  const homeGoals = (d.goals ?? []).filter((g) => g.home);
  const awayGoals = (d.goals ?? []).filter((g) => !g.home);
  const lines = Math.min(6, Math.max(homeGoals.length, awayGoals.length));
  const H = 380 + (played && lines ? lines * 30 + 20 : 0);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // each half washed in its club's colour, fading into the dark middle
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  const hc = hex(d.home.color, '#3a3f4b');
  const ac = hex(d.away.color, '#4b3a3a');
  let g = ctx.createLinearGradient(0, 0, W / 2, 0);
  g.addColorStop(0, `${hc}cc`);
  g.addColorStop(1, `${hc}00`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W / 2, H);
  g = ctx.createLinearGradient(W / 2, 0, W, 0);
  g.addColorStop(0, `${ac}00`);
  g.addColorStop(1, `${ac}cc`);
  ctx.fillStyle = g;
  ctx.fillRect(W / 2, 0, W / 2, H);

  // league along the top
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '22px "Texz Sans Bold"';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(d.league.toUpperCase(), W / 2, 44);

  const sides: [Side, number, string][] = [[d.home, 220, hc], [d.away, W - 220, ac]];
  for (const [s, x, color] of sides) {
    const img = await crest(s.logo);
    const size = 170;
    if (img) {
      const scale = Math.min(size / img.width, size / img.height);
      ctx.drawImage(img, x - (img.width * scale) / 2, 70 + (size - img.height * scale) / 2, img.width * scale, img.height * scale);
    } else badge(ctx, x, 70 + size / 2, size / 2.2, color, s.short || s.name);
    ctx.fillStyle = '#ffffff';
    ctx.font = '30px "Texz Sans Bold"';
    ctx.textAlign = 'center';
    ctx.fillText(fit(ctx, s.name, 360), x, 285);
    if (played && s.winner) {
      ctx.fillStyle = SAND;
      ctx.font = '18px "Texz Sans Bold"';
      ctx.fillText('WINNER', x, 315);
    }
  }

  // the middle: VS before, the score after
  ctx.textAlign = 'center';
  if (played) {
    ctx.fillStyle = '#ffffff';
    ctx.font = '110px "Texz Serif"';
    ctx.fillText(`${d.home.score}-${d.away.score}`, W / 2, 205);
  } else {
    ctx.fillStyle = SAND;
    ctx.font = '96px "Texz Serif"';
    ctx.fillText('VS', W / 2, 195);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '24px "Texz Sans Bold"';
  ctx.fillText(d.status, W / 2, played ? 262 : 245);
  if (d.venue) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '19px "Texz Sans"';
    ctx.fillText(fit(ctx, d.venue, 300), W / 2, played ? 292 : 275);
  }

  // who scored, under their own side
  if (played && lines) {
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.moveTo(60, 345);
    ctx.lineTo(W - 60, 345);
    ctx.stroke();
    ctx.font = '22px "Texz Sans"';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    homeGoals.slice(0, 6).forEach((goal, i) => {
      ctx.textAlign = 'left';
      ctx.fillText(fit(ctx, `${goal.clock}  ${goal.who}`, 420), 70, 385 + i * 30);
    });
    awayGoals.slice(0, 6).forEach((goal, i) => {
      ctx.textAlign = 'right';
      ctx.fillText(fit(ctx, `${goal.who}  ${goal.clock}`, 420), W - 70, 385 + i * 30);
    });
  }
  return canvas.toBuffer('image/png');
}

// F1 team colours by any part of the team's name
const f1Colors: [string, string][] = [
  ['red bull', '#3671c6'], ['ferrari', '#e8002d'], ['mercedes', '#27f4d2'], ['mclaren', '#ff8000'], ['aston', '#229971'], ['alpine', '#ff87bc'],
  ['williams', '#64c4ff'], ['haas', '#b6babd'], ['audi', '#bb0a30'], ['sauber', '#52e252'], ['racing bulls', '#6692ff'], ['rb f1', '#6692ff'], ['cadillac', '#c9a227'],
];
export const f1Color = (team: string) => f1Colors.find(([k]) => team.toLowerCase().includes(k))?.[1] ?? '#8a8f99';

export interface F1CardData { title: string; subtitle: string; rows: { pos: string; driver: string; team: string; extra?: string }[] }

// a podium for the top three in team colours, then the next few as a list
export async function f1Card(d: F1CardData): Promise<Buffer> {
  const W = 1000;
  const rest = d.rows.slice(3, 10);
  const H = 470 + (rest.length ? rest.length * 34 + 20 : 0);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  // a red streak along the top, like the timing screens
  ctx.fillStyle = '#e10600';
  ctx.fillRect(0, 0, W, 8);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = '40px "Texz Serif"';
  ctx.fillText(fit(ctx, d.title, W - 80), 40, 66);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '22px "Texz Sans"';
  ctx.fillText(fit(ctx, d.subtitle, W - 80), 40, 100);

  // podium order: second, first, third
  const steps: [number, number, number][] = [[1, 190, 140], [0, 500, 190], [2, 810, 110]];
  const base = 440;
  for (const [i, x, height] of steps) {
    const r = d.rows[i];
    if (!r) continue;
    const color = f1Color(r.team);
    ctx.fillStyle = color;
    ctx.fillRect(x - 130, base - height, 260, height);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x - 130, base - height, 260, 6);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = '64px "Texz Serif"';
    ctx.fillText(r.pos, x, base - height + 72);
    ctx.font = '30px "Texz Sans Bold"';
    ctx.fillText(fit(ctx, r.driver, 300), x, base - height - 44);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '20px "Texz Sans"';
    ctx.fillText(fit(ctx, `${r.team}${r.extra ? ` · ${r.extra}` : ''}`, 300), x, base - height - 16);
  }

  // P4 onwards
  ctx.textAlign = 'left';
  rest.forEach((r, n) => {
    const y = base + 50 + n * 34;
    ctx.fillStyle = f1Color(r.team);
    ctx.fillRect(40, y - 22, 6, 26);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '22px "Texz Sans Bold"';
    ctx.fillText(r.pos.padStart(2, ' '), 60, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(fit(ctx, r.driver, 360), 110, y);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '22px "Texz Sans"';
    ctx.fillText(fit(ctx, r.team, 300), 500, y);
    ctx.textAlign = 'right';
    if (r.extra) ctx.fillText(r.extra, W - 40, y);
    ctx.textAlign = 'left';
  });
  return canvas.toBuffer('image/png');
}

function header(ctx: SKRSContext2D, W: number, title: string, sub: string) {
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, ctx.canvas.height);
  ctx.fillStyle = '#e10600';
  ctx.fillRect(0, 0, W, 8);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = '40px "Texz Serif"';
  ctx.fillText(fit(ctx, title, W - 80), 40, 66);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '22px "Texz Sans"';
  ctx.fillText(fit(ctx, sub, W - 80), 40, 100);
}

export interface StandingsData {
  title: string; subtitle: string;
  drivers: { pos: string; driver: string; team: string; points: number; wins: number }[];
  teams: { pos: string; team: string; points: number }[];
}

// drivers as a timing-screen list with a points bar each, teams as bars on the right
export async function standingsCard(d: StandingsData): Promise<Buffer> {
  const W = 1100;
  const drivers = d.drivers.slice(0, 12);
  const H = 140 + drivers.length * 44 + 30;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  header(ctx, W, d.title, d.subtitle);
  const top = drivers[0]?.points || 1;
  drivers.forEach((r, n) => {
    const y = 150 + n * 44;
    const color = f1Color(r.team);
    // a faint row band every other line
    if (n % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(30, y - 30, 640, 42); }
    ctx.fillStyle = n < 3 ? SAND : 'rgba(255,255,255,0.5)';
    ctx.font = '22px "Texz Sans Bold"';
    ctx.textAlign = 'right';
    ctx.fillText(r.pos, 72, y);
    ctx.fillStyle = color;
    ctx.fillRect(86, y - 24, 6, 30);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = '23px "Texz Sans Bold"';
    ctx.fillText(fit(ctx, r.driver, 250), 104, y);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '18px "Texz Sans"';
    ctx.fillText(fit(ctx, r.team, 110), 365, y);
    // points bar
    const w = Math.max(4, (r.points / top) * 100);
    ctx.fillStyle = `${color}88`;
    ctx.fillRect(485, y - 20, w, 22);
    ctx.fillStyle = '#ffffff';
    ctx.font = '20px "Texz Sans Bold"';
    ctx.fillText(String(r.points), 485 + w + 8, y - 2);
    if (r.wins) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '16px "Texz Sans"';
      ctx.textAlign = 'right';
      ctx.fillText(`${r.wins}W`, 668, y - 2);
      ctx.textAlign = 'left';
    }
  });
  // constructors
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '20px "Texz Sans Bold"';
  ctx.fillText('CONSTRUCTORS', 720, 128);
  const teams = d.teams.slice(0, 10);
  const best = teams[0]?.points || 1;
  teams.forEach((t, n) => {
    const y = 160 + n * 44;
    const color = f1Color(t.team);
    ctx.fillStyle = color;
    ctx.fillRect(720, y - 20, Math.max(6, (t.points / best) * 250), 26);
    // dark letters on the bright team colours
    const v = parseInt(color.slice(1), 16);
    const light = ((v >> 16) * 0.299 + ((v >> 8) & 255) * 0.587 + (v & 255) * 0.114) > 150;
    ctx.fillStyle = light ? INK : '#ffffff';
    ctx.font = '18px "Texz Sans Bold"';
    ctx.fillText(fit(ctx, `${t.pos}  ${t.team}`, 230), 728, y);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    ctx.fillText(String(t.points), W - 30, y);
    ctx.textAlign = 'left';
  });
  return canvas.toBuffer('image/png');
}

export interface WeekData { title: string; subtitle: string; tz: string; sessions: { label: string; start: number; big: boolean }[]; next?: number }

// the weekend's sessions as a schedule board, in the reader's own time zone
export async function weekCard(d: WeekData): Promise<Buffer> {
  const W = 1000;
  const H = 150 + d.sessions.length * 62 + 20;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  header(ctx, W, d.title, d.subtitle);
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: d.tz, weekday: 'short', day: 'numeric', month: 'short' });
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: d.tz, hour: '2-digit', minute: '2-digit' });
  d.sessions.forEach((s, n) => {
    const y = 160 + n * 62;
    const done = s.start < Date.now() - 2 * 3600_000;
    const next = d.next === s.start;
    ctx.fillStyle = next ? 'rgba(225,6,0,0.18)' : s.big ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)';
    ctx.fillRect(30, y - 38, W - 60, 54);
    ctx.fillStyle = s.big ? '#e10600' : 'rgba(255,255,255,0.25)';
    ctx.fillRect(30, y - 38, 6, 54);
    ctx.globalAlpha = done ? 0.4 : 1;
    ctx.fillStyle = '#ffffff';
    ctx.font = `${s.big ? '26px "Texz Sans Bold"' : '24px "Texz Sans"'}`;
    ctx.textAlign = 'left';
    ctx.fillText(s.label, 56, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '22px "Texz Sans"';
    ctx.fillText(day.format(s.start), W - 190, y);
    ctx.fillStyle = '#ffffff';
    ctx.font = '26px "Texz Sans Bold"';
    ctx.fillText(time.format(s.start), W - 56, y);
    ctx.globalAlpha = 1;
    if (next) {
      ctx.fillStyle = '#e10600';
      ctx.font = '16px "Texz Sans Bold"';
      ctx.textAlign = 'right';
      ctx.fillText('NEXT UP', W - 330, y - 2);
    }
  });
  ctx.textAlign = 'left';
  return canvas.toBuffer('image/png');
}

export interface FixtureRow { home: Side; away: Side; league: string; state: 'pre' | 'in' | 'post'; when: number; detail: string }

// a day of football on one board: crests, names, the time or the score
export async function fixturesCard(title: string, rows: FixtureRow[], tz: string): Promise<Buffer> {
  const W = 1000;
  const list = rows.slice(0, 12);
  const H = 130 + list.length * 64 + 20;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#2ecc71';
  ctx.fillRect(0, 0, W, 8);
  ctx.fillStyle = '#ffffff';
  ctx.font = '40px "Texz Serif"';
  ctx.textAlign = 'left';
  ctx.fillText(title, 40, 66);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '20px "Texz Sans"';
  ctx.fillText(`times in ${tz === 'Asia/Kolkata' ? 'IST' : tz}`, 40, 98);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  for (const [n, r] of list.entries()) {
    const y = 140 + n * 64;
    ctx.fillStyle = n % 2 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(30, y, W - 60, 56);
    const mid = W / 2;
    // the middle: kick-off time, LIVE score or full-time score
    ctx.textAlign = 'center';
    if (r.state === 'pre') {
      ctx.fillStyle = '#ffffff';
      ctx.font = '24px "Texz Sans Bold"';
      ctx.fillText(time.format(r.when), mid, y + 36);
    } else {
      ctx.fillStyle = r.state === 'in' ? '#e74c3c' : '#ffffff';
      ctx.font = '28px "Texz Sans Bold"';
      ctx.fillText(`${r.home.score ?? 0} - ${r.away.score ?? 0}`, mid, y + 34);
      ctx.fillStyle = r.state === 'in' ? '#e74c3c' : 'rgba(255,255,255,0.45)';
      ctx.font = '13px "Texz Sans Bold"';
      ctx.fillText(r.state === 'in' ? `LIVE ${r.detail}`.slice(0, 16) : 'FT', mid, y + 51);
    }
    for (const [s, side] of [[r.home, -1], [r.away, 1]] as [Side, number][]) {
      const img = await crest(s.logo);
      const cx = mid + side * 100;
      if (img) ctx.drawImage(img, cx - 20, y + 8, 40, 40);
      else badge(ctx, cx, y + 28, 18, hex(s.color, '#555b66'), s.short || s.name);
      ctx.fillStyle = s.winner ? SAND : '#ffffff';
      ctx.font = '22px "Texz Sans Bold"';
      ctx.textAlign = side < 0 ? 'right' : 'left';
      ctx.fillText(fit(ctx, s.name, 190), cx + side * 34, y + 36);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '14px "Texz Sans"';
    ctx.textAlign = 'left';
    ctx.fillText(fit(ctx, r.league, 120), 44, y + 34);
  }
  return canvas.toBuffer('image/png');
}
