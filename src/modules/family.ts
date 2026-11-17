import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder,
  type ButtonInteraction, type Guild, type Interaction, type MessageActionRowComponentBuilder,
} from 'discord.js';
import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import type { Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import { makeOffer, offerKind } from '../core/challenge.js';
import { polishEmbed } from '../core/icons.js';
import { track } from './missions.js';

// families: marriage, adoption, a tree image and a "how are we related" that knows cousins and in-laws
// every link needs the other person to say yes, and breaking one asks you to confirm first

interface Fam { spouse?: string; since?: number; ring?: string; parents: string[]; children: string[] }
const famOf = (store: Store, g: string, u: string): Fam => ({ parents: [], children: [], ...JSON.parse(store.getKv(`fam:${g}:${u}`) ?? '{}') });
const saveFam = (store: Store, g: string, u: string, f: Fam) => store.setKv(`fam:${g}:${u}`, JSON.stringify(f));

const ROSE = 0xd46a8c;
const fmt = (n: number) => `¥${n.toLocaleString()}`;
const MAX_KIDS = 8;
export const RINGS: Record<string, { name: string; price: number; emoji: string }> = {
  none: { name: 'No ring', price: 0, emoji: '💞' },
  silver: { name: 'Silver ring', price: 1_000, emoji: '💍' },
  gold: { name: 'Gold ring', price: 5_000, emoji: '💍' },
  diamond: { name: 'Diamond ring', price: 25_000, emoji: '💎' },
};
const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);
const card = (title: string, body: string, color = ROSE) => polishEmbed(new EmbedBuilder().setColor(color).setTitle(title).setDescription(body));

// ---------- the graph

const parentsOf = (store: Store, g: string, u: string) => famOf(store, g, u).parents;
const childrenOf = (store: Store, g: string, u: string) => famOf(store, g, u).children;
const siblingsOf = (store: Store, g: string, u: string) => [...new Set(parentsOf(store, g, u).flatMap((p) => childrenOf(store, g, p)))].filter((x) => x !== u);
function ancestors(store: Store, g: string, u: string, depth = 6): Set<string> {
  const out = new Set<string>();
  let level = [u];
  for (let d = 0; d < depth && level.length; d++) { level = level.flatMap((x) => parentsOf(store, g, x)).filter((x) => !out.has(x)); level.forEach((x) => out.add(x)); }
  return out;
}
function descendants(store: Store, g: string, u: string, depth = 6): Set<string> {
  const out = new Set<string>();
  let level = [u];
  for (let d = 0; d < depth && level.length; d++) { level = level.flatMap((x) => childrenOf(store, g, x)).filter((x) => !out.has(x)); level.forEach((x) => out.add(x)); }
  return out;
}
// blood or adoption, three generations either way and their branches: no marrying your cousin in the Agency
function related(store: Store, g: string, a: string, b: string) {
  if (a === b) return true;
  const up = (x: string) => new Set([x, ...ancestors(store, g, x, 3)]);
  const ua = up(a), ub = up(b);
  for (const x of ua) if (ub.has(x)) return true;
  return false;
}
// everyone joined to someone through any link, for the family's size
function clan(store: Store, g: string, u: string, cap = 200) {
  const seen = new Set([u]);
  const queue = [u];
  while (queue.length && seen.size < cap) {
    const x = queue.shift()!;
    const f = famOf(store, g, x);
    for (const y of [...f.parents, ...f.children, ...(f.spouse ? [f.spouse] : [])]) if (!seen.has(y)) { seen.add(y); queue.push(y); }
  }
  return seen;
}

// how b is related to a, in words: "your cousin", "your mother-in-law" style but without genders
export function relation(store: Store, g: string, a: string, b: string): string | null {
  if (a === b) return 'yourself';
  const fa = famOf(store, g, a);
  if (fa.spouse === b) return 'spouse';
  // generations up from each to the closest shared ancestor
  const upFrom = (x: string) => {
    const m = new Map<string, number>([[x, 0]]);
    let level = [x];
    for (let d = 1; d <= 6 && level.length; d++) {
      level = level.flatMap((y) => parentsOf(store, g, y)).filter((y) => !m.has(y));
      level.forEach((y) => m.set(y, d));
    }
    return m;
  };
  const named = (ua: number, ub: number): string | null => {
    const greats = (n: number) => (n > 0 ? `${'great-'.repeat(n)}` : '');
    if (ub === 0 && ua > 0) return ua === 1 ? 'parent' : `${greats(ua - 2)}grandparent`;
    if (ua === 0 && ub > 0) return ub === 1 ? 'child' : `${greats(ub - 2)}grandchild`;
    if (ua === 1 && ub === 1) return 'sibling';
    if (ub === 1) return ua === 2 ? 'aunt or uncle' : `${greats(ua - 3)}grand-aunt or grand-uncle`;
    if (ua === 1) return ub === 2 ? 'niece or nephew' : `${greats(ub - 3)}grand-niece or grand-nephew`;
    const degree = Math.min(ua, ub) - 1;
    const removed = Math.abs(ua - ub);
    const ord = ['', 'first', 'second', 'third', 'fourth', 'fifth'][degree] ?? `${degree}th`;
    return `${ord} cousin${removed ? `, ${removed === 1 ? 'once' : removed === 2 ? 'twice' : `${removed} times`} removed` : ''}`;
  };
  const blood = (x: string, y: string) => {
    const mx = upFrom(x), my = upFrom(y);
    let best: [number, number] | null = null;
    for (const [k, dx] of mx) { const dy = my.get(k); if (dy !== undefined && (!best || dx + dy < best[0] + best[1])) best = [dx, dy]; }
    return best ? named(best[0], best[1]) : null;
  };
  const direct = blood(a, b);
  if (direct) return direct;
  // through a marriage: your spouse's family, or the spouse of someone in yours
  if (fa.spouse) { const r = blood(fa.spouse, b); if (r) return `${r}-in-law`; }
  const fb = famOf(store, g, b);
  if (fb.spouse) { const r = blood(a, fb.spouse); if (r) return r === 'child' ? 'child-in-law' : r === 'sibling' ? 'sibling-in-law' : `${r}'s spouse`; }
  if (clan(store, g, a).has(b)) return 'family, a few branches over';
  return null;
}

// ---------- the actions, each checked again at the moment of saying yes

function canMarry(store: Store, g: string, a: string, b: string): string | null {
  if (a === b) return 'You can\'t marry yourself, Dazai tried.';
  if (famOf(store, g, a).spouse) return 'You\'re already married. `tz divorce` first.';
  if (famOf(store, g, b).spouse) return `<@${b}> is already married.`;
  if (related(store, g, a, b) || descendants(store, g, a).has(b) || ancestors(store, g, a).has(b)) return 'You two are family already. Kunikida says no.';
  return null;
}
function canAdopt(store: Store, g: string, parent: string, child: string): string | null {
  const fp = famOf(store, g, parent), fc = famOf(store, g, child);
  const adopters = [parent, ...(fp.spouse ? [fp.spouse] : [])];
  if (parent === child) return 'You can\'t adopt yourself.';
  if (fp.spouse === child) return 'That\'s your spouse.';
  if (fp.children.includes(child)) return `<@${child}> is already your child.`;
  if (fp.children.length >= MAX_KIDS) return `${MAX_KIDS} children is the limit, the Agency dorms are full.`;
  if (ancestors(store, g, parent).has(child)) return 'They\'re up your family tree, not down it.';
  if (fc.spouse && adopters.includes(fc.spouse)) return 'That\'s a spouse.';
  if (fc.parents.length >= 2) return `<@${child}> already has two parents.`;
  return null;
}
function marry(store: Store, g: string, a: string, b: string, ring: string) {
  const since = Date.now();
  const fa = famOf(store, g, a), fb = famOf(store, g, b);
  saveFam(store, g, a, { ...fa, spouse: b, since, ring });
  saveFam(store, g, b, { ...fb, spouse: a, since, ring });
  return [...shareKids(store, g, a, b), ...shareKids(store, g, b, a)];
}
// a spouse becomes a parent of the other's children too, where a child still has room for one
function shareKids(store: Store, g: string, parent: string, spouse: string): string[] {
  const added: string[] = [];
  for (const kid of famOf(store, g, parent).children) {
    const fk = famOf(store, g, kid);
    if (fk.parents.includes(spouse) || fk.parents.length >= 2 || kid === spouse || ancestors(store, g, spouse).has(kid)) continue;
    fk.parents.push(spouse);
    saveFam(store, g, kid, fk);
    const fs = famOf(store, g, spouse);
    if (!fs.children.includes(kid)) fs.children.push(kid);
    saveFam(store, g, spouse, fs);
    added.push(kid);
  }
  return added;
}
// the parent who asked, and their spouse if there's room, become the child's parents
function adopt(store: Store, g: string, parent: string, child: string) {
  const fp = famOf(store, g, parent), fc = famOf(store, g, child);
  const adopters = [parent, ...(fp.spouse && fc.parents.length === 0 ? [fp.spouse] : [])];
  for (const p of adopters) {
    const f = famOf(store, g, p);
    if (!f.children.includes(child)) f.children.push(child);
    saveFam(store, g, p, f);
    if (!fc.parents.includes(p)) fc.parents.push(p);
  }
  saveFam(store, g, child, fc);
  return adopters;
}
function unlink(store: Store, g: string, parent: string, child: string) {
  const fp = famOf(store, g, parent), fc = famOf(store, g, child);
  fp.children = fp.children.filter((x) => x !== child);
  fc.parents = fc.parents.filter((x) => x !== parent);
  saveFam(store, g, parent, fp);
  saveFam(store, g, child, fc);
}

const confirmRow = (what: string, u: string, arg = '') => row(
  new ButtonBuilder().setCustomId(`fam|${what}|${u}|${arg}`).setLabel('Yes, do it').setStyle(ButtonStyle.Danger),
  new ButtonBuilder().setCustomId(`fam|keep|${u}|`).setLabel('Never mind').setStyle(ButtonStyle.Secondary),
);

// ---------- the family page

const list = (ids: string[], none = 'none') => (ids.length ? ids.map((x) => `<@${x}>`).join(' ') : `-# ${none}`);
export function familyPage(store: Store, g: string, u: string, viewer: string) {
  const f = famOf(store, g, u);
  const sibs = siblingsOf(store, g, u);
  const grand = [...new Set(f.parents.flatMap((p) => parentsOf(store, g, p)))];
  const grandkids = [...new Set(f.children.flatMap((c) => childrenOf(store, g, c)))];
  const size = clan(store, g, u).size;
  const ring = f.ring ? RINGS[f.ring] ?? RINGS.none : RINGS.none;
  const fields = [
    { name: 'Spouse', value: f.spouse ? `${ring.emoji} <@${f.spouse}>\n-# married <t:${Math.floor((f.since ?? Date.now()) / 1000)}:R>${f.ring && f.ring !== 'none' ? ` · ${ring.name.toLowerCase()}` : ''}` : '-# single', inline: true },
    { name: 'Parents', value: list(f.parents), inline: true },
    { name: 'Siblings', value: list(sibs.slice(0, 12)), inline: true },
    { name: `Children · ${f.children.length}/${MAX_KIDS}`, value: list(f.children), inline: false },
  ];
  if (grand.length) fields.push({ name: 'Grandparents', value: list(grand), inline: true });
  if (grandkids.length) fields.push({ name: 'Grandchildren', value: list(grandkids.slice(0, 15)), inline: true });
  const rel = viewer !== u ? relation(store, g, viewer, u) : null;
  const e = card(`👪 ${u === viewer ? 'Your family' : 'Family file'}`,
    `<@${u}>${rel ? ` · your **${rel}**` : ''}\n${size > 1 ? `**${size}** in the family` : 'A family of one, for now. `tz marry @someone` or `tz adopt @someone`.'}`);
  e.addFields(fields);
  const buttons: ButtonBuilder[] = [new ButtonBuilder().setCustomId(`fam|tree|${viewer}|${u}`).setLabel('Family tree').setEmoji('🌳').setStyle(ButtonStyle.Primary)];
  const vf = famOf(store, g, viewer);
  if (viewer !== u && !vf.spouse && !f.spouse && !related(store, g, viewer, u)) buttons.push(new ButtonBuilder().setCustomId(`fam|propose|${viewer}|${u}`).setLabel('Propose').setEmoji('💍').setStyle(ButtonStyle.Secondary));
  if (viewer !== u && !canAdopt(store, g, viewer, u)) buttons.push(new ButtonBuilder().setCustomId(`fam|adoptask|${viewer}|${u}`).setLabel('Adopt').setEmoji('🍼').setStyle(ButtonStyle.Secondary));
  return { embeds: [e], components: [row(...buttons)], files: [] as AttachmentBuilder[] };
}

// ---------- the tree image

interface Node { id: string; gen: number; name: string; avatar: string | null }
export async function treeImage(store: Store, guild: Guild, u: string) {
  const g = guild.id;
  const f = famOf(store, g, u);
  const gens = new Map<string, number>();
  const put = (id: string, gen: number) => { if (!gens.has(id)) gens.set(id, gen); };
  put(u, 0);
  if (f.spouse) put(f.spouse, 0);
  for (const s of siblingsOf(store, g, u).slice(0, 6)) put(s, 0);
  for (const p of f.parents) { put(p, -1); for (const gp of parentsOf(store, g, p)) put(gp, -2); }
  // a parent's spouse sits beside them even when they didn't adopt
  for (const p of f.parents) { const sp = famOf(store, g, p).spouse; if (sp) put(sp, -1); }
  for (const c of f.children) { put(c, 1); for (const gc of childrenOf(store, g, c)) put(gc, 2); }
  for (const c of f.children) { const sp = famOf(store, g, c).spouse; if (sp) put(sp, 1); }
  const ids = [...gens.keys()].slice(0, 36);
  const members = await guild.members.fetch({ user: ids }).catch(() => null);
  const nodes: Node[] = ids.map((id) => {
    const m = members?.get(id);
    return { id, gen: gens.get(id)!, name: m?.displayName ?? 'someone gone', avatar: m?.displayAvatarURL({ extension: 'png', size: 128 }) ?? null };
  });
  const rowsOf = [-2, -1, 0, 1, 2].map((gen) => nodes.filter((n) => n.gen === gen)).filter((r) => r.length);
  // couples sit next to each other in their row
  for (const r of rowsOf) r.sort((a, b) => {
    const key = (n: Node) => { const sp = famOf(store, g, n.id).spouse; return [n.id, sp ?? ''].sort().join(); };
    return key(a).localeCompare(key(b)) || (a.id === u ? -1 : b.id === u ? 1 : 0);
  });
  const R = 46, GAPX = 150, GAPY = 170;
  const W = Math.max(640, Math.max(...rowsOf.map((r) => r.length)) * GAPX + 120);
  const H = rowsOf.length * GAPY + 70;
  const c = createCanvas(W, H);
  const x = c.getContext('2d');
  const bg = x.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1b1420'); bg.addColorStop(1, '#0f0d14');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  x.font = 'bold 26px sans-serif'; x.fillStyle = '#f2d7e1'; x.textAlign = 'center';
  x.fillText(`The ${nodes.find((n) => n.id === u)?.name ?? ''} family`, W / 2, 44);
  const pos = new Map<string, { x: number; y: number }>();
  rowsOf.forEach((r, ri) => r.forEach((n, i) => pos.set(n.id, { x: W / 2 + (i - (r.length - 1) / 2) * GAPX, y: 120 + ri * GAPY })));
  // lines first: parent to child, and a soft link between spouses
  x.lineWidth = 3;
  for (const n of nodes) {
    const p = pos.get(n.id)!;
    // a couple's child hangs from the heart between them, anyone else from their one parent
    const pars = parentsOf(store, g, n.id).filter((q) => pos.has(q));
    const couple = pars.length === 2 && famOf(store, g, pars[0]).spouse === pars[1];
    const from = couple
      ? [{ x: (pos.get(pars[0])!.x + pos.get(pars[1])!.x) / 2, y: pos.get(pars[0])!.y + 10 }]
      : pars.map((q) => ({ x: pos.get(q)!.x, y: pos.get(q)!.y + R + 34 }));
    for (const q of from) {
      x.strokeStyle = 'rgba(242,215,225,0.35)';
      x.beginPath(); x.moveTo(q.x, q.y); x.bezierCurveTo(q.x, q.y + GAPY / 2, p.x, p.y - GAPY / 2, p.x, p.y - R); x.stroke();
    }
    const sp = famOf(store, g, n.id).spouse;
    const q = sp ? pos.get(sp) : null;
    if (q && n.id < sp!) {
      x.strokeStyle = '#d46a8c'; x.setLineDash([6, 6]);
      x.beginPath(); x.moveTo(p.x + R, p.y); x.lineTo(q.x - R, q.y); x.stroke(); x.setLineDash([]);
      heart(x, (p.x + q.x) / 2, p.y - 2, 9);
    }
  }
  // then the people: every avatar is fetched first, then drawn one at a time,
  // each one's round crop has to be undone before the next is drawn
  const faces = await Promise.all(nodes.map((n) => (n.avatar ? fetch(n.avatar).then((r) => r.arrayBuffer()).then((b) => loadImage(Buffer.from(b))).catch(() => null) : Promise.resolve(null))));
  nodes.forEach((n, k) => {
    const p = pos.get(n.id)!;
    const img = faces[k];
    x.save();
    x.beginPath(); x.arc(p.x, p.y, R, 0, Math.PI * 2); x.closePath(); x.clip();
    if (img) x.drawImage(img, p.x - R, p.y - R, R * 2, R * 2);
    else {
      x.fillStyle = '#3a2f44'; x.fillRect(p.x - R, p.y - R, R * 2, R * 2);
      x.fillStyle = '#f2d7e1'; x.font = 'bold 34px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(n.name.slice(0, 1).toUpperCase(), p.x, p.y + 2); x.textBaseline = 'alphabetic';
    }
    x.restore();
    x.lineWidth = n.id === u ? 5 : 3; x.strokeStyle = n.id === u ? '#e8c25a' : '#d46a8c';
    x.beginPath(); x.arc(p.x, p.y, R + 2, 0, Math.PI * 2); x.stroke();
    x.font = `${n.id === u ? 'bold ' : ''}17px sans-serif`; x.fillStyle = '#f5ecf0'; x.textAlign = 'center';
    const label = n.name.length > 14 ? `${n.name.slice(0, 13)}…` : n.name;
    x.fillText(label, p.x, p.y + R + 24);
  });
  if (nodes.length === 1) { x.font = '18px sans-serif'; x.fillStyle = 'rgba(242,215,225,0.6)'; x.fillText('No family yet. Marry or adopt someone to grow the tree.', W / 2, H - 30); }
  return new AttachmentBuilder(c.toBuffer('image/png'), { name: 'family.png' });
}
function heart(x: SKRSContext2D, cx: number, cy: number, s: number) {
  x.fillStyle = '#d46a8c';
  x.beginPath();
  x.moveTo(cx, cy + s * 0.9);
  x.bezierCurveTo(cx - s * 1.4, cy, cx - s * 0.8, cy - s, cx, cy - s * 0.35);
  x.bezierCurveTo(cx + s * 0.8, cy - s, cx + s * 1.4, cy, cx, cy + s * 0.9);
  x.fill();
}
async function treeView(store: Store, guild: Guild, u: string, viewer: string) {
  const file = await treeImage(store, guild, u);
  const e = card('🌳 Family tree', `<@${u}>'s side of the family, up to grandparents and down to grandchildren.`).setImage('attachment://family.png');
  return { embeds: [e], files: [file], components: [row(new ButtonBuilder().setCustomId(`fam|page|${viewer}|${u}`).setLabel('Back to the family').setStyle(ButtonStyle.Secondary))] };
}

// ---------- commands

const proposal = (store: Store, g: string, from: string, to: string, ringKey: string) => {
  const ring = RINGS[ringKey] ?? RINGS.none;
  return makeOffer('marry', from, to, g, `${ring.emoji} <@${from}> is asking <@${to}> to marry them${ring.price ? `, with a **${ring.name.toLowerCase()}** (${fmt(ring.price)})` : ''}.`, { ring: ringKey });
};

const marryCmd: Command = {
  name: 'marry',
  group: 'fun',
  data: new SlashCommandBuilder().setName('marry').setDescription('Propose to someone, they get to say yes or no')
    .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
    .addStringOption((o) => o.setName('ring').setDescription('A ring, paid when they say yes').addChoices(...Object.entries(RINGS).map(([k, r]) => ({ name: `${r.name}${r.price ? ` · ${fmt(r.price)}` : ''}`, value: k })))).toJSON(),
  text: { aliases: ['propose'], args: ['user', 'ring'] },
  example: '@someone gold',
  run: async (ctx, store) => {
    if (!ctx.guildId || !ctx.guild) return ctx.reply('Weddings happen in servers.');
    const to = ctx.user('user');
    if (!to) return ctx.reply({ content: 'Who? `tz marry @someone`, add `silver`, `gold` or `diamond` for a ring.', temp: true });
    const m = await ctx.guild.members.fetch(to).catch(() => null);
    if (!m || m.user.bot) return ctx.reply({ content: 'Bots don\'t marry. Not even Texz.', temp: true });
    const no = canMarry(store, ctx.guildId, ctx.userId, to);
    if (no) return ctx.reply({ content: no, temp: true });
    const ring = (ctx.str('ring') ?? 'none').toLowerCase();
    if (!RINGS[ring]) return ctx.reply({ content: 'Rings: `silver`, `gold` or `diamond`, or none.', temp: true });
    if (store.wallet(ctx.guildId, ctx.userId).yen < RINGS[ring].price) return ctx.reply({ content: `A ${RINGS[ring].name.toLowerCase()} is ${fmt(RINGS[ring].price)}, you're short.`, temp: true });
    return ctx.reply({ ...proposal(store, ctx.guildId, ctx.userId, to, ring), public: true, temp: false });
  },
};

const divorceCmd: Command = {
  name: 'divorce',
  group: 'fun',
  data: new SlashCommandBuilder().setName('divorce').setDescription('End your marriage, you confirm first').toJSON(),
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Marriages are per server.');
    const f = famOf(store, ctx.guildId, ctx.userId);
    if (!f.spouse) return ctx.reply({ content: 'You\'re not married.', temp: true });
    return ctx.reply({ embeds: [card('💔 Divorce', `End your marriage with <@${f.spouse}>? Your children keep both of you as parents.`, 0x8a3b3b)], components: [confirmRow('divorce', ctx.userId)], temp: false });
  },
};

const adoptCmd: Command = {
  name: 'adopt',
  group: 'fun',
  data: new SlashCommandBuilder().setName('adopt').setDescription('Ask someone to join your family as your child')
    .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)).toJSON(),
  text: { args: ['user'] },
  example: '@someone',
  run: async (ctx, store) => {
    if (!ctx.guildId || !ctx.guild) return ctx.reply('Families live in servers.');
    const to = ctx.user('user');
    if (!to) return ctx.reply({ content: 'Who? `tz adopt @someone`', temp: true });
    const m = await ctx.guild.members.fetch(to).catch(() => null);
    if (!m || m.user.bot) return ctx.reply({ content: 'Bots can\'t be adopted, they have no feelings. Allegedly.', temp: true });
    const no = canAdopt(store, ctx.guildId, ctx.userId, to);
    if (no) return ctx.reply({ content: no, temp: true });
    const sp = famOf(store, ctx.guildId, ctx.userId).spouse;
    return ctx.reply({ ...makeOffer('adopt', ctx.userId, to, ctx.guildId, `🍼 <@${ctx.userId}>${sp ? ` and <@${sp}>` : ''} want to adopt <@${to}>.`, {}), public: true, temp: false });
  },
};

const disownCmd: Command = {
  name: 'disown',
  group: 'fun',
  data: new SlashCommandBuilder().setName('disown').setDescription('Remove one of your children, you confirm first')
    .addUserOption((o) => o.setName('user').setDescription('Which child').setRequired(true)).toJSON(),
  text: { args: ['user'] },
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Families live in servers.');
    const kid = ctx.user('user');
    if (!kid || !famOf(store, ctx.guildId, ctx.userId).children.includes(kid)) return ctx.reply({ content: 'That\'s not one of your children.', temp: true });
    return ctx.reply({ embeds: [card('📜 Disown', `Remove <@${kid}> from your children? Their other parent keeps them.`, 0x8a3b3b)], components: [confirmRow('disown', ctx.userId, kid)], temp: false });
  },
};

const runawayCmd: Command = {
  name: 'runaway',
  group: 'fun',
  data: new SlashCommandBuilder().setName('runaway').setDescription('Leave your parents, you confirm first').toJSON(),
  text: { aliases: ['emancipate'] },
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Families live in servers.');
    const f = famOf(store, ctx.guildId, ctx.userId);
    if (!f.parents.length) return ctx.reply({ content: 'You don\'t have parents here to run from.', temp: true });
    return ctx.reply({ embeds: [card('🎒 Run away', `Leave ${f.parents.map((p) => `<@${p}>`).join(' and ')}? You keep your own spouse and children.`, 0x8a3b3b)], components: [confirmRow('runaway', ctx.userId)], temp: false });
  },
};

const familyCmd: Command = {
  name: 'family',
  group: 'fun',
  data: new SlashCommandBuilder().setName('family').setDescription('Your family or someone else\'s: spouse, parents, siblings, children')
    .addUserOption((o) => o.setName('user').setDescription('Whose, yours if empty')).toJSON(),
  text: { aliases: ['fam'], args: ['user'] },
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Families live in servers.');
    return ctx.reply({ ...familyPage(store, ctx.guildId, ctx.user('user') ?? ctx.userId, ctx.userId), public: true });
  },
};

const treeCmd: Command = {
  name: 'tree',
  group: 'fun',
  cooldown: 8,
  data: new SlashCommandBuilder().setName('tree').setDescription('The family tree as a picture')
    .addUserOption((o) => o.setName('user').setDescription('Whose, yours if empty')).toJSON(),
  text: { aliases: ['familytree', 'ft'], args: ['user'] },
  run: async (ctx, store) => {
    if (!ctx.guild) return ctx.reply('Families live in servers.');
    return ctx.reply({ ...(await treeView(store, ctx.guild, ctx.user('user') ?? ctx.userId, ctx.userId)), public: true });
  },
};

const relationCmd: Command = {
  name: 'relation',
  group: 'fun',
  data: new SlashCommandBuilder().setName('relation').setDescription('How two people are related')
    .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
    .addUserOption((o) => o.setName('other').setDescription('Compared to someone else instead of you')).toJSON(),
  text: { aliases: ['related', 'howrelated'], args: ['user', 'other'] },
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Families live in servers.');
    const b = ctx.user('user');
    if (!b) return ctx.reply({ content: 'Who? `tz relation @someone`', temp: true });
    const a = ctx.user('other') ?? ctx.userId;
    const r = relation(store, ctx.guildId, a, b);
    const you = a === ctx.userId;
    return ctx.reply({ embeds: [card('🧬 Relation', r ? `<@${b}> is ${you ? 'your' : `<@${a}>'s`} **${r}**.` : `<@${b}> and ${you ? 'you' : `<@${a}>`} aren't family. Yet.`)], public: true });
  },
};

// ---------- buttons and answers

export function wireFamily(store: Store) {
  // couples married before this rule get their children shared now, once
  for (const { key, value } of store.kvByPrefix('fam:')) {
    const [, g, u] = key.split(':');
    const f = JSON.parse(value) as Fam;
    if (f.spouse) shareKids(store, g, u, f.spouse);
  }
  offerKind('marry', {
    title: '💍 A proposal', color: ROSE, accept: 'Yes, I do', decline: 'No', minutes: 10,
    onDecline: (o) => `💔 <@${o.to}> said no to <@${o.from}>. Kunikida offers a tissue.`,
    onAccept: async (i, o) => {
      const no = canMarry(store, o.guild, o.from, o.to);
      if (no) { await i.update({ content: '', embeds: [card('💍 A proposal', no, 0x8a3b3b)], components: [] }); return; }
      const ringKey = (o.data as { ring: string }).ring;
      const ring = RINGS[ringKey] ?? RINGS.none;
      if (ring.price && !store.pay(o.guild, o.from, -ring.price)) {
        await i.update({ content: '', embeds: [card('💍 A proposal', `<@${o.from}> can't pay for the ring any more, so it's off for now.`, 0x8a3b3b)], components: [] });
        return;
      }
      const kids = marry(store, o.guild, o.from, o.to, ringKey);
      const lines = [...track(store, o.guild, o.from, 'married'), ...track(store, o.guild, o.to, 'married')];
      await i.update({ content: `<@${o.from}> <@${o.to}>`, embeds: [card('💒 Just married', `${ring.emoji} <@${o.from}> and <@${o.to}> are married${ring.price ? `, with a ${ring.name.toLowerCase()}` : ''}! The whole Agency is invited.${kids.length ? `\n${kids.map((k) => `<@${k}>`).join(' ')} now ${kids.length === 1 ? 'has' : 'have'} both of them as parents.` : ''}${lines.length ? `\n\n${lines.join('\n')}` : ''}`)], components: [row(new ButtonBuilder().setCustomId(`fam|tree|${o.from}|${o.from}`).setLabel('Family tree').setEmoji('🌳').setStyle(ButtonStyle.Secondary))], allowedMentions: { users: [o.from, o.to] } });
    },
  });
  offerKind('adopt', {
    title: '🍼 An adoption', color: ROSE, accept: 'Join the family', decline: 'No thanks', minutes: 10,
    onDecline: (o) => `<@${o.to}> would rather stay where they are, <@${o.from}>.`,
    onAccept: async (i, o) => {
      const no = canAdopt(store, o.guild, o.from, o.to);
      if (no) { await i.update({ content: '', embeds: [card('🍼 An adoption', no, 0x8a3b3b)], components: [] }); return; }
      const parents = adopt(store, o.guild, o.from, o.to);
      const lines = track(store, o.guild, o.from, 'adopted');
      await i.update({ content: '', embeds: [card('👪 Welcome to the family', `<@${o.to}> is now the child of ${parents.map((p) => `<@${p}>`).join(' and ')}.${lines.length ? `\n\n${lines.join('\n')}` : ''}`)], components: [row(new ButtonBuilder().setCustomId(`fam|tree|${o.from}|${o.from}`).setLabel('Family tree').setEmoji('🌳').setStyle(ButtonStyle.Secondary))] });
    },
  });
}

export async function onFamily(store: Store, i: Interaction): Promise<boolean> {
  if (!i.isButton() || !i.customId.startsWith('fam|') || !i.guildId || !i.guild) return false;
  const [, what, owner, arg] = i.customId.split('|');
  const g = i.guildId;
  const mine = i.user.id === owner;
  const deny = () => i.reply({ content: 'That button isn\'t yours. Open your own with `tz family`.', flags: MessageFlags.Ephemeral });
  // anyone can look at a tree or a family, it opens for them privately when it isn't their message
  if (what === 'tree' || what === 'page') {
    const out = what === 'tree' ? await treeView(store, i.guild, arg, i.user.id) : familyPage(store, g, arg, i.user.id);
    if (!mine) { await i.reply({ ...out, flags: MessageFlags.Ephemeral }); return true; }
    if (what === 'tree') { await i.deferUpdate(); await i.editReply({ ...out, attachments: [] }); } else await i.update({ ...out, attachments: [] });
    return true;
  }
  if (!mine) { await deny(); return true; }
  if (what === 'keep') { await i.update({ embeds: [card('👪 Family', 'Nothing changed.')], components: [] }); return true; }
  if (what === 'propose' || what === 'adoptask') {
    const no = what === 'propose' ? canMarry(store, g, owner, arg) : canAdopt(store, g, owner, arg);
    if (no) { await i.reply({ content: no, flags: MessageFlags.Ephemeral }); return true; }
    const sp = famOf(store, g, owner).spouse;
    const out = what === 'propose' ? proposal(store, g, owner, arg, 'none') : makeOffer('adopt', owner, arg, g, `🍼 <@${owner}>${sp ? ` and <@${sp}>` : ''} want to adopt <@${arg}>.`, {});
    const { ping, ...msg } = out;
    if (i.channel?.isSendable()) await i.channel.send({ ...msg, allowedMentions: { users: ping } });
    await i.deferUpdate();
    return true;
  }
  if (what === 'divorce') {
    const f = famOf(store, g, owner);
    if (!f.spouse) { await i.update({ embeds: [card('💔 Divorce', 'You\'re not married any more.')], components: [] }); return true; }
    const ex = f.spouse;
    const fx = famOf(store, g, ex);
    saveFam(store, g, owner, { ...f, spouse: undefined, since: undefined, ring: undefined });
    saveFam(store, g, ex, { ...fx, spouse: undefined, since: undefined, ring: undefined });
    await i.update({ embeds: [card('💔 Divorced', `<@${owner}> and <@${ex}> went their separate ways.`, 0x8a3b3b)], components: [] });
    return true;
  }
  if (what === 'disown') {
    unlink(store, g, owner, arg);
    await i.update({ embeds: [card('📜 Disowned', `<@${arg}> is no longer <@${owner}>'s child.`, 0x8a3b3b)], components: [] });
    return true;
  }
  if (what === 'runaway') {
    for (const p of famOf(store, g, owner).parents) unlink(store, g, p, owner);
    await i.update({ embeds: [card('🎒 Ran away', `<@${owner}> packed a bag and left home.`, 0x8a3b3b)], components: [] });
    return true;
  }
  return true;
}

export const family: Module = {
  name: 'family',
  label: 'Family',
  about: 'Marry and adopt with a yes or no from the other side, rings, a family page, a tree picture and how anyone is related',
  commands: [familyCmd, treeCmd, marryCmd, divorceCmd, adoptCmd, disownCmd, runawayCmd, relationCmd],
};

export type { ButtonInteraction };
