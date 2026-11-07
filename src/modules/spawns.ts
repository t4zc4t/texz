import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
  type Client, type Guild, type Interaction, type Message, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import { card } from '../theme.js';
import { picksOf, savePicks } from './profile.js';

export const POKETWO_ID = '716390085896962058';
export const SHOOB_ID = '673362753489993749';

const kinds = {
  p2: { bot: POKETWO_ID, role: 'Pokétwo Spawns', emoji: '🔴', label: 'Pokétwo' },
  shoob: { bot: SHOOB_ID, role: 'Shoob Spawns', emoji: '🃏', label: 'Shoob' },
} as const;
type K = keyof typeof kinds;

const row = (...b: ButtonBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...b);

// what a spawn looks like, read from the embed so normal bot chatter never pings anyone
export function spawnOf(m: { author: { id: string }; embeds: { title?: string | null; description?: string | null; footer?: { text: string } | null }[] }): { kind: K; tier: number | null } | null {
  const e = m.embeds[0];
  if (!e) return null;
  const text = `${e.title ?? ''}\n${e.description ?? ''}\n${e.footer?.text ?? ''}`;
  if (m.author.id === POKETWO_ID && /wild pok[eé]mon has appeared/i.test(text)) return { kind: 'p2', tier: null };
  if (m.author.id === SHOOB_ID) {
    const t = /tier\s*:?\s*\**\s*(S|[1-6])\b/i.exec(text);
    if (!t && !/to claim|claim it|has appeared|spawned/i.test(text)) return null;
    const tier = t ? (t[1].toUpperCase() === 'S' ? 7 : Number(t[1])) : null;
    return { kind: 'shoob', tier };
  }
  return null;
}

async function roleFor(guild: Guild, store: Store, k: K, make: boolean) {
  const key = `spawnrole:${guild.id}:${k}`;
  const known = store.getKv(key);
  let role = known ? guild.roles.cache.get(known) ?? null : null;
  // found by name too, in case someone made it by hand or the id got lost
  role ??= guild.roles.cache.find((r) => r.name === kinds[k].role) ?? null;
  if (!role && make) role = await guild.roles.create({ name: kinds[k].role, mentionable: false, reason: 'Texz spawn pings' }).catch(() => null);
  if (role && role.id !== known) store.setKv(key, role.id);
  return role;
}

const last = new Map<string, number>();

export function watchSpawns(client: Client, store: Store) {
  client.on(Events.MessageCreate, (m) => void onSpawn(store, m).catch(() => {}));
}

async function onSpawn(store: Store, m: Message) {
  if (!m.guild || !m.author.bot) return;
  const s = spawnOf(m);
  if (!s || !store.rules(m.guild.id, 'spawns').enabled) return;
  const min = Number(store.getKv(`spawnmin:${m.guild.id}`) ?? 1);
  if (s.kind === 'shoob' && s.tier !== null && s.tier < min) return;
  // one ping per channel every 20 seconds, spawns can come in bursts
  const key = `${m.channelId}:${s.kind}`;
  if ((last.get(key) ?? 0) > Date.now() - 20_000) return;
  last.set(key, Date.now());
  const role = await roleFor(m.guild, store, s.kind, false);
  if (!role) return;
  const tier = s.tier ? ` · tier ${s.tier === 7 ? 'S' : s.tier}` : '';
  if (m.channel.isSendable()) await m.channel.send({ content: `${kinds[s.kind].emoji} <@&${role.id}> a ${kinds[s.kind].label} spawn${tier}, go go go`, allowedMentions: { roles: [role.id] } });
}

const spawns: Command = {
  name: 'spawns',
  group: 'fun',
  data: new SlashCommandBuilder().setName('spawns').setDescription('Get pinged for Pokétwo and Shoob spawns')
    .addIntegerOption((o) => o.setName('tier').setDescription('Lowest Shoob tier worth a ping (admins), 7 means S only').setMinValue(1).setMaxValue(7)).toJSON(),
  text: { aliases: ['spawn', 'p2', 'shoob'], args: ['tier'] },
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Spawn pings live in servers.');
    const tier = ctx.int('tier');
    if (tier) {
      if (!ctx.member?.permissions.has(PermissionFlagsBits.ManageGuild)) return ctx.reply('Only admins pick the tier.');
      store.setKv(`spawnmin:${ctx.guildId}`, String(tier));
    }
    const min = Number(store.getKv(`spawnmin:${ctx.guildId}`) ?? 1);
    const e = card({
      kind: 'help', title: 'Spawn pings', emoji: '🎯', gif: 'off',
      body: `Pick what you want a ping for. I only ping when the spawn shows up, never for anything else.\n\n🔴 **Pokétwo** · every wild pokémon\n🃏 **Shoob** · tier **${min === 7 ? 'S' : min}** and up${tier ? ' (just changed)' : ''}\n-# Press again to stop. Admins: \`/fun view:spawns input:4\` changes the Shoob tier.`,
    });
    return ctx.reply({ embeds: [e], components: [row(
      new ButtonBuilder().setCustomId('spw|p2').setLabel('Pokétwo').setEmoji('🔴').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('spw|shoob').setLabel('Shoob').setEmoji('🃏').setStyle(ButtonStyle.Secondary),
    )] });
  },
};

export async function onSpawnButton(store: Store, i: Interaction) {
  if (!i.isButton() || !i.customId.startsWith('spw|') || !i.guild) return false;
  const k = i.customId.split('|')[1] as K;
  if (!kinds[k]) return false;
  const role = await roleFor(i.guild, store, k, true);
  const member = await i.guild.members.fetch(i.user.id).catch(() => null);
  if (!role || !member) { await i.reply({ content: 'I couldn\'t make the role, I need Manage Roles.', flags: MessageFlags.Ephemeral }); return true; }
  const has = member.roles.cache.has(role.id);
  const ok = await (has ? member.roles.remove(role) : member.roles.add(role)).then(() => true).catch(() => false);
  await i.reply({ content: ok ? (has ? `🔕 No more ${kinds[k].label} pings.` : `🔔 You'll hear about every ${kinds[k].label} spawn.`) : 'My role sits too low to give that, move Texz up a bit.', flags: MessageFlags.Ephemeral });
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
  if (store.rules(guild.id, 'spawns').enabled) for (const k of ['p2', 'shoob'] as const) {
    const id = store.getKv(`spawnrole:${guild.id}:${k}`);
    const on = has(id);
    lines.push(`${mark(on)} ${kinds[k].emoji} **${kinds[k].label} spawns**`);
    buttons.push(new ButtonBuilder().setCustomId(`pg|${k}`).setLabel(kinds[k].label).setEmoji(kinds[k].emoji).setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary));
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
    const role = what === 'p2' || what === 'shoob' ? await roleFor(i.guild, store, what, true) : i.guild.roles.cache.get(store.guild(i.guild.id).bulletins[what as keyof typeof boards]?.role ?? '');
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
  about: 'One panel for every ping, plus opt-in Pokétwo and Shoob spawn pings.',
  commands: [pings, spawns],
};
