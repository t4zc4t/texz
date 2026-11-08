import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events, MessageFlags, SlashCommandBuilder, StringSelectMenuBuilder,
  type Client, type Guild, type Interaction, type Message, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import { card } from '../theme.js';
import { picksOf, savePicks } from './profile.js';
import { TYPES, artwork, catchLine, hintOf, idOf, nameIn, rarityOf, solve, typeMark, typesOf } from '../features/pokedex.js';
import { decide, download, fingerprint, knownCount, learn, logSpawn, memorySize, recognise, remember, type Sparse } from '../features/pokeid.js';
import { classify, keepSpawn, seedMemory } from '../features/pokemodel.js';

export const POKETWO_ID = '716390085896962058';
export const SHOOB_ID = '673362753489993749';

// the roles people can opt into: one for Pokétwo, one per Shoob tier
const TIERS = ['1', '2', '3', '4', '5', '6', 'S'] as const;
const tierRole = (t: string) => `Shoob Tier ${t}`;
const tierMark: Record<string, string> = { '1': '⚪', '2': '🟢', '3': '🔵', '4': '🟣', '5': '🟡', '6': '🔴', S: '🌟' };

const row = (...b: (ButtonBuilder | StringSelectMenuBuilder)[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...b);

type Spawn = { kind: 'p2' } | { kind: 'shoob'; tier: string | null };

// what a spawn looks like, read from the embed so normal bot chatter never pings anyone
export function spawnOf(m: { author: { id: string }; embeds: { title?: string | null; description?: string | null; footer?: { text: string } | null }[] }): Spawn | null {
  const e = m.embeds[0];
  if (!e) return null;
  const text = `${e.title ?? ''}\n${e.description ?? ''}\n${e.footer?.text ?? ''}`;
  if (m.author.id === POKETWO_ID && /wild pok[eé]mon has appeared/i.test(text)) return { kind: 'p2' };
  if (m.author.id === SHOOB_ID) {
    const t = /tier\s*:?\s*\**\s*(S|[1-6])\b/i.exec(text);
    if (!t && !/to claim|claim it|has appeared|spawned/i.test(text)) return null;
    return { kind: 'shoob', tier: t ? t[1].toUpperCase() : null };
  }
  return null;
}

// a role by its saved id, then by name, made when asked
async function roleNamed(guild: Guild, store: Store, key: string, name: string, make: boolean) {
  const kv = `spawnrole:${guild.id}:${key}`;
  const known = store.getKv(kv);
  let role = known ? guild.roles.cache.get(known) ?? null : null;
  role ??= guild.roles.cache.find((r) => r.name === name) ?? null;
  if (!role && make) role = await guild.roles.create({ name, mentionable: false, reason: 'Texz spawn pings' }).catch(() => null);
  if (role && role.id !== known) store.setKv(kv, role.id);
  return role;
}
const shoobRole = (guild: Guild, store: Store, t: string, make = false) => roleNamed(guild, store, `t${t}`, tierRole(t), make);

const last = new Map<string, number>();

export function watchSpawns(client: Client, store: Store) {
  void seedMemory((vec, name) => remember(store, vec, name), memorySize(store) === 0);
  client.on(Events.MessageCreate, (m) => void onSpawn(store, m).catch(() => {}));
}

// the spawn waiting in each channel, until someone catches it or the next one comes
type Waiting = {
  id: string; channelId: string; hash: string | null; image: Buffer | null; vec: Sparse | null; at: number;
  guess: { name: string; p: number; how: string } | null; confirmed: string | null; kept?: boolean;
  sent: Message | null; shown: string | null; pinged: boolean; queue?: Promise<void>;
};
const waiting = new Map<string, Waiting>();
const RARE_ROLE = 'Pokétwo Rare Spawns';
const rareRole = (guild: Guild, store: Store, make = false) => roleNamed(guild, store, 'p2rare', RARE_ROLE, make);
const typeRole = (guild: Guild, store: Store, t: string, make = false) => roleNamed(guild, store, `p2type:${t}`, `Pokétwo ${t}`, make);
const rareMark: Record<string, string> = { legendary: '🌟 Legendary', mythical: '💫 Mythical', 'ultra beast': '🌀 Ultra Beast' };

// a variant like "Alolan Vulpix" or "Paldean Tauros" counts as its species for types, rarity and art
const baseOf = (name: string) => nameIn(name) ?? name;

// the full name from another helper bot's reply or Pokétwo's catch line, variant included
export function fullNameFrom(text: string): string | null {
  const first = text.split('\n').map((l) => l.replace(/[*_#>`~|]/g, '').trim()).find(Boolean) ?? '';
  const lead = /^[\p{L}\p{N} .'’:é♀♂()-]+/u.exec(first)?.[0].replace(/\s*\(.*$/, '').trim();
  if (!lead || !nameIn(lead)) return null;
  return lead.split(/\s+/).length > 4 ? nameIn(lead) : lead;
}

function claimText(name: string, roles: string[], guess?: { p: number; others: string[] }) {
  const base = baseOf(name);
  const rare = rarityOf(base);
  const types = typesOf(base);
  const why = [rare && rareMark[rare], ...types].filter(Boolean).join(' · ');
  return [
    roles.length ? `${roles.map((r) => `<@&${r}>`).join(' ')} ${why} spawn, be quick` : null,
    `## ${rare ? '🌟 ' : ''}${name}  ${types.map((t) => typeMark[t] ?? '').join('')}`,
    `${rare ? `**${rareMark[rare]}** · ` : ''}${types.join(' · ')}`,
    `📋 Tap to copy: \`${catchLine(name)}\``,
    guess && guess.p < 0.85 ? `-# ${Math.round(guess.p * 100)}% sure${guess.others.length ? `, could also be ${guess.others.join(' or ')}` : ''}` : null,
  ].filter(Boolean).join('\n');
}

// post the claim card, or fix it when a better name turns up, one at a time so two answers never make two cards
function show(store: Store, m: Message, w: Waiting, name: string, guess?: { p: number; others: string[] }) {
  w.queue = (w.queue ?? Promise.resolve()).then(() => showNow(store, m, w, name, guess)).catch(() => {});
  return w.queue;
}

async function showNow(store: Store, m: Message, w: Waiting, name: string, guess?: { p: number; others: string[] }) {
  if (!m.guild || !store.rules(m.guild.id, 'spawns').enabled) return;
  if (w.shown === name) return;
  const ch = m.client.channels.cache.get(w.channelId);
  if (!ch?.isSendable()) return;
  if (w.sent) {
    // a helper bot or a hint said otherwise, the card gets corrected in place
    w.shown = name;
    await w.sent.edit({ content: `${claimText(name, [])}\n-# corrected`, embeds: [pcCopy(name)], allowedMentions: { parse: [] } }).catch(() => {});
    return;
  }
  const base = baseOf(name);
  const roles: string[] = [];
  if (!w.pinged) {
    if (rarityOf(base)) { const r = await rareRole(m.guild, store); if (r) roles.push(r.id); }
    for (const t of typesOf(base)) { const r = await typeRole(m.guild, store, t); if (r) roles.push(r.id); }
    w.pinged = true;
  }
  w.shown = name;
  w.sent = await ch.send({
    content: claimText(name, roles, guess),
    embeds: [pcCopy(name)],
    reply: { messageReference: w.id, failIfNotExists: false },
    allowedMentions: { roles },
  }).catch(() => null);
}

// a name everyone agrees on: from the catch, a one-answer hint or another helper bot
async function confirm(store: Store, m: Message, w: Waiting, name: string, how: 'catch' | 'hint' | 'helper') {
  if (w.confirmed && how !== 'catch') return;
  w.confirmed = name;
  if (w.hash) learn(store, w.hash, name);
  if (w.vec) remember(store, w.vec, name);
  if (w.image && !w.kept) { keepSpawn(w.image, name); w.kept = true; }
  logSpawn({ at: w.at, guess: w.guess, confirmed: name, how });
  if (how !== 'catch') await show(store, m, w, name);
}

async function onSpawn(store: Store, m: Message) {
  if (!m.guild || !m.author.bot || m.author.id === m.client.user.id) return;
  const which = m.author.id === POKETWO_ID ? 'p2' : m.author.id === SHOOB_ID ? 'shoob' : null;
  const w = waiting.get(m.channelId);
  // another helper bot answering the spawn: its name, variant and all, is worth learning
  if (!which) {
    if (w && m.reference?.messageId === w.id) {
      const name = fullNameFrom(`${m.embeds[0]?.title ?? ''}\n${m.content}`) ?? fullNameFrom(m.content) ?? fullNameFrom(m.embeds[0]?.description ?? '');
      if (name) await confirm(store, m, w, name, 'helper');
    }
    return;
  }
  if (which === 'p2') {
    // a hint: answer it, and if only one name fits, that's the spawn
    const hint = hintOf(m.content);
    if (hint) {
      const fits = solve(hint).slice(0, 6);
      if (fits.length === 1 && w) await confirm(store, m, w, fits[0].name, 'hint');
      else if (m.channel.isSendable() && store.rules(m.guild.id, 'spawns').enabled) await m.channel.send({ ...answer(hint, fits), reply: { messageReference: m.id, failIfNotExists: false }, allowedMentions: { parse: [] } });
      return;
    }
    // a catch: now the picture has a name for good
    const caught = /congratulations.*?you caught a (?:level|lvl\.?)\s*\d+\s+(.+)/i.exec(m.content);
    if (caught) {
      const name = fullNameFrom(caught[1].replace(/<a?:\w+:\d+>/g, ' ').replace(/[!✨]/g, ' ')) ?? nameIn(caught[1]);
      if (w && name && Date.now() - w.at < 30 * 60_000) await confirm(store, m, w, name, 'catch');
      waiting.delete(m.channelId);
      if (/these colors seem unusual|shiny/i.test(m.content) && name && m.channel.isSendable() && store.rules(m.guild.id, 'spawns').enabled) {
        const who = /<@!?(\d+)>/.exec(m.content)?.[1];
        await m.channel.send({ content: `✨ A **shiny ${name}**${who ? ` for <@${who}>` : ''}! Frame that one.`, allowedMentions: { parse: [] } });
      }
      return;
    }
  }
  const s = spawnOf(m);
  // what the bot said last, so the status page can show whether spawns are being recognised
  const e = m.embeds[0];
  store.setKv(`spawnlast:${m.guild.id}:${which}`, JSON.stringify({ at: Date.now(), spawn: !!s, title: (e?.title ?? m.content ?? '').slice(0, 80) }));
  if (!s) return;
  const day = new Date().toISOString().slice(0, 10);
  const count = `spawncount:${m.guild.id}:${which}:${day}`;
  store.setKv(count, String(Number(store.getKv(count) ?? 0) + 1));
  store.setKv(`spawnseen:${m.guild.id}:${which}`, String(Date.now()));
  if (s.kind === 'p2') {
    // an unclaimed spawn that never got a name still goes in the log, so misses show up
    if (w && !w.confirmed) logSpawn({ at: w.at, guess: w.guess, confirmed: null, how: 'fled' });
    const nw: Waiting = { id: m.id, channelId: m.channelId, hash: null, image: null, vec: null, at: Date.now(), guess: null, confirmed: null, sent: null, shown: null, pinged: false };
    waiting.set(m.channelId, nw);
    const url = e?.image?.url ?? e?.image?.proxyURL ?? m.attachments.first()?.url ?? null;
    // a second try, Discord's CDN sometimes drops the first request
    nw.image = url ? (await download(url)) ?? (await download(url)) : null;
    nw.hash = await fingerprint(nw.image);
    const seen = nw.hash ? recognise(store, nw.hash) : null;
    const cls = nw.image ? await classify(nw.image).catch(() => null) : null;
    nw.vec = cls?.vec ?? null;
    // a helper bot may have answered while the picture was being read, then its name stands
    if (nw.confirmed) { await show(store, m, nw, nw.confirmed); return; }
    const pick = decide(store, cls, seen);
    nw.guess = pick ? { name: pick.name, p: pick.p, how: pick.how } : null;
    if (pick) await show(store, m, nw, pick.name, { p: pick.p, others: pick.others });
    return;
  }
  if (!store.rules(m.guild.id, 'spawns').enabled || !m.channel.isSendable()) return;
  // one ping per channel every 20 seconds, spawns can come in bursts
  const key = `${m.channelId}:${which}`;
  if ((last.get(key) ?? 0) > Date.now() - 20_000) return;
  // Shoob pings only the people who asked for that tier
  if (!s.tier) return;
  const role = await shoobRole(m.guild, store, s.tier);
  if (!role) return;
  last.set(key, Date.now());
  await m.channel.send({ content: `${tierMark[s.tier]} <@&${role.id}> a **tier ${s.tier}** card just dropped, go claim it`, allowedMentions: { roles: [role.id] } });
}


export async function onCatchCopy(i: Interaction) {
  if (!i.isButton() || !i.customId.startsWith('p2c|')) return false;
  // buttons on older claim messages still answer
  await i.reply({ content: `\`${catchLine(i.customId.slice(4))}\``, flags: MessageFlags.Ephemeral });
  return true;
}

// the PC version: a code block with its own copy button on desktop, and the artwork
function pcCopy(name: string) {
  const id = idOf(name);
  const e = new EmbedBuilder().setColor(rarityOf(name) ? 0xf1c40f : 0xe3350d).setDescription(`🖥️ **Click to copy**\n\`\`\`${catchLine(name)}\`\`\``);
  if (id) e.setThumbnail(artwork(id));
  return e;
}

// the reply to a hint or a search, one name gets its artwork and the catch command
function answer(pattern: string, fits: { id: number; name: string }[]) {
  if (!fits.length) return { content: `🤔 Nothing fits \`${pattern}\`. Ask Pokétwo for another hint.` };
  if (fits.length === 1) {
    const f = fits[0];
    const types = typesOf(f.name);
    return { content: `## ${f.name}  ${types.map((t) => typeMark[t] ?? '').join('')}\n#${f.id} · ${types.join(' · ')}${rarityOf(f.name) ? ` · ${rareMark[rarityOf(f.name)!]}` : ''}\n📋 Tap to copy: \`${catchLine(f.name)}\``, embeds: [pcCopy(f.name)] };
  }
  return { content: `🔎 Could be ${fits.map((f) => `**${f.name}**`).join(', ')}\n${fits.slice(0, 4).map((f) => `📋 \`${catchLine(f.name)}\``).join('\n')}` };
}

// is the bot here, has it spawned anything, and could I read it
export function spawnStatus(store: Store, guild: Guild, which: 'p2' | 'shoob') {
  const here = guild.members.cache.has(which === 'p2' ? POKETWO_ID : SHOOB_ID);
  const today = Number(store.getKv(`spawncount:${guild.id}:${which}:${new Date().toISOString().slice(0, 10)}`) ?? 0);
  const seen = Number(store.getKv(`spawnseen:${guild.id}:${which}`) ?? 0);
  let lastMsg: { at: number; spawn: boolean; title: string } | null = null;
  try { lastMsg = JSON.parse(store.getKv(`spawnlast:${guild.id}:${which}`) ?? 'null'); } catch { /* old value */ }
  const roles = which === 'p2' ? ['p2rare', ...TYPES.map((t) => `p2type:${t}`)] : TIERS.map((t) => `t${t}`);
  const people = new Set(roles.flatMap((r) => [...(guild.roles.cache.get(store.getKv(`spawnrole:${guild.id}:${r}`) ?? '')?.members.keys() ?? [])])).size;
  return [
    here ? '🟢 in this server' : '⚪ not seen here yet',
    `👥 **${people}** opted in`,
    `✨ **${today}** today${seen ? ` · last <t:${Math.floor(seen / 1000)}:R>` : ''}`,
    lastMsg && !lastMsg.spawn ? `-# last one I didn't count: ${lastMsg.title || 'no title'}` : null,
  ].filter(Boolean).join('\n');
}

async function spawnsPage(store: Store, guild: Guild, userId: string) {
  const member = await guild.members.fetch(userId).catch(() => null);
  const has = (id?: string | null) => !!id && !!member?.roles.cache.has(id);
  const p2 = has(store.getKv(`spawnrole:${guild.id}:p2rare`));
  const mine = TIERS.filter((t) => has(store.getKv(`spawnrole:${guild.id}:t${t}`)));
  const myTypes = TYPES.filter((t) => has(store.getKv(`spawnrole:${guild.id}:p2type:${t}`)));
  const e = card({
    kind: 'help', title: 'Spawn pings', emoji: '🎯', gif: 'off',
    body: [
      `${p2 ? '🟢' : '⚫'} 🌟 **Pokétwo rare spawns** · legendary, mythical and ultra beasts only`,
      `${myTypes.length ? '🟢' : '⚫'} 🧬 **Pokétwo types** · ${myTypes.length ? myTypes.map((t) => `${typeMark[t]} ${t}`).join(' ') : 'none picked, handy when a quest wants a type'}`,
      `🔎 **Claim help** · I read every spawn picture, and remember **${memorySize(store)}** confirmed spawns so variants come out right, plus I solve hints`,
      `${mine.length ? '🟢' : '⚫'} 🃏 **Shoob** · ${mine.length ? mine.map((t) => `${tierMark[t]} T${t}`).join(' ') : 'no tiers picked'}`,
      '',
      '-# Shoob only pings the tiers you pick. Most people want 4 and up.',
    ].join('\n'),
    fields: [
      { name: '🔴 Pokétwo', value: spawnStatus(store, guild, 'p2'), inline: true },
      { name: '🃏 Shoob', value: spawnStatus(store, guild, 'shoob'), inline: true },
    ],
  });
  return {
    embeds: [e],
    components: [
      row(new ButtonBuilder().setCustomId('spw|p2').setLabel(p2 ? 'Stop rare spawn pings' : 'Ping me for rare spawns').setEmoji('🌟').setStyle(p2 ? ButtonStyle.Success : ButtonStyle.Secondary)),
      row(new StringSelectMenuBuilder().setCustomId('spw|types').setPlaceholder('🧬 Which Pokétwo types ping you').setMinValues(0).setMaxValues(TYPES.length)
        .addOptions(TYPES.map((t) => ({ label: t, value: t, emoji: typeMark[t], default: myTypes.includes(t) })))),
      row(new StringSelectMenuBuilder().setCustomId('spw|tiers').setPlaceholder('🃏 Which Shoob tiers ping you').setMinValues(0).setMaxValues(TIERS.length)
        .addOptions(TIERS.map((t) => ({ label: `Tier ${t}`, value: t, emoji: tierMark[t], default: mine.includes(t as never) })))),
    ],
  };
}

const spawns: Command = {
  name: 'spawns',
  group: 'fun',
  data: new SlashCommandBuilder().setName('spawns').setDescription('Pokétwo and Shoob spawn pings, and how they\'re doing here').toJSON(),
  text: { aliases: ['spawn', 'p2', 'shoob'] },
  run: async (ctx, store) => {
    if (!ctx.guild) return ctx.reply('Spawn pings live in servers.');
    return ctx.reply(await spawnsPage(store, ctx.guild, ctx.userId));
  },
};

const pokemon: Command = {
  name: 'pokemon',
  group: 'fun',
  data: new SlashCommandBuilder().setName('pokemon').setDescription('Work out a pokémon from a hint like p_k_ch_ or part of a name')
    .addStringOption((o) => o.setName('hint').setDescription('Use _ for the letters you don\'t know').setRequired(true).setMaxLength(40)).toJSON(),
  text: { aliases: ['poke', 'dex', 'whosthat'], args: ['hint'] },
  run: (ctx) => {
    const hint = (ctx.str('hint') ?? '').replace(/\\/g, '').trim();
    return ctx.reply(answer(hint, solve(hint).slice(0, 8)));
  },
};

export async function onSpawnButton(store: Store, i: Interaction) {
  if (!(i.isButton() || i.isStringSelectMenu()) || !i.customId.startsWith('spw|') || !i.guild) return false;
  const member = await i.guild.members.fetch(i.user.id).catch(() => null);
  if (!member) return true;
  let ok = true;
  if (i.customId === 'spw|p2') {
    const role = await rareRole(i.guild, store, true);
    ok = !!role && await (member.roles.cache.has(role.id) ? member.roles.remove(role) : member.roles.add(role)).then(() => true).catch(() => false);
  } else if (i.isStringSelectMenu() && i.customId === 'spw|types') {
    // the types for quests, same idea as the tiers
    for (const t of TYPES) {
      const want = i.values.includes(t);
      const role = await typeRole(i.guild, store, t, want);
      if (!role || member.roles.cache.has(role.id) === want) continue;
      ok = await (want ? member.roles.add(role) : member.roles.remove(role)).then(() => ok).catch(() => false);
    }
  } else if (i.isStringSelectMenu()) {
    // add the picked tiers, drop the rest
    for (const t of TIERS) {
      const want = i.values.includes(t);
      const role = await shoobRole(i.guild, store, t, want);
      if (!role || member.roles.cache.has(role.id) === want) continue;
      ok = await (want ? member.roles.add(role) : member.roles.remove(role)).then(() => ok).catch(() => false);
    }
  }
  if (!ok) { await i.reply({ content: 'I couldn\'t change that role. I need Manage Roles and my role above the spawn roles.', flags: MessageFlags.Ephemeral }); return true; }
  const page = await spawnsPage(store, i.guild, i.user.id);
  const theirs = i.message.interactionMetadata?.user.id === i.user.id || i.message.mentions.repliedUser?.id === i.user.id || i.message.flags.has(MessageFlags.Ephemeral);
  if (theirs) await i.update(page);
  else await i.reply({ ...page, flags: MessageFlags.Ephemeral });
  return true;
}

// every ping someone can get from Texz, switched on and off in one place
const boards = { f1: { emoji: '🏎️', label: 'F1' }, football: { emoji: '⚽', label: 'Football' }, anime: { emoji: '📺', label: 'Anime episodes' } } as const;

async function pingsPanel(store: Store, guild: Guild, userId: string) {
  const member = await guild.members.fetch(userId).catch(() => null);
  const g = store.guild(guild.id);
  const has = (id: string | null | undefined) => !!id && !!member?.roles.cache.has(id);
  const mark = (on: boolean) => (on ? '🟢' : '⚫');
  const lines: string[] = [];
  const buttons: ButtonBuilder[] = [];
  for (const k of ['f1', 'football', 'anime'] as const) {
    const role = g.bulletins[k].on ? g.bulletins[k].role : null;
    if (!role || !guild.roles.cache.has(role)) continue;
    const on = has(role);
    lines.push(`${mark(on)} ${boards[k].emoji} **${boards[k].label}** · <@&${role}>`);
    buttons.push(new ButtonBuilder().setCustomId(`pg|${k}`).setLabel(boards[k].label).setEmoji(boards[k].emoji).setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary));
  }
  if (store.rules(guild.id, 'spawns').enabled) {
    const on = has(store.getKv(`spawnrole:${guild.id}:p2rare`));
    lines.push(`${mark(on)} 🌟 **Rare Pokétwo spawns** · legendary, mythical, ultra beasts`);
    const types = TYPES.filter((t) => has(store.getKv(`spawnrole:${guild.id}:p2type:${t}`)));
    lines.push(`${mark(types.length > 0)} 🧬 **Pokétwo types** · ${types.length ? types.map((t) => typeMark[t]).join(' ') : 'none, pick them on the spawn page'}`);
    buttons.push(new ButtonBuilder().setCustomId('pg|p2').setLabel('Rare pokémon').setEmoji('🌟').setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary));
    const tiers = TIERS.filter((t) => has(store.getKv(`spawnrole:${guild.id}:t${t}`)));
    lines.push(`${mark(tiers.length > 0)} 🃏 **Shoob** · ${tiers.length ? tiers.map((t) => `${tierMark[t]} T${t}`).join(' ') : 'no tiers picked'}`);
    buttons.push(new ButtonBuilder().setCustomId(`nav|spawns|owner=${userId},back=pings`).setLabel('Shoob tiers').setEmoji('🃏').setStyle(tiers.length ? ButtonStyle.Success : ButtonStyle.Secondary));
  }
  const buddy = store.buddies(guild.id).includes(userId);
  if (store.rules(guild.id, 'owo').enabled) {
    lines.push(`${mark(buddy)} 🤝 **OwO quest buddies** · someone needs a cookie, pray, curse or battle`);
    buttons.push(new ButtonBuilder().setCustomId('pg|buddy').setLabel('Quest buddies').setEmoji('🤝').setStyle(buddy ? ButtonStyle.Success : ButtonStyle.Secondary));
  }
  const p = picksOf(store, userId);
  const mine = [p.club && `⚽ ${p.club}`, p.team && `🏎️ ${p.team}`, p.anime && `📺 ${p.anime}`].filter(Boolean).join(' · ');
  lines.push(`${mark(p.ping !== false && !!mine)} ⭐ **Just for you** · ${mine || 'no picks yet'}`);
  const rows = [];
  for (let n = 0; n < buttons.length; n += 5) rows.push(row(...buttons.slice(n, n + 5)));
  rows.push(row(
    new ButtonBuilder().setCustomId('pg|personal').setLabel(`Mention me for my picks: ${p.ping === false ? 'off' : 'on'}`).setEmoji('⭐').setStyle(p.ping === false ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`nav|profile|owner=${userId},sub=edit`).setLabel('Change my picks').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
  ));
  const e = card({
    kind: 'help', title: 'Your pings', emoji: '🔔', gif: 'off',
    body: `${lines.join('\n')}\n\n-# 🟢 on · ⚫ off. Press to switch. When more than three people share a pick, they get a role of their own so one ping covers everyone.`,
  });
  return { embeds: [e], components: rows.slice(0, 5) };
}

const pings: Command = {
  name: 'pings',
  group: 'info',
  data: new SlashCommandBuilder().setName('pings').setDescription('Every ping Texz can send you, on or off in one place').toJSON(),
  text: { aliases: ['notify', 'notifications'] },
  run: async (ctx, store) => {
    if (!ctx.guild) return ctx.reply('Pings live in servers.');
    return ctx.reply(await pingsPanel(store, ctx.guild, ctx.userId));
  },
};

export async function onPingsButton(store: Store, i: Interaction) {
  if (!i.isButton() || !i.customId.startsWith('pg|') || !i.guild) return false;
  const what = i.customId.split('|')[1];
  const member = await i.guild.members.fetch(i.user.id).catch(() => null);
  let problem = '';
  if (what === 'buddy') store.setBuddy(i.guild.id, i.user.id, !store.buddies(i.guild.id).includes(i.user.id));
  else if (what === 'personal') { const p = picksOf(store, i.user.id); p.ping = p.ping === false; savePicks(store, i.user.id, p); }
  else if (member) {
    const role = what === 'p2' ? await rareRole(i.guild, store, true) : i.guild.roles.cache.get(store.guild(i.guild.id).bulletins[what as keyof typeof boards]?.role ?? '');
    if (!role) problem = 'That role isn\'t there, an admin can fix it in /setup.';
    else {
      const has = member.roles.cache.has(role.id);
      const ok = await (has ? member.roles.remove(role) : member.roles.add(role)).then(() => true).catch(() => false);
      if (!ok) problem = 'My role sits too low to give that, move Texz up a bit.';
    }
  }
  if (problem) { await i.reply({ content: problem, flags: MessageFlags.Ephemeral }); return true; }
  // a panel someone else opened gets a fresh copy instead of changing theirs
  const page = await pingsPanel(store, i.guild, i.user.id);
  const theirs = i.message.interactionMetadata?.user.id === i.user.id || i.message.mentions.repliedUser?.id === i.user.id || i.message.flags.has(MessageFlags.Ephemeral);
  if (theirs) await i.update(page);
  else await i.reply({ ...page, flags: MessageFlags.Ephemeral });
  return true;
}

export const spawnsModule: Module = {
  name: 'spawns',
  label: 'Pings and spawns',
  about: 'One panel for every ping, Pokétwo spawns with hint solving, and Shoob pings by tier.',
  commands: [pings, spawns, pokemon],
};
