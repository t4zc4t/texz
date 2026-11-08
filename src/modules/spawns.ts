import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, MessageFlags, SlashCommandBuilder, StringSelectMenuBuilder,
  type Client, type Guild, type Interaction, type Message, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import { card } from '../theme.js';
import { picksOf, savePicks } from './profile.js';
import { artwork, catchLine, hintOf, idOf, nameIn, rarityOf, solve } from '../features/pokedex.js';
import { fingerprint, knownCount, learn, recognise } from '../features/pokeid.js';

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
  client.on(Events.MessageCreate, (m) => void onSpawn(store, m).catch(() => {}));
}

// the spawn waiting in each channel, until someone catches it or the next one comes
const waiting = new Map<string, { id: string; hash: string | null; at: number; name: string | null; rare: boolean; pinged: boolean }>();
const RARE_ROLE = 'Pokétwo Rare Spawns';
const rareRole = (guild: Guild, store: Store, make = false) => roleNamed(guild, store, 'p2rare', RARE_ROLE, make);
const rareMark: Record<string, string> = { legendary: '🌟 Legendary', mythical: '💫 Mythical', 'ultra beast': '🌀 Ultra Beast' };

// a name is known for the spawn: tell the channel how to catch it, and ping for the rare ones
async function named(store: Store, m: Message, spawnId: string, name: string, how: 'seen' | 'hint' | 'helper') {
  const w = waiting.get(m.channelId);
  if (!w || w.id !== spawnId || !m.guild || !m.channel.isSendable()) return;
  const firstTime = !w.name;
  w.name = name;
  const rare = rarityOf(name);
  w.rare = !!rare;
  if (w.hash && how !== 'seen') learn(store, w.hash, name);
  if (!store.rules(m.guild.id, 'spawns').enabled) return;
  const role = rare && !w.pinged ? await rareRole(m.guild, store) : null;
  if (role) w.pinged = true;
  // the claim card goes out once, a helper bot already naming it is enough on its own unless it's rare
  if (how === 'helper' && !role) return;
  if (!firstTime && !role) return;
  const id = idOf(name);
  const e = card({
    kind: 'help', title: name, emoji: rare ? '🌟' : '🔎', gif: 'off', line: '', color: rare ? 0xf1c40f : 0xe3350d,
    body: `${rare ? `**${rareMark[rare]}**\n` : ''}\`\`\`${catchLine(name)}\`\`\``,
  });
  if (id) e.setThumbnail(artwork(id));
  await m.channel.send({
    content: role ? `${rareMark[rare!]} spawn <@&${role.id}>, be quick` : undefined,
    embeds: [e],
    reply: { messageReference: spawnId, failIfNotExists: false },
    allowedMentions: { roles: role ? [role.id] : [] },
  });
}

async function onSpawn(store: Store, m: Message) {
  if (!m.guild || !m.author.bot || m.author.id === m.client.user.id) return;
  const which = m.author.id === POKETWO_ID ? 'p2' : m.author.id === SHOOB_ID ? 'shoob' : null;
  const w = waiting.get(m.channelId);
  // another helper bot answering the spawn, its name is worth learning
  if (!which) {
    if (w && m.reference?.messageId === w.id && !w.name) {
      const name = nameIn(`${m.embeds[0]?.title ?? ''} ${m.content.split('\n')[0]}`);
      if (name) await named(store, m, w.id, name, 'helper');
    }
    return;
  }
  if (which === 'p2') {
    // a hint: answer it, and if only one name fits, that's the spawn
    const hint = hintOf(m.content);
    if (hint) {
      const fits = solve(hint).slice(0, 6);
      if (fits.length === 1 && w) await named(store, m, w.id, fits[0].name, 'hint');
      else if (m.channel.isSendable() && store.rules(m.guild.id, 'spawns').enabled) await m.channel.send({ ...answer(hint, fits), reply: { messageReference: m.id, failIfNotExists: false }, allowedMentions: { parse: [] } });
      return;
    }
    // a catch: now the picture has a name for good
    const caught = /congratulations.*?you caught a (?:level|lvl\.?)\s*\d+\s+(.+)/i.exec(m.content);
    if (caught) {
      const name = nameIn(caught[1]);
      if (w && name && w.hash && Date.now() - w.at < 30 * 60_000) learn(store, w.hash, name);
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
    const url = e?.image?.url ?? m.attachments.first()?.url ?? null;
    const hash = url ? await fingerprint(url) : null;
    waiting.set(m.channelId, { id: m.id, hash, at: Date.now(), name: null, rare: false, pinged: false });
    const seen = hash ? recognise(store, hash) : null;
    if (seen) await named(store, m, m.id, seen.name, 'seen');
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

// the reply to a hint or a search, one name gets its artwork and the catch command
function answer(pattern: string, fits: { id: number; name: string }[]) {
  if (!fits.length) return { content: `🤔 Nothing fits \`${pattern}\`. Ask Pokétwo for another hint.` };
  if (fits.length === 1) {
    const f = fits[0];
    const e = card({ kind: 'help', title: f.name, emoji: '🔎', gif: 'off', line: '', color: 0xe3350d, body: `#${f.id} · catch it with\n\`\`\`${catchLine(f.name)}\`\`\`` }).setThumbnail(artwork(f.id));
    return { embeds: [e] };
  }
  return { content: `🔎 Could be ${fits.map((f) => `**${f.name}**`).join(', ')}\n${fits.slice(0, 3).map((f) => `\`${catchLine(f.name)}\``).join('\n')}` };
}

// is the bot here, has it spawned anything, and could I read it
export function spawnStatus(store: Store, guild: Guild, which: 'p2' | 'shoob') {
  const here = guild.members.cache.has(which === 'p2' ? POKETWO_ID : SHOOB_ID);
  const today = Number(store.getKv(`spawncount:${guild.id}:${which}:${new Date().toISOString().slice(0, 10)}`) ?? 0);
  const seen = Number(store.getKv(`spawnseen:${guild.id}:${which}`) ?? 0);
  let lastMsg: { at: number; spawn: boolean; title: string } | null = null;
  try { lastMsg = JSON.parse(store.getKv(`spawnlast:${guild.id}:${which}`) ?? 'null'); } catch { /* old value */ }
  const roles = which === 'p2' ? ['p2rare'] : TIERS.map((t) => `t${t}`);
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
  const e = card({
    kind: 'help', title: 'Spawn pings', emoji: '🎯', gif: 'off',
    body: [
      `${p2 ? '🟢' : '⚫'} 🌟 **Pokétwo rare spawns** · legendary, mythical and ultra beasts only`,
      `🔎 **Claim help** · I name every spawn I've seen caught before, **${knownCount(store)}** known so far, and solve hints`,
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
