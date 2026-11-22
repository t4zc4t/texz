import { GlobalFonts, createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';

// A stand-in for the OwO profile with a wallpaper behind it, so you can see how one sits before buying it.
// OwO draws its profiles on its own server, so the boxes here follow its layout closely, not pixel for pixel.

const fontDir = fileURLToPath(new URL('../../assets/fonts/', import.meta.url));
GlobalFonts.registerFromPath(`${fontDir}inter-latin-400-normal.woff2`, 'Texz Sans');
GlobalFonts.registerFromPath(`${fontDir}inter-latin-700-normal.woff2`, 'Texz Sans Bold');

const W = 1000;
const H = 600;

export interface WallCard {
  wallpaper: Buffer;
  avatar: Buffer | null;
  name: string;
  title: string;
  wallName: string;
  team: string[];
  lines: [string, string][]; // the little info rows: label, value
}

function box(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r = 14, a = 0.55) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = `rgba(10,10,14,${a})`;
  ctx.fill();
}

function fit(ctx: SKRSContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

export async function wallCard(d: WallCard): Promise<Buffer> {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 24);
  ctx.clip();

  // the wallpaper fills the card the way OwO stretches it, cropped from the middle
  const img = await loadImage(d.wallpaper);
  const s = Math.max(W / img.width, H / img.height);
  ctx.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);

  // left column: avatar, name, title
  box(ctx, 28, 28, 300, 544, 18, 0.5);
  ctx.save();
  ctx.beginPath();
  ctx.arc(178, 150, 92, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (d.avatar) ctx.drawImage(await loadImage(d.avatar), 86, 58, 184, 184);
  else { ctx.fillStyle = '#3a3a44'; ctx.fillRect(86, 58, 184, 184); }
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(178, 150, 94, 0, Math.PI * 2);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 32px "Texz Sans Bold"';
  ctx.fillText(fit(ctx, d.name, 270), 178, 290);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '400 20px "Texz Sans"';
  ctx.fillText(fit(ctx, d.title, 270), 178, 322);

  // level bar
  box(ctx, 52, 350, 252, 16, 8, 0.6);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.roundRect(52, 350, 150, 16, 8);
  ctx.fill();

  // info rows under it
  ctx.textAlign = 'left';
  let y = 410;
  for (const [k, v] of d.lines.slice(0, 4)) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '400 18px "Texz Sans"';
    ctx.fillText(k, 56, y);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 20px "Texz Sans Bold"';
    ctx.fillText(fit(ctx, v, 240), 56, y + 26);
    y += 62;
  }

  // right side: about me and the team, the parts that cover the wallpaper most
  box(ctx, 356, 28, 616, 150, 18, 0.45);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '400 18px "Texz Sans"';
  ctx.fillText('About me', 380, 62);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '400 22px "Texz Sans"';
  ctx.fillText('Your about me sits here.', 380, 100);

  box(ctx, 356, 452, 616, 120, 18, 0.45);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '400 18px "Texz Sans"';
  ctx.fillText('Team', 380, 486);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 22px "Texz Sans Bold"';
  ctx.fillText(fit(ctx, d.team.join('  ·  ') || 'your pets', 570), 380, 530);

  // what's on show, small in the open middle
  ctx.textAlign = 'right';
  ctx.font = '700 18px "Texz Sans Bold"';
  const tag = fit(ctx, `Preview · ${d.wallName}`, 560);
  const tw = ctx.measureText(tag).width;
  box(ctx, 956 - tw - 20, 196, tw + 30, 36, 18, 0.55);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(tag, 958, 220);

  return c.toBuffer('image/png');
}
