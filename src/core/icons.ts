import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ButtonBuilder, EmbedBuilder, type ActionRowBuilder, type Client } from 'discord.js';
import { report } from '../ops.js';

// Texz's own icons, uploaded once as the app's emojis and used instead of the stock ones.
// Stock emojis at the start of a line are swapped for the matching icon; titles and field names can't show custom
// emojis, so the stock ones there are simply dropped to keep things clean

const dir = fileURLToPath(new URL('../../assets/icons/', import.meta.url));
const ids = new Map<string, string>();

// which stock emoji each icon stands in for
const STANDS_FOR: Record<string, string[]> = {
  yen: ['💴', '💰', '💸'], wallet: ['👛'], vault: ['🏦'], worth: ['💎'], streak: ['🔥'], gift: ['🎁'], wait: ['⏳', '⌛'], clock: ['⏱️', '🕒'],
  yes: ['✅', '✔️'], no: ['❌', '✖️'], crown: ['👑'], trophy: ['🏆'], dice: ['🎲'], coin: ['🪙'], work: ['💼'], fish: ['🎣'],
  beg: ['🥺'], rob: ['🫳'], heist: ['🕶️'], ticket: ['🎟️'], wheel: ['🎡'], people: ['👥'], person: ['👤'], idcard: ['🪪'], voice: ['🎙️'],
  chat: ['💬'], door: ['🚪'], boost: ['🚀'], shield: ['🛡️'], cake: ['🎂'], hall: ['🏛️'], roles: ['🎭'], date: ['📅', '🗓️'],
  notebook: ['📓', '📒'], eye: ['👁️'], lock: ['🔒'], unlock: ['🔓'], star: ['⭐', '🌟'], spark: ['✨'], bell: ['🔔'], info: ['ℹ️'],
  next: ['➡️'], mail: ['📬', '📨', '✉️'], moon: ['💤', '🌙'], zap: ['⚡'], heart: ['❤️', '💝', '💞', '💕', '🩷'], bot: ['🤖'], target: ['🎯'], ban: ['🚫', '⛔'],
  mute: ['🔇'], hangup: ['📵', '📴'], move: ['🚚'], duel: ['⚔️'], scroll: ['📜'], quill: ['🖋️', '✍️'], search: ['🔍', '🔎'],
  award: ['🏅'], gauge: ['📊'], crime: ['🚨', '☠️', '💀'], online: ['📡'],
  tv: ['📺'], detective: ['🕵️'], football: ['⚽'], medal: ['🎖️'], edit: ['📝', '✏️'], flag: ['🏁', '🏴'], list: ['📋'], sweep: ['🧹', '🧽'],
  magic: ['🔮', '🪄'], announce: ['📣', '📢'], palette: ['🎨'], plus: ['➕'], minus: ['➖'], car: ['🏎️'], film: ['🎬'], reel: ['🎞️'],
  flower: ['🌸'], news: ['🗞️'], trash: ['🗑️'], folder: ['🗂️', '📁', '📂'], image: ['🖼️'], puzzle: ['🧩'], pin: ['📍'], chart: ['📈'],
  paw: ['🐾'], cards: ['🃏'], alarm: ['⏰', '⏲️'], shop: ['🛍️', '🛒'], vote: ['🗳️'], archive: ['🗄️', '🗃️'], candle: ['🕯️'], hammer: ['🔨'],
  wrench: ['🔧', '🛠️', '🧰'], hash: ['🔢'], party: ['🎉'], bandage: ['🩹'], pray: ['🙏'], sword: ['🗡️'], again: ['🔁'], refresh: ['🔄'],
  popcorn: ['🍿'], warn: ['⚠️'], keys: ['⌨️'], hmm: ['🤔'], quiet: ['🔕'], loud: ['🔊'], inbox: ['📥'], send: ['📤'], book: ['📚', '📖', '📕'],
  wave: ['👋'], sliders: ['🎛️', '🎚️'], sunrise: ['🌅'], new: ['🆕'], back: ['⬅️'], deal: ['🤝', '🫂', '🤗'], dna: ['🧬'],
  drink: ['🥃', '🍸', '🍶'], home: ['🏠'], receipt: ['🧾'], map: ['🗺️'], link: ['🔗'], boom: ['💥'], brain: ['🧠'], pinned: ['📌'],
  shuffle: ['🔀'], box: ['📦'], game: ['🎮'], globe: ['🌍', '🌎', '🌏'], gear: ['⚙️'], pause: ['⏸️'], stop: ['⏹️'], skip: ['⏭️'],
  prev: ['⏮️'], help: ['❓', '❔'], scale: ['⚖️'], grad: ['🎓'], bookmark: ['🔖'], compass: ['🧭'], hundred: ['💯'], like: ['👍'],
  strong: ['💪'], plane: ['✈️'], snow: ['❄️'], dove: ['🕊️'], slow: ['🐢'], luck: ['🍀'], kick: ['👢'], camera: ['📸'], ghost: ['👻'],
  steps: ['👣'], gold: ['🥇'], silver: ['🥈'], bronze: ['🥉'], green: ['🟢'], red: ['🔴'], yellow: ['🟡'], black: ['⚫'], white: ['⚪'],
  purple: ['🟣'], orange: ['🟠'], blue: ['🔵'], sweet: ['🍬'], glasses: ['👓'], letter: ['💌'], tasks: ['🗒️'],
};
const byStock = new Map<string, string>();
for (const [name, stock] of Object.entries(STANDS_FOR)) for (const s of stock) byStock.set(s, name);

// called once the bot is ready: uploads whatever icons the app doesn't have yet
export async function syncIcons(client: Client) {
  const app = client.application;
  if (!app) return;
  try {
    const have = await app.emojis.fetch();
    for (const e of have.values()) if (e.name?.startsWith('tz_')) ids.set(e.name.slice(3), e.id);
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.png'))) {
      const name = f.slice(0, -4);
      if (ids.has(name)) continue;
      const made = await app.emojis.create({ attachment: readFileSync(`${dir}${f}`), name: `tz_${name}` }).catch((e) => { report('icon upload', e); return null; });
      if (made) ids.set(name, made.id);
    }
    console.log(`icons: ${ids.size}`);
  } catch (e) { report('icons', e); }
}

// an icon by name for text, the stock emoji until the icons are in
export const ic = (name: string) => (ids.has(name) ? `<:tz_${name}:${ids.get(name)}>` : STANDS_FOR[name]?.[0] ?? '');
// the same for buttons and menus
export const icEmoji = (name: string) => (ids.has(name) ? { id: ids.get(name)!, name: `tz_${name}` } : STANDS_FOR[name]?.[0] ?? undefined);

const ANY = /(?:\p{Extended_Pictographic})\uFE0F?/gu;
const iconFor = (e: string) => byStock.get(e.replace(/\uFE0F/g, '')) ?? byStock.get(e);
const LEAD = /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|‍(?:\p{Extended_Pictographic}))*)\s*/u;
const strip = (s: string) => { const m = LEAD.exec(s); return m && s.length > m[0].length ? s.slice(m[0].length) : s; };

// stock emoji leading a line become icons; quotes, small text and bold keep their marks
export function polishText(text: string) {
  if (!ids.size) return text;
  return text.split('\n').map((line) => {
    // emoji that are the content stay: slot reels in a heading, a pay table like 🍒3×
    if (/^#{1,3} /.test(line) || /\d×/.test(line)) return line;
    // headings are left alone, they're usually the content itself, like a row of slot reels
    const m = /^((?:> |-# |\*\*)?)(.*)$/s.exec(line);
    if (!m) return line;
    const lead = LEAD.exec(m[2]);
    const name = lead ? byStock.get(lead[1].replace(/\uFE0F/g, '')) ?? byStock.get(lead[1]) : undefined;
    const rest = name ? `${m[1]}${ic(name)} ${m[2].slice(lead![0].length)}` : line;
    // further along the line too
    return rest.replace(ANY, (e) => { const n = iconFor(e); return n ? ic(n) : e; });
  }).join('\n');
}

export function polishEmbed(e: EmbedBuilder) {
  const d = e.data;
  if (d.title) e.setTitle(strip(d.title));
  if (d.description) e.setDescription(polishText(d.description));
  if (d.fields?.length) e.setFields(d.fields.map((f) => ({ ...f, name: strip(f.name), value: polishText(f.value) })));
  return e;
}

// stock emoji on buttons become icons too
export function polishRows<T extends ActionRowBuilder<never>>(rows: T[]) {
  if (!ids.size) return rows;
  for (const r of rows) {
    for (const c of r.components as unknown[]) {
      if (!(c instanceof ButtonBuilder)) continue;
      const em = (c.data as { emoji?: { id?: string; name?: string } }).emoji;
      const name = em && !em.id && em.name ? byStock.get(em.name.replace(/️/g, '')) ?? byStock.get(em.name) : undefined;
      const swap = name ? icEmoji(name) : undefined;
      if (swap && typeof swap === 'object') c.setEmoji(swap);
    }
  }
  return rows;
}

// every message Texz sends or edits passes through here on its way to Discord, so the clean look holds everywhere,
// including the button handlers that never go through a command reply
type Json = Record<string, unknown>;
const KEEP = /^(sc|rps|bj)\|/;
function polishComponent(c: Json) {
  if (Array.isArray(c.components)) (c.components as Json[]).forEach(polishComponent);
  if (c.type === 2 && c.emoji && !KEEP.test(String(c.custom_id ?? ''))) {
    const em = c.emoji as { id?: string; name?: string };
    const n = !em.id && em.name ? iconFor(em.name) : undefined;
    const swap = n ? icEmoji(n) : undefined;
    if (swap && typeof swap === 'object') c.emoji = swap;
  }
  if (c.type === 3 && Array.isArray(c.options)) {
    for (const o of c.options as Json[]) {
      const em = o.emoji as { id?: string; name?: string } | undefined;
      const n = em && !em.id && em.name ? iconFor(em.name) : undefined;
      const swap = n ? icEmoji(n) : undefined;
      if (swap && typeof swap === 'object') o.emoji = swap;
    }
  }
}
function polishPayload(p: Json) {
  if (typeof p.content === 'string') p.content = polishText(p.content);
  if (Array.isArray(p.embeds)) {
    for (const e of p.embeds as Json[]) {
      if (typeof e.title === 'string') e.title = strip(e.title);
      if (typeof e.description === 'string') e.description = polishText(e.description);
      if (Array.isArray(e.fields)) for (const f of e.fields as Json[]) { f.name = strip(String(f.name)); f.value = polishText(String(f.value)); }
      const foot = e.footer as Json | undefined;
      if (foot && typeof foot.text === 'string') foot.text = strip(foot.text);
    }
  }
  if (Array.isArray(p.components)) (p.components as Json[]).forEach(polishComponent);
}
export function hookRest(client: Client) {
  const rest = client.rest as unknown as { request: (o: Json) => Promise<unknown> };
  const send = rest.request.bind(rest);
  rest.request = (o: Json) => {
    try {
      const route = String(o.fullRoute ?? '');
      if (ids.size && o.body && typeof o.body === 'object' && /\/messages|\/callback|\/webhooks\//.test(route)) {
        const b = o.body as Json;
        polishPayload(b.data && typeof b.data === 'object' ? b.data as Json : b);
      }
      // reactions with a stock emoji use the icon instead
      const r = /^(\/channels\/\d+\/messages\/\d+\/reactions\/)([^/]+)(\/@me)$/.exec(route);
      if (ids.size && r) {
        const n = iconFor(decodeURIComponent(r[2]));
        if (n && ids.has(n)) o.fullRoute = `${r[1]}${encodeURIComponent(`tz_${n}:${ids.get(n)}`)}${r[3]}`;
      }
    } catch { /* a payload it can't read goes out as it is */ }
    return send(o);
  };
}
