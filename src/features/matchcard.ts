import { BODY, BOLD, LIGHT, MONO, MONO2, SERIF, backdrop, dot, fitText, isOut, metaLine, panel, paletteOf, titleBlock, wordmark } from './f1theme.js';
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

// a name split for the cards: the first name small and light, the surname big
const splitName = (n: string) => {
  const parts = n.trim().split(/\s+/);
  return parts.length > 1 ? { first: parts.slice(0, -1).join(' '), last: parts.at(-1)! } : { first: '', last: n };
};

// results in the Parc Fermé look: the top three as stat panels, the rest as rows
export async function f1Card(d: F1CardData, theme?: string | null): Promise<Buffer> {
  const t = paletteOf(theme);
  const W = 1200;
  const rest = d.rows.slice(3, 10);
  const H = 540 + (rest.length ? rest.length * 50 + 20 : 0);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  backdrop(ctx, W, H, t);
  wordmark(ctx, t);
  metaLine(ctx, t, d.subtitle, 60, 128, W - 400);
  titleBlock(ctx, t, d.title, 60, 204, W - 380);

  const gap = 24;
  const pw = (W - 120 - gap * 2) / 3;
  const top = 262;
  const ph = 238;
  d.rows.slice(0, 3).forEach((r, i) => {
    const x = 60 + i * (pw + gap);
    panel(ctx, t, x, top, pw, ph);
    // the finishing number, huge and faint behind the name
    ctx.save();
    ctx.beginPath(); ctx.rect(x, top, pw, ph); ctx.clip();
    ctx.fillStyle = t.ghost;
    ctx.font = `230px ${SERIF}`;
    ctx.textAlign = 'right';
    ctx.fillText(String(i + 1), x + pw + 10, top + ph + 34);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.fillStyle = i === 0 ? t.redText : t.text;
    ctx.font = `56px ${SERIF}`;
    ctx.fillText(`P${i + 1}`, x + 30, top + 72);
    if (r.extra) {
      ctx.textAlign = 'right';
      ctx.fillStyle = isOut(r.extra) ? t.out : t.soft;
      ctx.font = `17px ${MONO}`;
      ctx.fillText(fitText(ctx, r.extra, pw - 140), x + pw - 24, top + 64);
      ctx.textAlign = 'left';
    }
    const n = splitName(r.driver);
    ctx.fillStyle = t.soft;
    ctx.font = `24px ${LIGHT}`;
    ctx.fillText(fitText(ctx, n.first, pw - 60), x + 30, top + 128);
    ctx.fillStyle = t.text;
    ctx.font = `44px ${SERIF}`;
    let size = 44;
    while (ctx.measureText(n.last).width > pw - 60 && size > 28) { size -= 2; ctx.font = `${size}px ${SERIF}`; }
    ctx.fillText(n.last, x + 30, top + 178);
    dot(ctx, x + 36, top + 208, f1Color(r.team));
    ctx.fillStyle = t.soft;
    ctx.font = `16px ${MONO}`;
    ctx.letterSpacing = '1px';
    ctx.fillText(fitText(ctx, r.team.toUpperCase(), pw - 90), x + 52, top + 214);
    ctx.letterSpacing = '0px';
  });

  rest.forEach((r, n) => {
    const y = top + ph + 30 + n * 50;
    panel(ctx, t, 60, y, W - 120, 42, { fill: n % 2 ? t.panel : t.panel2 });
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillStyle = t.dim;
    ctx.font = `18px ${MONO2}`;
    ctx.fillText(`P${r.pos}`, 122, y + 22);
    ctx.textAlign = 'left';
    dot(ctx, 142, y + 21, f1Color(r.team), 5);
    ctx.fillStyle = t.text;
    ctx.font = `21px ${BOLD}`;
    ctx.fillText(fitText(ctx, r.driver, 380), 160, y + 22);
    ctx.fillStyle = t.soft;
    ctx.font = `18px ${BODY}`;
    ctx.fillText(fitText(ctx, r.team, 300), 580, y + 22);
    if (r.extra) {
      ctx.textAlign = 'right';
      ctx.fillStyle = isOut(r.extra) ? t.out : t.soft;
      ctx.font = `18px ${MONO}`;
      ctx.fillText(fitText(ctx, r.extra, 240), W - 84, y + 22);
    }
    ctx.textBaseline = 'alphabetic';
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

// drivers down the left, constructors on the right, points in the serif
export async function standingsCard(d: StandingsData, theme?: string | null): Promise<Buffer> {
  const t = paletteOf(theme);
  const W = 1200;
  const drivers = d.drivers.slice(0, 12);
  const teams = d.teams.slice(0, 11);
  const rowsTop = 300;
  const H = rowsTop + Math.max(drivers.length, teams.length) * 50 + 40;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  backdrop(ctx, W, H, t);
  wordmark(ctx, t);
  metaLine(ctx, t, d.subtitle, 60, 128, W - 400);
  titleBlock(ctx, t, d.title, 60, 204, W - 380);
  const label = (text: string, x: number) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = t.dim;
    ctx.font = `15px ${MONO2}`;
    ctx.letterSpacing = '3px';
    ctx.fillText(text, x, rowsTop - 18);
    ctx.letterSpacing = '0px';
  };
  label('DRIVERS', 60);
  label('CONSTRUCTORS', 760);
  drivers.forEach((r, n) => {
    const y = rowsTop + n * 50;
    panel(ctx, t, 60, y, 670, 42, { fill: n % 2 ? t.panel : t.panel2, stripe: n < 3 ? t.red : t.line });
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillStyle = n === 0 ? t.redText : t.dim;
    ctx.font = `18px ${MONO2}`;
    ctx.fillText(r.pos, 112, y + 22);
    ctx.textAlign = 'left';
    dot(ctx, 132, y + 21, f1Color(r.team), 5);
    ctx.fillStyle = t.text;
    ctx.font = `21px ${BOLD}`;
    ctx.fillText(fitText(ctx, r.driver, 270), 150, y + 22);
    ctx.fillStyle = t.soft;
    ctx.font = `16px ${BODY}`;
    ctx.fillText(fitText(ctx, r.team, 150), 430, y + 22);
    if (r.wins) {
      ctx.fillStyle = t.dim;
      ctx.font = `15px ${MONO}`;
      ctx.fillText(`${r.wins}W`, 594, y + 22);
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = n === 0 ? t.redText : t.text;
    ctx.font = `26px ${SERIF}`;
    ctx.fillText(String(r.points), 712, y + 24);
    ctx.textBaseline = 'alphabetic';
  });
  const best = teams[0]?.points || 1;
  teams.forEach((r, n) => {
    const y = rowsTop + n * 50;
    panel(ctx, t, 760, y, 380, 42, { fill: n % 2 ? t.panel : t.panel2, stripe: n < 3 ? t.red : t.line });
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillStyle = n === 0 ? t.redText : t.dim;
    ctx.font = `18px ${MONO2}`;
    ctx.fillText(r.pos, 806, y + 20);
    ctx.textAlign = 'left';
    ctx.fillStyle = t.text;
    ctx.font = `19px ${BOLD}`;
    ctx.fillText(fitText(ctx, r.team, 200), 822, y + 19);
    // a thin bar in the team's colour under the name, for the gap at a glance
    ctx.fillStyle = f1Color(r.team);
    ctx.fillRect(822, y + 33, Math.max(6, (r.points / best) * 210), 3);
    ctx.textAlign = 'right';
    ctx.fillStyle = n === 0 ? t.redText : t.text;
    ctx.font = `24px ${SERIF}`;
    ctx.fillText(String(r.points), 1122, y + 22);
    ctx.textBaseline = 'alphabetic';
  });
  return canvas.toBuffer('image/png');
}

export interface WeekData { title: string; subtitle: string; tz: string; sessions: { label: string; start: number; big: boolean }[]; next?: number }

// the weekend's sessions as a schedule board, in the reader's own time zone
export async function weekCard(d: WeekData, theme?: string | null): Promise<Buffer> {
  const t = paletteOf(theme);
  const W = 1200;
  const top = 262;
  const H = top + d.sessions.length * 70 + 30;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  backdrop(ctx, W, H, t);
  wordmark(ctx, t);
  metaLine(ctx, t, d.subtitle, 60, 128, W - 400);
  titleBlock(ctx, t, d.title, 60, 204, W - 380);
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: d.tz, weekday: 'short', day: 'numeric', month: 'short' });
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: d.tz, hour: '2-digit', minute: '2-digit' });
  d.sessions.forEach((s, n) => {
    const y = top + n * 70;
    const done = s.start < Date.now() - 2 * 3600_000;
    const next = d.next === s.start;
    ctx.globalAlpha = done ? 0.45 : 1;
    panel(ctx, t, 60, y, W - 120, 58, { fill: next ? t.panel2 : t.panel, stripe: s.big || next ? t.red : t.line });
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = t.text;
    ctx.font = s.big ? `27px ${SERIF}` : `23px ${BODY}`;
    ctx.fillText(s.label, 92, y + 30);
    const labelW = ctx.measureText(s.label).width;
    if (next) {
      ctx.fillStyle = t.redText;
      ctx.font = `15px ${MONO2}`;
      ctx.letterSpacing = '3px';
      ctx.fillText('NEXT UP', 92 + labelW + 24, y + 30);
      ctx.letterSpacing = '0px';
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = t.soft;
    ctx.font = `19px ${MONO}`;
    ctx.fillText(day.format(s.start).toUpperCase(), W - 230, y + 30);
    ctx.fillStyle = s.big ? t.text : t.soft;
    ctx.font = `30px ${SERIF}`;
    ctx.fillText(time.format(s.start), W - 90, y + 32);
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 1;
  });
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
