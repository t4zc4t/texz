import { createCanvas } from '@napi-rs/canvas';
import { BODY, BOLD, MONO, SERIF, backdrop, fitText, metaLine, panel, paletteOf, titleBlock } from './f1theme.js';

// the morning-after card for the prediction desk: each match, how it ended, how many called it, and who did best

export interface VerdictRow { home: string; away: string; score: string; result: 'home' | 'draw' | 'away'; right: number; total: number }
export interface VerdictData { title: string; subtitle: string; rows: VerdictRow[]; top: { name: string; right: number; yen: number }[] }

export async function verdictCard(d: VerdictData, theme?: string | null): Promise<Buffer> {
  const t = paletteOf(theme);
  const W = 1200;
  const rowH = 92;
  const topH = d.top.length ? 70 + d.top.length * 46 : 0;
  const H = 260 + d.rows.length * (rowH + 14) + topH + 40;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  backdrop(ctx, W, H, t);
  ctx.textAlign = 'left';
  ctx.fillStyle = t.text;
  ctx.font = `26px ${SERIF}`;
  ctx.fillText('RANPO\'S DEDUCTIONS', 60, 66);
  metaLine(ctx, t, d.subtitle, 60, 128, W - 400);
  titleBlock(ctx, t, d.title, 60, 200, W - 380, 58);

  let y = 250;
  for (const r of d.rows) {
    panel(ctx, t, 60, y, W - 120, rowH);
    // the winner in red, a draw leaves both plain
    ctx.font = `30px ${BOLD}`;
    ctx.fillStyle = r.result === 'home' ? t.redText : t.text;
    ctx.textAlign = 'right';
    ctx.fillText(fitText(ctx, r.home, 330), 470, y + 56);
    ctx.textAlign = 'center';
    ctx.fillStyle = t.text;
    ctx.font = `36px ${SERIF}`;
    ctx.fillText(r.score, 540, y + 58);
    ctx.textAlign = 'left';
    ctx.font = `30px ${BOLD}`;
    ctx.fillStyle = r.result === 'away' ? t.redText : t.text;
    ctx.fillText(fitText(ctx, r.away, 330), 610, y + 56);
    // how many saw it coming, as a little bar
    const share = r.total ? r.right / r.total : 0;
    const bx = W - 260, bw = 160;
    ctx.fillStyle = t.panel2;
    ctx.fillRect(bx, y + 52, bw, 10);
    ctx.fillStyle = t.red;
    ctx.fillRect(bx, y + 52, Math.round(bw * share), 10);
    ctx.fillStyle = t.soft;
    ctx.font = `17px ${MONO}`;
    ctx.fillText(r.total ? `${r.right}/${r.total} CALLED IT` : 'NO CALLS', bx, y + 40);
    y += rowH + 14;
  }

  if (d.top.length) {
    y += 16;
    ctx.fillStyle = t.text;
    ctx.font = `30px ${SERIF}`;
    ctx.fillText('Sharpest minds', 60, y + 20);
    y += 50;
    d.top.forEach((p, i) => {
      ctx.fillStyle = i === 0 ? t.redText : t.text;
      ctx.font = `26px ${BODY}`;
      ctx.fillText(`${i + 1}. ${fitText(ctx, p.name, 600)}`, 60, y + 20);
      ctx.textAlign = 'right';
      ctx.fillStyle = t.soft;
      ctx.font = `20px ${MONO}`;
      ctx.fillText(`${p.right} RIGHT · +¥${p.yen}`, W - 60, y + 20);
      ctx.textAlign = 'left';
      y += 46;
    });
  }
  return canvas.toBuffer('image/png');
}
