import {
  ChannelType, PermissionFlagsBits, type CategoryChannel, type Guild, type GuildBasedChannel, type GuildMember, type PermissionsString, type TextChannel,
} from 'discord.js';
import { defaultRules, type Store } from '../db.js';
import { card } from '../theme.js';
import { fixText } from '../core/fixes.js';
import { staffRoles } from '../core/staff.js';
import { buildBoard, CATEGORY } from '../modules/bulletins.js';
import { confessIntro, countIntro, rooms } from '../modules/community.js';

// the whole Texz corner of a server in one go: a front door, the bulletin board, the bar and the archives, each with the right locks

export const FLOORS = {
  front: '🚪 Agency Front Door',
  board: CATEGORY,
  bar: '🥃 Bar Lupin',
  logs: '🗄️ Port Mafia Archives',
} as const;

export const extraRooms = {
  arrivals: { name: '🌸┃new-recruits', topic: 'Newcomers walk in here. Dazai greets them, Kunikida writes their name down.' },
  patrons: { name: '💎┃agency-patrons', topic: 'Everyone who boosts the server gets thanked here. Their names go on the good page of Kunikida\'s notebook.' },
  yen: { name: '💴┃the-yen-counter', topic: 'Daily yen, wallets, giving, the rich list and the role shop. Yen commands only work here, so the rest of the server stays quiet.' },
  orders: { name: '⚖️┃executive-orders', topic: 'Warnings, timeouts, kicks, bans and automod, filed by Texz. Staff only.' },
  watch: { name: '👁️┃black-lizard-watch', topic: 'Joins, leaves, edited and deleted messages. Staff only.' },
  ledger: { name: '📓┃texz-ledger', topic: 'What Texz did and what admins changed in its settings. Staff only.' },
} as const;

type Mode = 'read' | 'chat' | 'bot' | 'private';
type Perms = Partial<Record<PermissionsString, boolean>>;

// a channel Texz made before, under an older name or in the wrong place, is moved and renamed; anyone else's channel is left alone
const ours = (c: GuildBasedChannel, olds: string[]) => c.name.includes('┃') || olds.includes(c.name);

// Discord refuses an overwrite that names a permission Texz itself lacks, so those are dropped instead of failing the whole edit
function only(me: GuildMember, p: Perms): Perms {
  if (me.permissions.has(PermissionFlagsBits.Administrator)) return p;
  return Object.fromEntries(Object.entries(p).filter(([k]) => me.permissions.has(k as PermissionsString))) as Perms;
}

const locks: Record<Mode, { everyone: Perms; staff?: Perms; me: Perms }> = {
  // people read and react, Texz posts
  read: {
    everyone: { SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false, CreatePrivateThreads: false, AddReactions: true, ReadMessageHistory: true },
    me: { ViewChannel: true, SendMessages: true, EmbedLinks: true, AttachFiles: true, AddReactions: true, ReadMessageHistory: true, ManageMessages: true, MentionEveryone: true, UseExternalEmojis: true },
  },
  // people type, no threads, files, stickers or polls getting in the way
  chat: {
    everyone: { SendMessages: true, ReadMessageHistory: true, AddReactions: false, CreatePublicThreads: false, CreatePrivateThreads: false, SendMessagesInThreads: false, AttachFiles: false, EmbedLinks: false, UseExternalStickers: false, SendVoiceMessages: false, SendPolls: false },
    me: { ViewChannel: true, SendMessages: true, AddReactions: true, ReadMessageHistory: true, ManageMessages: true, EmbedLinks: true },
  },
  // a room for running commands: type and react, no threads or files
  bot: {
    everyone: { SendMessages: true, ReadMessageHistory: true, AddReactions: true, UseApplicationCommands: true, CreatePublicThreads: false, CreatePrivateThreads: false, SendMessagesInThreads: false, AttachFiles: false, SendVoiceMessages: false, SendPolls: false },
    me: { ViewChannel: true, SendMessages: true, EmbedLinks: true, AttachFiles: true, AddReactions: true, ReadMessageHistory: true, ManageMessages: true, UseExternalEmojis: true },
  },
  // staff read, nobody else sees it
  private: {
    everyone: { ViewChannel: false },
    staff: { ViewChannel: true, ReadMessageHistory: true, SendMessages: false, AddReactions: true },
    me: { ViewChannel: true, SendMessages: true, EmbedLinks: true, AttachFiles: true, ReadMessageHistory: true },
  },
};

async function lock(store: Store, ch: CategoryChannel | TextChannel, me: GuildMember, mode: Mode) {
  const l = locks[mode];
  const everyone = ch.guild.roles.everyone;
  await ch.permissionOverwrites.edit(me.id, only(me, l.me)).catch(() => {});
  await ch.permissionOverwrites.edit(everyone, only(me, l.everyone)).catch(() => {});
  if (l.staff) for (const id of staffRoles(store, ch.guild.id)) if (ch.guild.roles.cache.has(id)) await ch.permissionOverwrites.edit(id, only(me, l.staff)).catch(() => {});
}

async function floor(guild: Guild, store: Store, key: keyof typeof FLOORS, me: GuildMember, olds: string[] = []): Promise<CategoryChannel> {
  const kv = `floor:${guild.id}:${key}`;
  const saved = store.getKv(kv);
  let cat = (saved ? guild.channels.cache.get(saved) : undefined) as CategoryChannel | undefined;
  cat ??= guild.channels.cache.find((c): c is CategoryChannel => c.type === ChannelType.GuildCategory && (c.name === FLOORS[key] || olds.includes(c.name)));
  if (cat && cat.name !== FLOORS[key]) await cat.setName(FLOORS[key]).catch(() => {});
  cat ??= await guild.channels.create({ name: FLOORS[key], type: ChannelType.GuildCategory, reason: 'Agency layout from /setup' });
  store.setKv(kv, cat.id);
  if (key === 'logs') await lock(store, cat, me, 'private');
  return cat;
}

async function room(guild: Guild, store: Store, cat: CategoryChannel, saved: string | null | undefined, spec: { name: string; topic: string }, mode: Mode, me: GuildMember, olds: string[] = []) {
  let ch = (saved ? await guild.channels.fetch(saved).catch(() => null) : null) as GuildBasedChannel | null;
  if (ch && (ch.type !== ChannelType.GuildText || !ours(ch, olds))) ch = null;
  ch ??= guild.channels.cache.find((c) => c.type === ChannelType.GuildText && (c.name === spec.name || olds.includes(c.name))) ?? null;
  const fresh = !ch;
  let text = ch as TextChannel | null;
  if (text) {
    if (text.parentId !== cat.id) await text.setParent(cat.id, { lockPermissions: false, reason: 'Agency layout' }).catch(() => {});
    if (text.name !== spec.name) await text.setName(spec.name, 'Agency layout').catch(() => {});
    if (text.topic !== spec.topic) await text.setTopic(spec.topic).catch(() => {});
  }
  text ??= await guild.channels.create({ name: spec.name, type: ChannelType.GuildText, parent: cat.id, topic: spec.topic, reason: 'Agency layout from /setup' });
  await lock(store, text, me, mode);
  return { ch: text, fresh };
}

// the ping roles Texz hands out carry no powers and don't float in the member list
async function tidyRoles(store: Store, guild: Guild) {
  const g = store.guild(guild.id);
  const ids = [
    ...store.kvByPrefix(`spawnrole:${guild.id}:`).map((x) => x.value),
    g.bulletins.f1.role, g.bulletins.football.role, g.bulletins.anime.role,
  ].filter((x): x is string => !!x);
  for (const id of new Set(ids)) {
    const r = guild.roles.cache.get(id);
    if (!r?.editable || r.managed) continue;
    if (r.permissions.bitfield !== 0n || r.hoist || r.mentionable) await r.edit({ permissions: [], hoist: false, mentionable: false, reason: 'Texz ping roles carry no permissions' }).catch(() => {});
  }
}

export async function buildAgency(store: Store, guild: Guild): Promise<string> {
  const me = await guild.members.fetchMe();
  const need: PermissionsString[] = ['ManageChannels', 'ManageRoles'];
  if (!me.permissions.has(need)) return fixText(guild, { perms: need, doing: 'lay the server out' }) ?? 'I need Manage Channels and Manage Roles to lay the server out.';
  await guild.channels.fetch().catch(() => null);

  // the bulletin board first, it brings its own channels and ping roles
  const boardNote = await buildBoard(store, guild);
  const front = await floor(guild, store, 'front', me);
  const board = await floor(guild, store, 'board', me);
  const bar = await floor(guild, store, 'bar', me, ['🍸 Lupin Bar']);
  const logs = await floor(guild, store, 'logs', me);

  const g = store.guild(guild.id);
  const door = await room(guild, store, front, g.welcome.channel, extraRooms.arrivals, 'read', me, ['welcome', 'arrivals', 'new-recruits']);
  const p = await room(guild, store, front, store.getKv(`boostch:${guild.id}`), extraRooms.patrons, 'read', me, ['boosts', 'boosters']);
  const y = await room(guild, store, bar, store.rules(guild.id, 'economy').channels[0], extraRooms.yen, 'bot', me, ['economy', 'yen', 'bank']);
  const q = await room(guild, store, board, g.quotes.channel, rooms.quotes, 'read', me, ['quotes', 'make-it-a-quote', 'quote-wall']);
  const a = await room(guild, store, board, g.starboard.channel, rooms.archive, 'read', me, ['starboard']);
  const countSaved = (JSON.parse(store.getKv(`count:${guild.id}`) ?? '{}') as { channel?: string }).channel;
  const k = await room(guild, store, bar, countSaved, rooms.count, 'chat', me, ['counting', 'count']);
  const f = await room(guild, store, bar, store.getKv(`confessch:${guild.id}`), rooms.confess, 'read', me, ['confessions', 'confess']);
  const o = await room(guild, store, logs, g.mod.logChannel, extraRooms.orders, 'private', me, ['mod-log', 'modlog', 'mod-logs']);
  const w = await room(guild, store, logs, store.getKv(`serverlog:${guild.id}`), extraRooms.watch, 'private', me, ['server-log', 'logs']);
  const l = await room(guild, store, logs, store.getKv(`botlog:${guild.id}`), extraRooms.ledger, 'private', me, ['bot-log', 'texz-log']);

  // every Texz setting points at the new rooms
  const fresh = store.guild(guild.id);
  fresh.welcome.channel = door.ch.id;
  fresh.welcome.goodbyeChannel = door.ch.id;
  fresh.quotes.channel = q.ch.id;
  fresh.starboard.channel = a.ch.id;
  if (fresh.starboard.min < 5) fresh.starboard.min = 5;
  fresh.mod.logChannel = o.ch.id;
  // yen commands only answer in their own room, admins can still use them anywhere
  fresh.modules.economy = { ...defaultRules('economy'), ...fresh.modules.economy, channels: [y.ch.id] };
  store.saveGuild(guild.id, fresh);
  store.setKv(`boostch:${guild.id}`, p.ch.id);
  const c = { channel: null, n: 0, last: null, best: 0, ...JSON.parse(store.getKv(`count:${guild.id}`) ?? '{}') };
  c.channel = k.ch.id;
  store.setKv(`count:${guild.id}`, JSON.stringify(c));
  store.setKv(`confessch:${guild.id}`, f.ch.id);
  store.setKv(`serverlog:${guild.id}`, w.ch.id);
  store.setKv(`botlog:${guild.id}`, l.ch.id);

  // inside each floor: the welcome first, the feeds then the community rooms, the count then the yen counter
  const feeds = [g.bulletins.f1.channel, g.bulletins.football.channel, g.bulletins.anime.channel].filter((x): x is string => !!x);
  const inside = [door.ch.id, p.ch.id, ...feeds, q.ch.id, a.ch.id, k.ch.id, y.ch.id, f.ch.id, o.ch.id, w.ch.id, l.ch.id];
  await guild.channels.setPositions(inside.map((id, n) => ({ channel: id, position: n }))).catch(() => {});

  // the front door at the very top, the bulletin board second, the bar after it, the archives at the very bottom
  const ours = [front.id, board.id, bar.id];
  const rest = [...guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory && !ours.includes(c.id) && c.id !== logs.id).values()]
    .sort((x, y) => (x as CategoryChannel).rawPosition - (y as CategoryChannel).rawPosition).map((c) => c.id);
  await guild.channels.setPositions([...ours, ...rest, logs.id].map((id, n) => ({ channel: id, position: n }))).catch(() => {});

  await tidyRoles(store, guild);

  if (door.fresh && door.ch.isSendable()) await door.ch.send({ embeds: [card({ kind: 'bulletin', title: '🌸 The Agency front door', emoji: '', gif: 'off', body: 'Everyone who walks in gets greeted here.\nNo appointment needed. Dazai is probably asleep on the sofa anyway.' })] }).catch(() => {});
  if (k.fresh) await k.ch.send(countIntro()).then((m) => m.pin().catch(() => {})).catch(() => {});
  if (f.fresh) await f.ch.send(confessIntro()).then((m) => m.pin().catch(() => {})).catch(() => {});
  if (l.fresh) await l.ch.send({ embeds: [card({ kind: 'bulletin', title: '📓 Texz ledger', emoji: '', gif: 'off', body: 'Every settings change and every building job gets a line here, so staff can see who changed what.' })] }).catch(() => {});

  const lines = [
    `🚪 **${FLOORS.front}** · <#${door.ch.id}> greets newcomers and says goodbye, <#${p.ch.id}> thanks boosters (switch it on in Welcome)`,
    `🕵️ **${FLOORS.board}** · ${feeds.map((x) => `<#${x}>`).join(' ')} <#${q.ch.id}> <#${a.ch.id}>`,
    `🥃 **${FLOORS.bar}** · <#${k.ch.id}> counting, <#${y.ch.id}> yen commands only work here, <#${f.ch.id}> confessions`,
    `🗄️ **${FLOORS.logs}** · <#${o.ch.id}> <#${w.ch.id}> <#${l.ch.id}>, staff only`,
  ];
  void botLog(guild, store, `🏗️ The Agency layout was built or refreshed.\n${lines.join('\n')}`);
  return `${boardNote.startsWith('🕵️') ? '' : `${boardNote}\n`}🏗️ The building is in order:\n${lines.join('\n')}\n-# Read-only rooms let people react, the count lets people type numbers, the archives are hidden from everyone but staff. Ping roles carry no permissions. Welcome messages now go to <#${door.ch.id}>.`;
}

// a line in the Texz ledger, quietly skipped when there isn't one
export async function botLog(guild: Guild, store: Store, text: string) {
  const id = store.getKv(`botlog:${guild.id}`);
  if (!id) return;
  const ch = await guild.channels.fetch(id).catch(() => null);
  if (ch?.isSendable()) await ch.send({ content: text.slice(0, 1900), allowedMentions: { parse: [] } }).catch(() => {});
}
