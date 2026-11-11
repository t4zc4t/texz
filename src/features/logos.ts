import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { Client } from 'discord.js';

// real team logos and club crests as app emoji, so names in text get their badge instead of a coloured dot

const made = new Map<string, string>();
let client: Client | null = null;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// the F1 teams by how their names show up in results, with the slug formula1.com files their logo under
export const F1_TEAMS: [RegExp, string, string][] = [
  [/red bull/i, 'redbullracing', '#3671C6'], [/ferrari/i, 'ferrari', '#E8002D'], [/mercedes/i, 'mercedes', '#27F4D2'],
  [/mclaren/i, 'mclaren', '#FF8000'], [/aston/i, 'astonmartin', '#229971'], [/alpine/i, 'alpine', '#FF87BC'],
  [/williams/i, 'williams', '#64C4FF'], [/haas/i, 'haasf1team', '#B6BABD'], [/audi|sauber|kick/i, 'audi', '#BB0A30'],
  [/\brb\b|racing bulls|visa/i, 'racingbulls', '#6692FF'], [/cadillac/i, 'cadillac', '#C9A227'],
];
const f1Logo = (slug: string) => `https://media.formula1.com/image/upload/c_lfill,w_128/q_auto/v1740000001/common/f1/2026/${slug}/2026${slug}logo.webp`;

const tag = (name: string) => (made.has(name) ? `<:${name}:${made.get(name)}>` : null);

export const teamEmoji = (team: string) => {
  const hit = F1_TEAMS.find(([re]) => re.test(team));
  return hit ? tag(`f1_${hit[1]}`) : null;
};

async function fetchImage(url: string) {
  const res = await fetch(url, { headers: { 'user-agent': UA } }).catch(() => null);
  if (!res?.ok) return null;
  return loadImage(Buffer.from(await res.arrayBuffer())).catch(() => null);
}

// the F1 logos come in team colours, some of them black, so each sits on a white disc with a ring in the team colour
async function teamBadge(slug: string, color: string) {
  const img = await fetchImage(f1Logo(slug));
  if (!img) return null;
  const c = createCanvas(128, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(64, 64, 63, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(64, 64, 57, 0, Math.PI * 2); ctx.fill();
  const scale = Math.min(84 / img.width, 84 / img.height);
  ctx.drawImage(img, 64 - (img.width * scale) / 2, 64 - (img.height * scale) / 2, img.width * scale, img.height * scale);
  return c.toBuffer('image/png');
}

// crests are already cut out, they just get sized down to emoji size
async function crest(url: string) {
  const img = await fetchImage(url);
  if (!img) return null;
  const c = createCanvas(128, 128);
  const ctx = c.getContext('2d');
  const scale = Math.min(124 / img.width, 124 / img.height);
  ctx.drawImage(img, 64 - (img.width * scale) / 2, 64 - (img.height * scale) / 2, img.width * scale, img.height * scale);
  return c.toBuffer('image/png');
}

async function upload(name: string, png: Buffer | null) {
  if (!png || !client?.application) return;
  const e = await client.application.emojis.create({ attachment: png, name }).catch(() => null);
  if (e) made.set(name, e.id);
}

// clubs get made the first time they show up, one at a time so Discord isn't hammered
const queue: { name: string; url: string }[] = [];
let busy = false;
const CLUB_CAP = 1500;
async function drain() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const next = queue.shift()!;
    if (!made.has(next.name)) await upload(next.name, await crest(next.url));
    await new Promise((r) => setTimeout(r, 2500));
  }
  busy = false;
}

export function clubEmoji(t: { id: string; logo: string | null }) {
  const name = `fb_${t.id}`;
  const have = tag(name);
  if (have || !t.logo || !client) return have;
  if ([...made.keys()].filter((k) => k.startsWith('fb_')).length < CLUB_CAP && !queue.some((q) => q.name === name)) {
    queue.push({ name, url: t.logo });
    void drain();
  }
  return null;
}

export async function loadLogos(c: Client) {
  client = c;
  const have = await c.application?.emojis.fetch().catch(() => null);
  if (!have) return;
  for (const e of have.values()) if (e.name && /^(f1|fb)_/.test(e.name)) made.set(e.name, e.id);
  for (const [, slug, color] of F1_TEAMS) if (!made.has(`f1_${slug}`)) await upload(`f1_${slug}`, await teamBadge(slug, color));
  console.log(`team logos: ${F1_TEAMS.filter(([, s]) => made.has(`f1_${s}`)).length}/${F1_TEAMS.length} F1, ${[...made.keys()].filter((k) => k.startsWith('fb_')).length} clubs`);
}

// "<:f1_ferrari:123>" as the {id, name} a button or menu option wants
export function asEmoji(s: string | null | undefined): { id: string; name: string } | string | undefined {
  if (!s) return undefined;
  const m = /^<a?:(\w+):(\d+)>$/.exec(s);
  return m ? { id: m[2], name: m[1] } : s;
}

// the logo picture itself, for drawing on cards
export const f1LogoOf = (team: string) => {
  const hit = F1_TEAMS.find(([re]) => re.test(team));
  return hit ? { url: f1Logo(hit[1]), color: hit[2] } : null;
};
