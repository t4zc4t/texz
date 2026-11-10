import { GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';

// the Parc Fermé look for the F1 cards: Port Mafia by default, Detective Agency as the light one

const fontDir = fileURLToPath(new URL('../../assets/fonts/', import.meta.url));
GlobalFonts.registerFromPath(`${fontDir}shippori-mincho-b1-latin-800-normal.woff2`, 'PF Serif');
GlobalFonts.registerFromPath(`${fontDir}zen-kaku-gothic-new-latin-300-normal.woff2`, 'PF Light');
GlobalFonts.registerFromPath(`${fontDir}zen-kaku-gothic-new-latin-400-normal.woff2`, 'PF Body');
GlobalFonts.registerFromPath(`${fontDir}zen-kaku-gothic-new-latin-700-normal.woff2`, 'PF Bold');
GlobalFonts.registerFromPath(`${fontDir}jetbrains-mono-latin-400-normal.woff2`, 'PF Mono');
GlobalFonts.registerFromPath(`${fontDir}jetbrains-mono-latin-500-normal.woff2`, 'PF Mono Medium');

export interface Palette {
  name: 'mafia' | 'agency';
  bg: string; panel: string; panel2: string; line: string; grain: string;
  text: string; soft: string; dim: string;
  // red for fills, stripes and rules, and the brighter one that's safe for text
  red: string; redText: string; accent: string; amber: string;
  // retirements get their own red so they never read as the theme red
  out: string;
  // the big number behind a name, there to be felt more than read
  ghost: string;
  moon: [string, string]; halo: string; haloEnd: string;
}

export const mafia: Palette = {
  name: 'mafia',
  bg: '#0B0909', panel: '#141010', panel2: '#1C1716', line: '#342B29', grain: 'rgba(237,230,218,0.028)',
  text: '#EDE6DA', soft: '#B9AD98', dim: '#8F8574',
  red: '#C8283C', redText: '#E8475B', accent: '#C8A97E', amber: '#E0B35A',
  out: '#FF6B6B', ghost: 'rgba(120,20,32,0.45)',
  moon: ['#B3121F', '#4E0910'], halo: 'rgba(179,18,31,0.32)', haloEnd: 'rgba(179,18,31,0)',
};

export const agency: Palette = {
  name: 'agency',
  bg: '#FBF7EF', panel: '#FFFDF8', panel2: '#F1E9DA', line: '#D9CBB3', grain: 'rgba(42,33,27,0.035)',
  text: '#2A211B', soft: '#4F4338', dim: '#6B5D4F',
  red: '#A51C2A', redText: '#A51C2A', accent: '#7A5A2E', amber: '#7A5A2E',
  out: '#B3261E', ghost: 'rgba(165,28,42,0.12)',
  moon: ['#C42A36', '#7A1520'], halo: 'rgba(165,28,42,0.14)', haloEnd: 'rgba(165,28,42,0)',
};

export const paletteOf = (name?: string | null): Palette => (name === 'agency' ? agency : mafia);
// the colour every F1 embed uses, the picture carries the rest of the theme
export const F1_EMBED = 0xC8283C;

export const SERIF = '"PF Serif", serif';
export const BODY = '"PF Body", sans-serif';
export const BOLD = '"PF Bold", sans-serif';
export const LIGHT = '"PF Light", sans-serif';
export const MONO = '"PF Mono", monospace';
export const MONO2 = '"PF Mono Medium", monospace';
export const SITE = 'parc-ferme.pages.dev';

export function fitText(ctx: SKRSContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

// the backdrop every card shares: ink, paper grain, the red bar on top and the blood moon in the corner
export function backdrop(ctx: SKRSContext2D, W: number, H: number, t: Palette, o: { moon?: boolean } = {}) {
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, W, H);
  // thin lines at about 125 degrees, a shade off the background
  ctx.save();
  ctx.strokeStyle = t.grain;
  ctx.lineWidth = 1;
  const slope = Math.tan((35 * Math.PI) / 180);
  for (let x = -H; x < W + H; x += 6) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + H * slope, H); ctx.stroke(); }
  ctx.restore();
  if (o.moon !== false) {
    const cx = W - 105, cy = 62, r = 128;
    const halo = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 2.3);
    halo.addColorStop(0, t.halo);
    halo.addColorStop(1, t.haloEnd);
    ctx.fillStyle = halo;
    ctx.fillRect(cx - r * 2.4, 0, r * 4.8, cy + r * 2.4);
    // lit from the top left
    const disc = ctx.createRadialGradient(cx - r * 0.45, cy - r * 0.45, r * 0.1, cx, cy, r);
    disc.addColorStop(0, t.moon[0]);
    disc.addColorStop(1, t.moon[1]);
    ctx.fillStyle = disc;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = t.red;
  ctx.fillRect(0, 0, W, 6);
}

// "PARC FERMÉ" with the site beside it, top left
export function wordmark(ctx: SKRSContext2D, t: Palette, x = 60, y = 66) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = t.text;
  ctx.font = `26px ${SERIF}`;
  ctx.letterSpacing = '1px';
  ctx.fillText('PARC FERMÉ', x, y);
  const w = ctx.measureText('PARC FERMÉ').width;
  ctx.letterSpacing = '0px';
  ctx.fillStyle = t.dim;
  ctx.font = `17px ${MONO}`;
  ctx.fillText(SITE, x + w + 22, y - 2);
}

// spaced capitals in mono, like "BRITISH · #44 · FERRARI"
export function metaLine(ctx: SKRSContext2D, t: Palette, text: string, x: number, y: number, max = 900) {
  ctx.textAlign = 'left';
  ctx.fillStyle = t.soft;
  ctx.font = `19px ${MONO2}`;
  ctx.letterSpacing = '3px';
  ctx.fillText(fitText(ctx, text.toUpperCase(), max), x, y);
  ctx.letterSpacing = '0px';
}

// the title in the serif with a red rule under it that fades out
export function titleBlock(ctx: SKRSContext2D, t: Palette, title: string, x: number, y: number, max: number, size = 64) {
  ctx.textAlign = 'left';
  ctx.fillStyle = t.text;
  ctx.font = `${size}px ${SERIF}`;
  let s = size;
  while (ctx.measureText(title).width > max && s > 34) { s -= 2; ctx.font = `${s}px ${SERIF}`; }
  ctx.fillText(fitText(ctx, title, max), x, y);
  const rule = ctx.createLinearGradient(x, 0, x + max * 0.8, 0);
  rule.addColorStop(0, t.red);
  rule.addColorStop(1, t.haloEnd);
  ctx.fillStyle = rule;
  ctx.fillRect(x, y + 20, max * 0.8, 3);
}

// a panel: lighter fill, hairline border, red stripe down the left edge
export function panel(ctx: SKRSContext2D, t: Palette, x: number, y: number, w: number, h: number, o: { fill?: string; stripe?: string | null } = {}) {
  ctx.fillStyle = o.fill ?? t.panel;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = t.line;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (o.stripe !== null) {
    ctx.fillStyle = o.stripe ?? t.red;
    ctx.fillRect(x, y, 4, h);
  }
}

// a small team colour dot, the team colours stay accents and never take over
export function dot(ctx: SKRSContext2D, x: number, y: number, color: string, r = 6) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

// WCAG contrast between two colours, for the readability test
export function contrast(a: string, b: string) {
  const lum = (h: string) => {
    const c = [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// retired, didn't start, disqualified
export const isOut = (s?: string | null) => !!s && /\b(dnf|dns|dsq|ret|retired|nc|accident|collision)\b/i.test(s);
