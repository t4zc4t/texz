import {
  ChannelType, PermissionFlagsBits, type CategoryChannel, type Guild, type GuildBasedChannel, type GuildMember, type PermissionsString, type Role, type TextChannel, type VoiceChannel,
} from 'discord.js';
import { defaultRules, type Store } from '../db.js';
import { card } from '../theme.js';
import { fixText } from '../core/fixes.js';
import { staffRoles } from '../core/staff.js';
import { buildBoard, CATEGORY } from '../modules/bulletins.js';
import { confessIntro, countIntro, rooms } from '../modules/community.js';
import { pickerView } from '../modules/welcome.js';

// the whole Texz corner of a server in one go: a front door, the bulletin board, the bar and the archives, each with the right locks

export const FLOORS = {
  front: '🚪 Agency Front Door',
  board: CATEGORY,
  bar: '🥃 Bar Lupin',
  lounge: '🎙️ Lupin Lounge',
  logs: '🗄️ Port Mafia Archives',
} as const;

export const extraRooms = {
  arrivals: { name: '🌸┃new-recruits', topic: 'Newcomers walk in here. Dazai greets them, Kunikida writes their name down.' },
  rules: { name: '📜┃agency-rules', topic: 'The Agency\'s rules. Short, fair, and Kunikida will enforce every one of them.' },
  roles: { name: '🎭┃pick-your-roles', topic: 'Ping roles and name colours. Pick from the menus, unpick to drop.' },
  promotions: { name: '🎖️┃promotions', topic: 'Rank ups, posted by Texz. Every level is a step closer to Agency president.' },
  office: { name: '💬┃agency-office', topic: 'The general chat. Desks, coffee, Dazai asleep on the sofa. Talk about anything.' },
  evidence: { name: '📸┃evidence-board', topic: 'Pictures, clips, memes and screenshots. Evidence of everything.' },
  pokedex: { name: '🔴┃pokedex-bureau', topic: 'Pokétwo spawns and catching. Texz posts the name and the catch line under every spawn.' },
  cards: { name: '🃏┃card-vault', topic: 'Shoob card drops. Rare tiers ping the Shoob Rare Drops role.' },
  owo: { name: '🐾┃stray-dogs-den', topic: 'OwO hunting, battling and gambling. Texz keeps your timers.' },
  patrons: { name: '💎┃agency-patrons', topic: 'Everyone who boosts the server gets thanked here. Their names go on the good page of Kunikida\'s notebook.' },
  yen: { name: '💴┃the-yen-counter', topic: 'Daily yen, wallets, giving, the rich list and the role shop. Yen commands only work here, so the rest of the server stays quiet.' },
  orders: { name: '⚖️┃executive-orders', topic: 'Warnings, timeouts, kicks, bans and automod, filed by Texz. Staff only.' },
  watch: { name: '👁️┃black-lizard-watch', topic: 'Joins, leaves, edited and deleted messages. Staff only.' },
  ledger: { name: '📓┃texz-ledger', topic: 'What Texz did and what admins changed in its settings. Staff only.' },
} as const;

type Mode = 'read' | 'chat' | 'bot' | 'open' | 'private';
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
  // ordinary chat, everything a person normally does
  open: {
    everyone: { SendMessages: true, ReadMessageHistory: true, AddReactions: true, AttachFiles: true, EmbedLinks: true, UseExternalEmojis: true, UseExternalStickers: true, CreatePublicThreads: true, SendMessagesInThreads: true },
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
    g.bulletins.f1.role, g.bulletins.football.role,
  ].filter((x): x is string => !!x);
  for (const id of new Set(ids)) {
    const r = guild.roles.cache.get(id);
    if (!r?.editable || r.managed) continue;
    if (r.permissions.bitfield !== 0n || r.hoist || r.mentionable) await r.edit({ permissions: [], hoist: false, mentionable: false, reason: 'Texz ping roles carry no permissions' }).catch(() => {});
  }
}

// name colours in the Agency's palette, one at a time
export const COLOURS: [string, number][] = [
  ['Dazai Sand', 0xc8a97e], ['Chuuya Wine', 0x9b2335], ['Atsushi Tiger', 0xe9c46a], ['Akutagawa Ink', 0x6c5b7b], ['Kyouka Plum', 0xb4609a],
  ['Ranpo Teal', 0x3fa7a3], ['Yosano Butterfly', 0xe07a9f], ['Kunikida Green', 0x6a994e], ['Bloodmoon Red', 0xe8475b], ['Bandage White', 0xede6da],
];

async function colourRoles(store: Store, guild: Guild, me: GuildMember) {
  const out: Role[] = [];
  for (const [name, color] of COLOURS) {
    const saved = store.getKv(`colour:${guild.id}:${name}`);
    let r = (saved ? guild.roles.cache.get(saved) : undefined) ?? guild.roles.cache.find((x) => x.name === name);
    r ??= await guild.roles.create({ name, colors: { primaryColor: color }, permissions: [], hoist: false, mentionable: false, reason: 'Agency colour roles' }).catch(() => undefined);
    if (!r) continue;
    store.setKv(`colour:${guild.id}:${name}`, r.id);
    out.push(r);
  }
  // right under Texz, so the colour wins over plainer roles
  const top = me.roles.highest.position - 1;
  await guild.roles.setPositions(out.filter((r) => r.editable).map((r, n) => ({ role: r.id, position: Math.max(1, top - n) }))).catch(() => {});
  return out;
}

// the two menus in the roles room, edited in place on every build so there's never a pile of old ones
async function rolePanels(store: Store, guild: Guild, ch: TextChannel, colours: Role[]) {
  const g = store.guild(guild.id);
  const pings = [
    g.bulletins.f1.role, g.bulletins.football.role,
    store.getKv(`spawnrole:${guild.id}:p2rare`), store.getKv(`spawnrole:${guild.id}:shoobrare`),
  ].map((id) => (id ? guild.roles.cache.get(id) : undefined)).filter((r): r is Role => !!r && r.editable);
  const panels: [string, ReturnType<typeof pickerView>][] = [];
  if (pings.length) panels.push(['pings', pickerView('Informant roles', 'Pick the pings you want. Race days, big matches, rare spawns and rare drops. Unpick to drop one.', 'menu', pings)]);
  if (colours.length) panels.push(['colours', pickerView('Agency colours', 'One colour for your name. Pick another to swap, clear the menu to go plain.', 'single', colours)]);
  for (const [key, view] of panels) {
    const kv = `rolepanel:${guild.id}:${key}`;
    const old = store.getKv(kv) ? await ch.messages.fetch(store.getKv(kv)!).catch(() => null) : null;
    const msg = old ? await old.edit({ ...view, allowedMentions: { parse: [] } }).catch(() => null) : await ch.send({ ...view, allowedMentions: { parse: [] } }).catch(() => null);
    if (msg) store.setKv(kv, msg.id);
  }
}

const RULES = [
  ['Respect everyone', 'No harassment, slurs, hate or personal attacks. Even the Port Mafia has a code.'],
  ['Keep it safe for work', 'No NSFW, gore or anything you wouldn\'t show Kyouka.'],
  ['No spam', 'No floods, chain pings, ads or self-promo without asking staff first.'],
  ['Right room, right thing', 'Bots in their dens in Bar Lupin, yen in the yen counter, numbers in the count. The rooms say what they\'re for.'],
  ['Spoilers go in tags', 'Anime, manga, F1 or football, wrap it in ||spoiler tags|| for a while after it airs.'],
  ['Discord\'s rules apply', 'Follow the Discord Terms of Service and Community Guidelines.'],
  ['Staff have the final word', 'Questions about a decision go to staff in private, not in the general chat.'],
];
const rulesCard = (guild: Guild) => card({
  kind: 'bulletin', title: `📜 The rules of ${guild.name}`, emoji: '', gif: 'off',
  body: `${RULES.map(([t, b], n) => `**${n + 1}. ${t}**\n${b}`).join('\n\n')}\n\n-# Break them and Kunikida writes your name down. Break them twice and it goes to the Port Mafia.`,
});

async function voice(guild: Guild, store: Store, cat: CategoryChannel, key: string, name: string, olds: string[] = []) {
  const kv = `voice:${guild.id}:${key}`;
  const saved = store.getKv(kv);
  let v = (saved ? guild.channels.cache.get(saved) : undefined) as VoiceChannel | undefined;
  v ??= guild.channels.cache.find((c): c is VoiceChannel => c.type === ChannelType.GuildVoice && (c.name === name || olds.includes(c.name)));
  if (v) {
    if (v.parentId !== cat.id) await v.setParent(cat.id, { lockPermissions: true }).catch(() => {});
    if (v.name !== name) await v.setName(name).catch(() => {});
  }
  v ??= await guild.channels.create({ name, type: ChannelType.GuildVoice, parent: cat.id, reason: 'Agency layout from /setup' });
  store.setKv(kv, v.id);
  return v;
}

export async function buildAgency(store: Store, guild: Guild): Promise<string> {
  const me = await guild.members.fetchMe();
  const need: PermissionsString[] = ['ManageChannels', 'ManageRoles'];
  if (!me.permissions.has(need)) return fixText(guild, { perms: need, doing: 'lay the server out' }) ?? 'I need Manage Channels and Manage Roles to lay the server out.';
  await guild.channels.fetch().catch(() => null);

  // the bulletin board first, it brings its own channels and the F1 and football ping roles
  const boardNote = await buildBoard(store, guild);
  const front = await floor(guild, store, 'front', me);
  const board = await floor(guild, store, 'board', me);
  const bar = await floor(guild, store, 'bar', me, ['🍸 Lupin Bar']);
  const lounge = await floor(guild, store, 'lounge', me);
  const logs = await floor(guild, store, 'logs', me);

  const g = store.guild(guild.id);
  const door = await room(guild, store, front, g.welcome.channel, extraRooms.arrivals, 'read', me, ['welcome', 'arrivals', 'new-recruits']);
  const ru = await room(guild, store, front, store.getKv(`rulesch:${guild.id}`), extraRooms.rules, 'read', me, ['rules', 'server-rules']);
  const ro = await room(guild, store, front, store.getKv(`rolesch:${guild.id}`), extraRooms.roles, 'read', me, ['roles', 'self-roles', 'reaction-roles', 'get-roles']);
  const p = await room(guild, store, front, store.getKv(`boostch:${guild.id}`), extraRooms.patrons, 'read', me, ['boosts', 'boosters']);
  const pr = await room(guild, store, board, g.levels.channel, extraRooms.promotions, 'read', me, ['level-ups', 'levels', 'rank-ups']);
  const q = await room(guild, store, board, g.quotes.channel, rooms.quotes, 'read', me, ['quotes', 'make-it-a-quote', 'quote-wall']);
  const a = await room(guild, store, board, g.starboard.channel, rooms.archive, 'read', me, ['starboard']);
  const gen = await room(guild, store, bar, store.getKv(`generalch:${guild.id}`), extraRooms.office, 'open', me, ['general', 'chat', 'general-chat']);
  const ev = await room(guild, store, bar, store.getKv(`mediach:${guild.id}`), extraRooms.evidence, 'open', me, ['media', 'memes', 'pics']);
  const countSaved = (JSON.parse(store.getKv(`count:${guild.id}`) ?? '{}') as { channel?: string }).channel;
  const k = await room(guild, store, bar, countSaved, rooms.count, 'chat', me, ['counting', 'count']);
  const y = await room(guild, store, bar, store.rules(guild.id, 'economy').channels[0], extraRooms.yen, 'bot', me, ['economy', 'yen', 'bank']);
  const f = await room(guild, store, bar, store.getKv(`confessch:${guild.id}`), rooms.confess, 'read', me, ['confessions', 'confess']);
  const pk = await room(guild, store, bar, store.getKv(`dench:${guild.id}:p2`), extraRooms.pokedex, 'bot', me, ['poketwo', 'pokemon', 'pokemon-spawns', 'spawns']);
  const sh = await room(guild, store, bar, store.getKv(`dench:${guild.id}:shoob`), extraRooms.cards, 'bot', me, ['shoob', 'shoob-spawns', 'cards']);
  const ow = await room(guild, store, bar, store.getKv(`dench:${guild.id}:owo`), extraRooms.owo, 'bot', me, ['owo', 'owo-bot', 'hunting']);
  const o = await room(guild, store, logs, g.mod.logChannel, extraRooms.orders, 'private', me, ['mod-log', 'modlog', 'mod-logs']);
  const w = await room(guild, store, logs, store.getKv(`serverlog:${guild.id}`), extraRooms.watch, 'private', me, ['server-log', 'logs']);
  const l = await room(guild, store, logs, store.getKv(`botlog:${guild.id}`), extraRooms.ledger, 'private', me, ['bot-log', 'texz-log']);
  const voices = [
    await voice(guild, store, lounge, 'bar', '🥃 Bar Lupin', ['General', 'general', 'Lounge']),
    await voice(guild, store, lounge, 'night', '🌙 Late Night Shift'),
    await voice(guild, store, lounge, 'mission', '🎮 Mission Room', ['Gaming', 'gaming']),
    await voice(guild, store, lounge, 'watch', '🎬 Watch Party', ['Movies', 'movie-night']),
  ];

  // every Texz setting points at the new rooms
  const fresh = store.guild(guild.id);
  fresh.welcome.channel = door.ch.id;
  fresh.welcome.goodbyeChannel = door.ch.id;
  fresh.levels.channel = pr.ch.id;
  fresh.quotes.channel = q.ch.id;
  fresh.starboard.channel = a.ch.id;
  if (fresh.starboard.min < 5) fresh.starboard.min = 5;
  fresh.mod.logChannel = o.ch.id;
  // yen commands only answer in their own room, admins can still use them anywhere
  fresh.modules.economy = { ...defaultRules('economy'), ...fresh.modules.economy, channels: [y.ch.id] };
  store.saveGuild(guild.id, fresh);
  const kvs: [string, string][] = [
    [`boostch:${guild.id}`, p.ch.id], [`rulesch:${guild.id}`, ru.ch.id], [`rolesch:${guild.id}`, ro.ch.id], [`generalch:${guild.id}`, gen.ch.id], [`mediach:${guild.id}`, ev.ch.id],
    [`dench:${guild.id}:p2`, pk.ch.id], [`dench:${guild.id}:shoob`, sh.ch.id], [`dench:${guild.id}:owo`, ow.ch.id],
    [`confessch:${guild.id}`, f.ch.id], [`serverlog:${guild.id}`, w.ch.id], [`botlog:${guild.id}`, l.ch.id],
  ];
  for (const [key, v] of kvs) store.setKv(key, v);
  const c = { channel: null, n: 0, last: null, best: 0, ...JSON.parse(store.getKv(`count:${guild.id}`) ?? '{}') };
  c.channel = k.ch.id;
  store.setKv(`count:${guild.id}`, JSON.stringify(c));

  // inside each floor in reading order
  const feeds = [g.bulletins.f1.channel, g.bulletins.football.channel, g.bulletins.anime.channel].filter((x): x is string => !!x);
  const inside = [door.ch.id, ru.ch.id, ro.ch.id, p.ch.id, ...feeds, pr.ch.id, q.ch.id, a.ch.id, gen.ch.id, ev.ch.id, pk.ch.id, sh.ch.id, ow.ch.id, k.ch.id, y.ch.id, f.ch.id, o.ch.id, w.ch.id, l.ch.id];
  await guild.channels.setPositions([...inside, ...voices.map((v) => v.id)].map((id, n) => ({ channel: id, position: n }))).catch(() => {});

  // the front door at the very top, the bulletin board second, the archives at the very bottom
  // the office and the grounds from an earlier build moved into the bar, their empty categories go
  for (const key of ['office', 'grounds']) {
    const id = store.getKv(`floor:${guild.id}:${key}`);
    const old = id ? guild.channels.cache.get(id) as CategoryChannel | undefined : undefined;
    if (old && old.children.cache.size === 0) await old.delete('merged into Bar Lupin').catch(() => {});
    if (id) store.setKv(`floor:${guild.id}:${key}`, null);
  }
  const ours = [front.id, board.id, bar.id, lounge.id];
  const rest = [...guild.channels.cache.filter((x) => x.type === ChannelType.GuildCategory && !ours.includes(x.id) && x.id !== logs.id).values()]
    .sort((x, y) => (x as CategoryChannel).rawPosition - (y as CategoryChannel).rawPosition).map((x) => x.id);
  await guild.channels.setPositions([...ours, ...rest, logs.id].map((id, n) => ({ channel: id, position: n }))).catch(() => {});

  await tidyRoles(store, guild);
  const colours = await colourRoles(store, guild, me);
  await rolePanels(store, guild, ro.ch, colours);

  if (door.fresh) await door.ch.send({ embeds: [card({ kind: 'bulletin', title: '🌸 The Agency front door', emoji: '', gif: 'off', body: `Everyone who walks in gets greeted here.\nRead <#${ru.ch.id}>, pick your roles in <#${ro.ch.id}>, then come say hi in <#${gen.ch.id}>.` })] }).catch(() => {});
  if (ru.fresh) await ru.ch.send({ embeds: [rulesCard(guild)] }).catch(() => {});
  if (pr.fresh) await pr.ch.send({ embeds: [card({ kind: 'bulletin', title: '🎖️ Promotions', emoji: '', gif: 'off', body: 'Every rank up gets announced here. Chat, catch, quiz, and climb.\n`tz rank` shows where you stand.' })] }).catch(() => {});
  if (k.fresh) await k.ch.send(countIntro()).then((m) => m.pin().catch(() => {})).catch(() => {});
  if (f.fresh) await f.ch.send(confessIntro()).then((m) => m.pin().catch(() => {})).catch(() => {});
  if (pk.fresh) await pk.ch.send({ embeds: [card({ kind: 'bulletin', title: '🔴 Pokédex Bureau', emoji: '', gif: 'off', body: 'Pokétwo spawns land here. Texz names every one and hands you the catch line.\n-# Admins: run `@Pokétwo redirect` with this channel so every spawn comes here.' })] }).catch(() => {});
  if (sh.fresh) await sh.ch.send({ embeds: [card({ kind: 'bulletin', title: '🃏 Card Vault', emoji: '', gif: 'off', body: 'Shoob drops land here. Tier 5 and 6 ping the rare drop role, pick it up in the roles room.' })] }).catch(() => {});
  if (l.fresh) await l.ch.send({ embeds: [card({ kind: 'bulletin', title: '📓 Texz ledger', emoji: '', gif: 'off', body: 'Every settings change and every building job gets a line here, so staff can see who changed what.' })] }).catch(() => {});

  const lines = [
    `**${FLOORS.front}** · <#${door.ch.id}> <#${ru.ch.id}> <#${ro.ch.id}> <#${p.ch.id}>`,
    `**${FLOORS.board}** · ${feeds.map((x) => `<#${x}>`).join(' ')} <#${pr.ch.id}> <#${q.ch.id}> <#${a.ch.id}>`,
    `**${FLOORS.bar}** · <#${gen.ch.id}> <#${ev.ch.id}> <#${pk.ch.id}> <#${sh.ch.id}> <#${ow.ch.id}> <#${k.ch.id}> <#${y.ch.id}> <#${f.ch.id}>`,
    `**${FLOORS.lounge}** · ${voices.map((v) => `<#${v.id}>`).join(' ')}`,
    `**${FLOORS.logs}** · <#${o.ch.id}> <#${w.ch.id}> <#${l.ch.id}>, staff only`,
  ];
  void botLog(guild, store, `🏗️ The Agency layout was built or refreshed.\n${lines.join('\n')}`);
  return `${boardNote.startsWith('🕵️') ? '' : `${boardNote}\n`}🏗️ The building is in order:\n${lines.join('\n')}\n-# Notice rooms are read-only with reactions, chat rooms are open, bot rooms take commands but no threads or files, the archives are staff only. Ping and colour roles carry no permissions. Run \`@Pokétwo redirect #${pk.ch.name}\` once so spawns land in the bureau.`;
}

// a line in the Texz ledger, quietly skipped when there isn't one
export async function botLog(guild: Guild, store: Store, text: string) {
  const id = store.getKv(`botlog:${guild.id}`);
  if (!id) return;
  const ch = await guild.channels.fetch(id).catch(() => null);
  if (ch?.isSendable()) await ch.send({ content: text.slice(0, 1900), allowedMentions: { parse: [] } }).catch(() => {});
}
