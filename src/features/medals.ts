import type { SKRSContext2D } from '@napi-rs/canvas';

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
  quiz10: { tier: 'silver', mark: 'question' },
  quiz100: { tier: 'gold', mark: 'cap' },
  guess25: { tier: 'silver', mark: 'lens' },
  quote1: { tier: 'bronze', mark: 'quote' },
  qotw: { tier: 'gold', mark: 'cup' },
  podium: { tier: 'relic', mark: 'podium' },
  daily30: { tier: 'bronze', mark: 'calendar' },
  mission7: { tier: 'gold', mark: 'hat' },
};
type Mark = 'ball' | 'star' | 'question' | 'cap' | 'lens' | 'quote' | 'cup' | 'podium' | 'calendar' | 'hat';

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
function mark(ctx: SKRSContext2D, kind: Mark, x: number, y: number, s: number, ink: string) {
  const draw = (dx: number, dy: number, color: string) => {
    ctx.save();
    ctx.translate(x + dx, y + dy);
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
      case 'hat':
        ctx.beginPath(); ctx.ellipse(0, k * 0.22, k * 0.68, k * 0.17, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-k * 0.38, k * 0.18); ctx.lineTo(-k * 0.32, -k * 0.32); ctx.quadraticCurveTo(0, -k * 0.5, k * 0.32, -k * 0.32); ctx.lineTo(k * 0.38, k * 0.18); ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillRect(-k * 0.37, k * 0.02, k * 0.74, k * 0.08);
        ctx.globalCompositeOperation = 'source-over';
        break;
    }
    ctx.restore();
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
