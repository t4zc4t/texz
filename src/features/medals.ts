import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';

// medals for the profile card: a striped ribbon, a struck metal disc and an engraved mark in the middle
export type Tier = 'bronze' | 'silver' | 'gold' | 'relic';
export interface Medal { id: string; earned: boolean }

const metal: Record<Tier, { dark: string; mid: string; light: string; edge: string; ribbon: [string, string] }> = {
  bronze: { dark: '#5e3517', mid: '#b8753a', light: '#f0bf86', edge: '#3d220e', ribbon: ['#7a2f2a', '#d9b26a'] },
  silver: { dark: '#5b6470', mid: '#b9c2cc', light: '#ffffff', edge: '#363c45', ribbon: ['#24395e', '#c9d3df'] },
  gold: { dark: '#7a5208', mid: '#d9a632', light: '#fff0b3', edge: '#4a3105', ribbon: ['#1d4d3a', '#e8c25a'] },
  relic: { dark: '#3a1e66', mid: '#9467e0', light: '#efe4ff', edge: '#22103f', ribbon: ['#14161c', '#b48cff'] },
};

// which metal and mark each badge gets
export const medalOf: Record<string, { tier: Tier; mark: Mark }> = {
  catch1: { tier: 'bronze', mark: 'ball' },
  catch100: { tier: 'silver', mark: 'ball' },
  catch1000: { tier: 'gold', mark: 'ball' },
  legend: { tier: 'relic', mark: 'star' },
  shiny: { tier: 'relic', mark: 'sparkle' },
  types18: { tier: 'gold', mark: 'prism' },
  quiz10: { tier: 'silver', mark: 'question' },
  quiz100: { tier: 'gold', mark: 'cap' },
  guess25: { tier: 'silver', mark: 'lens' },
  fastguess: { tier: 'silver', mark: 'bolt' },
  quote1: { tier: 'bronze', mark: 'quote' },
  quote10: { tier: 'silver', mark: 'scroll' },
  qotw: { tier: 'gold', mark: 'cup' },
  qotw3: { tier: 'relic', mark: 'laurel' },
  podium: { tier: 'relic', mark: 'podium' },
  predict5: { tier: 'silver', mark: 'crystal' },
  daily30: { tier: 'bronze', mark: 'calendar' },
  streak7: { tier: 'bronze', mark: 'flame' },
  streak30: { tier: 'gold', mark: 'flame' },
  rich: { tier: 'gold', mark: 'coins' },
  giver: { tier: 'silver', mark: 'gift' },
  chat500: { tier: 'bronze', mark: 'speech' },
  senior: { tier: 'gold', mark: 'shield' },
  host: { tier: 'bronze', mark: 'popcorn' },
  nightowl: { tier: 'silver', mark: 'moon' },
  earlybird: { tier: 'bronze', mark: 'sun' },
  counter: { tier: 'silver', mark: 'hash' },
  mission7: { tier: 'gold', mark: 'hat' },
  mission30: { tier: 'gold', mark: 'folder' },
};
export const tierOf = (id: string): Tier => medalOf[id]?.tier ?? 'bronze';
export const tierName: Record<Tier, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', relic: 'Relic' };
type Mark = 'ball' | 'star' | 'question' | 'cap' | 'lens' | 'quote' | 'cup' | 'podium' | 'calendar' | 'hat'
  | 'sparkle' | 'prism' | 'bolt' | 'scroll' | 'laurel' | 'crystal' | 'flame' | 'coins' | 'gift' | 'speech' | 'shield' | 'popcorn' | 'moon' | 'sun' | 'folder' | 'hash';

function ribbon(ctx: SKRSContext2D, x: number, top: number, bottom: number, w: number, colors: [string, string], dim: boolean) {
  ctx.save();
  ctx.globalAlpha = dim ? 0.18 : 1;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, top);
  ctx.lineTo(x + w / 2, top);
  ctx.lineTo(x + w / 2, bottom);
  ctx.lineTo(x, bottom - 7);
  ctx.lineTo(x - w / 2, bottom);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = colors[0];
  ctx.fillRect(x - w / 2, top, w, bottom - top);
  // two thin stripes and a wide centre band
  ctx.fillStyle = colors[1];
  ctx.fillRect(x - w * 0.14, top, w * 0.28, bottom - top);
  ctx.fillRect(x - w * 0.42, top, w * 0.07, bottom - top);
  ctx.fillRect(x + w * 0.35, top, w * 0.07, bottom - top);
  // a fold shadow where it meets the bar
  const fold = ctx.createLinearGradient(0, top, 0, top + 8);
  fold.addColorStop(0, 'rgba(0,0,0,0.45)');
  fold.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fold;
  ctx.fillRect(x - w / 2, top, w, 8);
  ctx.restore();
}

function disc(ctx: SKRSContext2D, x: number, y: number, r: number, m: typeof metal[Tier]) {
  // drop shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = m.edge;
  ctx.fill();
  ctx.restore();
  // outer rim, lit from the top left
  const rim = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  rim.addColorStop(0, m.light);
  rim.addColorStop(0.45, m.mid);
  rim.addColorStop(1, m.dark);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = rim;
  ctx.fill();
  // milled edge ticks
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 1;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 24) {
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * (r - 1), y + Math.sin(a) * (r - 1));
    ctx.lineTo(x + Math.cos(a) * (r - 4), y + Math.sin(a) * (r - 4));
    ctx.stroke();
  }
  ctx.restore();
  // sunken face, lit the other way so it reads as recessed
  const face = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  face.addColorStop(0, m.dark);
  face.addColorStop(0.55, m.mid);
  face.addColorStop(1, m.light);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.78, 0, Math.PI * 2);
  ctx.fillStyle = face;
  ctx.fill();
  ctx.strokeStyle = m.edge;
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

// the engraved mark: drawn dark with a light offset underneath, like it's been stamped in
function mark(target: SKRSContext2D, kind: Mark, x: number, y: number, s: number, ink: string) {
  // drawn on its own little canvas first, so cut-outs in the mark don't punch through the medal
  const size = Math.ceil(s * 3);
  const draw = (dx: number, dy: number, color: string) => {
    const layer = createCanvas(size, size);
    const ctx = layer.getContext('2d');
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = s * 0.13;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const k = s;
    switch (kind) {
      case 'ball':
        ctx.beginPath(); ctx.arc(0, 0, k * 0.55, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-k * 0.55, 0); ctx.lineTo(-k * 0.18, 0); ctx.moveTo(k * 0.18, 0); ctx.lineTo(k * 0.55, 0); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, k * 0.17, 0, Math.PI * 2); ctx.stroke();
        break;
      case 'star':
        ctx.beginPath();
        for (let n = 0; n < 10; n++) {
          const a = -Math.PI / 2 + (n * Math.PI) / 5;
          const rr = n % 2 ? k * 0.27 : k * 0.62;
          ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath(); ctx.fill();
        break;
      case 'question':
        ctx.font = `700 ${k * 1.25}px "Texz Serif", serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('?', 0, k * 0.05);
        break;
      case 'cap':
        ctx.beginPath(); ctx.moveTo(-k * 0.65, -k * 0.1); ctx.lineTo(0, -k * 0.42); ctx.lineTo(k * 0.65, -k * 0.1); ctx.lineTo(0, k * 0.2); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-k * 0.35, k * 0.08); ctx.lineTo(-k * 0.35, k * 0.38); ctx.quadraticCurveTo(0, k * 0.58, k * 0.35, k * 0.38); ctx.lineTo(k * 0.35, k * 0.08); ctx.fill();
        ctx.beginPath(); ctx.moveTo(k * 0.55, -k * 0.05); ctx.lineTo(k * 0.55, k * 0.4); ctx.stroke();
        break;
      case 'lens':
        ctx.beginPath(); ctx.arc(-k * 0.1, -k * 0.1, k * 0.36, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = k * 0.2;
        ctx.beginPath(); ctx.moveTo(k * 0.17, k * 0.17); ctx.lineTo(k * 0.52, k * 0.52); ctx.stroke();
        break;
      case 'quote':
        ctx.font = `700 ${k * 1.9}px "Texz Quote", serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('“', 0, k * 0.42);
        break;
      case 'cup':
        ctx.beginPath(); ctx.moveTo(-k * 0.42, -k * 0.5); ctx.lineTo(k * 0.42, -k * 0.5); ctx.quadraticCurveTo(k * 0.42, k * 0.15, 0, k * 0.18); ctx.quadraticCurveTo(-k * 0.42, k * 0.15, -k * 0.42, -k * 0.5); ctx.fill();
        ctx.beginPath(); ctx.arc(-k * 0.45, -k * 0.25, k * 0.17, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke();
        ctx.beginPath(); ctx.arc(k * 0.45, -k * 0.25, k * 0.17, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
        ctx.fillRect(-k * 0.07, k * 0.15, k * 0.14, k * 0.22);
        ctx.fillRect(-k * 0.3, k * 0.36, k * 0.6, k * 0.14);
        break;
      case 'podium':
        ctx.fillRect(-k * 0.2, -k * 0.35, k * 0.4, k * 0.85);
        ctx.fillRect(-k * 0.62, -k * 0.05, k * 0.38, k * 0.55);
        ctx.fillRect(k * 0.24, k * 0.12, k * 0.38, k * 0.38);
        break;
      case 'calendar':
        ctx.lineWidth = k * 0.11;
        ctx.strokeRect(-k * 0.48, -k * 0.38, k * 0.96, k * 0.86);
        ctx.fillRect(-k * 0.48, -k * 0.38, k * 0.96, k * 0.24);
        ctx.font = `700 ${k * 0.5}px "Texz Sans Bold", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('30', 0, k * 0.2);
        break;
      case 'sparkle': {
        // a four point glint with a small one beside it
        const glint = (cx: number, cy: number, r: number) => {
          ctx.beginPath();
          ctx.moveTo(cx, cy - r); ctx.quadraticCurveTo(cx, cy, cx + r, cy); ctx.quadraticCurveTo(cx, cy, cx, cy + r);
          ctx.quadraticCurveTo(cx, cy, cx - r, cy); ctx.quadraticCurveTo(cx, cy, cx, cy - r); ctx.fill();
        };
        glint(-k * 0.08, k * 0.06, k * 0.55); glint(k * 0.42, -k * 0.4, k * 0.22);
        break;
      }
      case 'prism':
        ctx.beginPath(); ctx.moveTo(0, -k * 0.58); ctx.lineTo(k * 0.55, k * 0.42); ctx.lineTo(-k * 0.55, k * 0.42); ctx.closePath(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-k * 0.75, -k * 0.05); ctx.lineTo(-k * 0.2, -k * 0.02); ctx.stroke();
        ctx.lineWidth = k * 0.08;
        for (const dy of [-0.06, 0.06, 0.18]) { ctx.beginPath(); ctx.moveTo(k * 0.18, k * dy); ctx.lineTo(k * 0.75, k * (dy * 2.4 + 0.05)); ctx.stroke(); }
        break;
      case 'bolt':
        ctx.beginPath(); ctx.moveTo(k * 0.12, -k * 0.62); ctx.lineTo(-k * 0.38, k * 0.08); ctx.lineTo(-k * 0.02, k * 0.08); ctx.lineTo(-k * 0.14, k * 0.62); ctx.lineTo(k * 0.4, -k * 0.1); ctx.lineTo(k * 0.04, -k * 0.1); ctx.closePath(); ctx.fill();
        break;
      case 'scroll':
        ctx.lineWidth = k * 0.1;
        ctx.strokeRect(-k * 0.38, -k * 0.42, k * 0.76, k * 0.84);
        ctx.beginPath(); ctx.arc(-k * 0.38, -k * 0.42, k * 0.1, 0, Math.PI * 2); ctx.arc(k * 0.38, k * 0.42, k * 0.1, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = k * 0.07;
        for (const y of [-0.18, 0, 0.18]) { ctx.beginPath(); ctx.moveTo(-k * 0.22, k * y); ctx.lineTo(k * 0.22, k * y); ctx.stroke(); }
        break;
      case 'laurel':
        ctx.lineWidth = k * 0.08;
        for (const side of [-1, 1]) {
          ctx.beginPath(); ctx.arc(0, -k * 0.02, k * 0.5, side < 0 ? Math.PI * 0.55 : Math.PI * 0.45, side < 0 ? Math.PI * 1.25 : -Math.PI * 0.25, side > 0); ctx.stroke();
          for (let n = 0; n < 4; n++) {
            const a = (side < 0 ? Math.PI * 0.62 : Math.PI * 0.38) + side * -n * 0.42;
            const x = Math.cos(a) * k * 0.5, y = Math.sin(a) * k * 0.5 - k * 0.02;
            ctx.beginPath(); ctx.ellipse(x, y, k * 0.15, k * 0.07, a + Math.PI / 2 * side, 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.font = `700 ${k * 0.5}px "Texz Serif", serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('3', 0, k * 0.02);
        break;
      case 'crystal':
        ctx.beginPath(); ctx.arc(0, -k * 0.1, k * 0.4, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-k * 0.42, k * 0.52); ctx.lineTo(-k * 0.28, k * 0.28); ctx.lineTo(k * 0.28, k * 0.28); ctx.lineTo(k * 0.42, k * 0.52); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.arc(-k * 0.12, -k * 0.22, k * 0.08, 0, Math.PI * 2); ctx.fill();
        break;
      case 'flame':
        ctx.beginPath(); ctx.moveTo(0, -k * 0.62);
        ctx.bezierCurveTo(k * 0.18, -k * 0.3, k * 0.5, -k * 0.1, k * 0.42, k * 0.22);
        ctx.bezierCurveTo(k * 0.36, k * 0.52, k * 0.12, k * 0.6, 0, k * 0.6);
        ctx.bezierCurveTo(-k * 0.3, k * 0.6, -k * 0.48, k * 0.38, -k * 0.42, k * 0.12);
        ctx.bezierCurveTo(-k * 0.38, -k * 0.08, -k * 0.2, -k * 0.16, -k * 0.16, -k * 0.34);
        ctx.bezierCurveTo(-k * 0.04, -k * 0.2, 0, -k * 0.38, 0, -k * 0.62); ctx.fill();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath(); ctx.ellipse(0, k * 0.32, k * 0.13, k * 0.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        break;
      case 'coins':
        for (const [x, y] of [[-k * 0.2, k * 0.28], [-k * 0.2, k * 0.08], [-k * 0.2, -k * 0.12]] as const) { ctx.beginPath(); ctx.ellipse(x, y, k * 0.3, k * 0.11, 0, 0, Math.PI * 2); ctx.fill(); }
        ctx.beginPath(); ctx.arc(k * 0.26, -k * 0.12, k * 0.3, 0, Math.PI * 2); ctx.stroke();
        ctx.font = `700 ${k * 0.42}px "Texz Sans Bold", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('¥', k * 0.26, -k * 0.1);
        break;
      case 'gift':
        ctx.fillRect(-k * 0.45, -k * 0.12, k * 0.9, k * 0.62);
        ctx.fillRect(-k * 0.52, -k * 0.3, k * 1.04, k * 0.16);
        ctx.lineWidth = k * 0.1;
        ctx.beginPath(); ctx.ellipse(-k * 0.16, -k * 0.42, k * 0.16, k * 0.1, 0.4, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(k * 0.16, -k * 0.42, k * 0.16, k * 0.1, -0.4, 0, Math.PI * 2); ctx.stroke();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillRect(-k * 0.06, -k * 0.3, k * 0.12, k * 0.8);
        ctx.globalCompositeOperation = 'source-over';
        break;
      case 'speech':
        ctx.beginPath(); ctx.ellipse(0, -k * 0.08, k * 0.6, k * 0.42, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-k * 0.3, k * 0.2); ctx.lineTo(-k * 0.42, k * 0.58); ctx.lineTo(-k * 0.02, k * 0.28); ctx.fill();
        ctx.globalCompositeOperation = 'destination-out';
        for (const x of [-0.25, 0, 0.25]) { ctx.beginPath(); ctx.arc(k * x, -k * 0.08, k * 0.07, 0, Math.PI * 2); ctx.fill(); }
        ctx.globalCompositeOperation = 'source-over';
        break;
      case 'shield':
        ctx.beginPath(); ctx.moveTo(0, -k * 0.6); ctx.lineTo(k * 0.5, -k * 0.4); ctx.lineTo(k * 0.44, k * 0.12);
        ctx.quadraticCurveTo(k * 0.3, k * 0.48, 0, k * 0.62); ctx.quadraticCurveTo(-k * 0.3, k * 0.48, -k * 0.44, k * 0.12); ctx.lineTo(-k * 0.5, -k * 0.4); ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.font = `700 ${k * 0.55}px "Texz Serif", serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('XX', 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        break;
      case 'popcorn':
        ctx.beginPath(); ctx.moveTo(-k * 0.42, -k * 0.1); ctx.lineTo(k * 0.42, -k * 0.1); ctx.lineTo(k * 0.3, k * 0.6); ctx.lineTo(-k * 0.3, k * 0.6); ctx.closePath(); ctx.fill();
        for (const [x, y, r] of [[-0.28, -0.24, 0.17], [0, -0.36, 0.19], [0.28, -0.24, 0.17], [-0.14, -0.5, 0.13], [0.16, -0.52, 0.13]] as const) { ctx.beginPath(); ctx.arc(k * x, k * y, k * r, 0, Math.PI * 2); ctx.fill(); }
        ctx.globalCompositeOperation = 'destination-out';
        for (const x of [-0.14, 0.14]) ctx.fillRect(k * (x - 0.04), 0, k * 0.08, k * 0.58);
        ctx.globalCompositeOperation = 'source-over';
        break;
      case 'moon':
        ctx.beginPath(); ctx.arc(-k * 0.05, 0, k * 0.52, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath(); ctx.arc(k * 0.22, -k * 0.16, k * 0.44, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.beginPath(); ctx.arc(k * 0.42, k * 0.3, k * 0.06, 0, Math.PI * 2); ctx.arc(k * 0.28, k * 0.5, k * 0.04, 0, Math.PI * 2); ctx.fill();
        break;
      case 'sun':
        ctx.beginPath(); ctx.arc(0, k * 0.22, k * 0.32, Math.PI, 0); ctx.closePath(); ctx.fill();
        ctx.lineWidth = k * 0.09;
        for (let n = 0; n < 7; n++) {
          const a = Math.PI + (n * Math.PI) / 6;
          ctx.beginPath(); ctx.moveTo(Math.cos(a) * k * 0.44, k * 0.22 + Math.sin(a) * k * 0.44); ctx.lineTo(Math.cos(a) * k * 0.62, k * 0.22 + Math.sin(a) * k * 0.62); ctx.stroke();
        }
        ctx.fillRect(-k * 0.65, k * 0.3, k * 1.3, k * 0.09);
        ctx.fillRect(-k * 0.4, k * 0.46, k * 0.8, k * 0.08);
        break;
      case 'folder':
        ctx.beginPath(); ctx.moveTo(-k * 0.55, -k * 0.38); ctx.lineTo(-k * 0.15, -k * 0.38); ctx.lineTo(-k * 0.04, -k * 0.26); ctx.lineTo(k * 0.55, -k * 0.26);
        ctx.lineTo(k * 0.55, k * 0.45); ctx.lineTo(-k * 0.55, k * 0.45); ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = k * 0.1; ctx.beginPath(); ctx.moveTo(-k * 0.2, k * 0.1); ctx.lineTo(-k * 0.02, k * 0.26); ctx.lineTo(k * 0.26, -k * 0.06); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        break;
      case 'hash':
        ctx.lineWidth = k * 0.13;
        for (const d of [-0.2, 0.2]) {
          ctx.beginPath(); ctx.moveTo(k * (d + 0.08), -k * 0.55); ctx.lineTo(k * (d - 0.08), k * 0.55); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(-k * 0.52, k * d); ctx.lineTo(k * 0.52, k * d); ctx.stroke();
        }
        break;
      case 'hat':
        ctx.beginPath(); ctx.ellipse(0, k * 0.22, k * 0.68, k * 0.17, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-k * 0.38, k * 0.18); ctx.lineTo(-k * 0.32, -k * 0.32); ctx.quadraticCurveTo(0, -k * 0.5, k * 0.32, -k * 0.32); ctx.lineTo(k * 0.38, k * 0.18); ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillRect(-k * 0.37, k * 0.02, k * 0.74, k * 0.08);
        ctx.globalCompositeOperation = 'source-over';
        break;
    }
    ctx.restore();
    target.drawImage(layer, x + dx - size / 2, y + dy - size / 2);
  };
  draw(0.8, 1, 'rgba(255,255,255,0.35)');
  draw(0, 0, ink);
}

// one medal hanging from its ribbon, the bar at top and the disc centred at y
export function drawMedal(ctx: SKRSContext2D, id: string, earned: boolean, x: number, top: number, r: number) {
  const info = medalOf[id] ?? { tier: 'bronze' as Tier, mark: 'star' as Mark };
  const m = metal[info.tier];
  const y = top + r * 1.55 + r;
  ribbon(ctx, x, top, top + r * 1.75, r * 1.25, m.ribbon, !earned);
  if (!earned) {
    // a locked slot: an empty socket with the mark ghosted in
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#1b1d24';
    ctx.fill();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.save();
    ctx.globalAlpha = 0.6;
    mark(ctx, info.mark, x, y, r * 0.62, '#2c2f39');
    ctx.restore();
    return;
  }
  disc(ctx, x, y, r, m);
  mark(ctx, info.mark, x, y, r * 0.62, m.edge);
  // a soft shine across the top
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  const shine = ctx.createLinearGradient(x, y - r, x, y);
  shine.addColorStop(0, 'rgba(255,255,255,0.35)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.ellipse(x - r * 0.15, y - r * 0.45, r * 0.75, r * 0.4, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export interface SheetItem { id: string; name: string; earned: boolean; progress: string }

// every medal on one picture: earned ones struck in metal, the rest as empty sockets with how far along you are
export function medalSheet(title: string, items: SheetItem[]): Buffer {
  const cols = 7;
  const cell = 132;
  const rows = Math.ceil(items.length / cols);
  const W = 60 + cols * cell;
  const H = 96 + rows * 150 + 24;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0B0909';
  ctx.fillRect(0, 0, W, H);
  // paper grain, thin diagonal lines a shade lighter than the ink
  ctx.save();
  ctx.strokeStyle = 'rgba(237,230,218,0.025)';
  ctx.lineWidth = 1;
  for (let x = -H; x < W; x += 7) { ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + H * 0.7, 0); ctx.stroke(); }
  ctx.restore();
  ctx.fillStyle = '#C8283C';
  ctx.fillRect(0, 0, W, 6);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#EDE6DA';
  ctx.font = '700 26px "Texz Serif", serif';
  ctx.fillText(title, 30, 52);
  const won = items.filter((x) => x.earned).length;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#B9AD98';
  ctx.font = '400 16px "Texz Sans", sans-serif';
  ctx.fillText(`${won} of ${items.length} earned`, W - 30, 52);
  const rule = ctx.createLinearGradient(30, 0, W - 30, 0);
  rule.addColorStop(0, '#C8283C');
  rule.addColorStop(1, 'rgba(200,40,60,0)');
  ctx.fillStyle = rule;
  ctx.fillRect(30, 66, W - 60, 2);
  items.forEach((it, n) => {
    const cx = 30 + (n % cols) * cell + cell / 2;
    const top = 92 + Math.floor(n / cols) * 150;
    drawMedal(ctx, it.id, it.earned, cx, top, 26);
    ctx.textAlign = 'center';
    ctx.fillStyle = it.earned ? '#EDE6DA' : '#8F8574';
    ctx.font = `${it.earned ? 700 : 400} 13px "${it.earned ? 'Texz Sans Bold' : 'Texz Sans'}", sans-serif`;
    let name = it.name;
    while (ctx.measureText(name).width > cell - 10 && name.length > 4) name = `${name.slice(0, -2)}…`;
    ctx.fillText(name, cx, top + 112);
    ctx.fillStyle = it.earned ? '#C8A97E' : '#8F8574';
    ctx.font = '400 12px "Texz Sans", sans-serif';
    ctx.fillText(it.progress, cx, top + 129);
  });
  return c.toBuffer('image/png');
}
