import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, type MessageActionRowComponentBuilder, type CategoryChannel, type Guild, type GuildBasedChannel, type GuildMember, type PermissionsString, type Role, type TextChannel, type VoiceChannel,
} from 'discord.js';
import { defaultRules, type Store } from '../db.js';
import { card } from '../theme.js';
import { fixText } from '../core/fixes.js';
import { staffRoles } from '../core/staff.js';
import { buildBoard, CATEGORY } from '../modules/bulletins.js';
import { confessIntro, countIntro, rooms } from '../modules/community.js';
import { pickerView } from '../modules/welcome.js';
import { liftColours } from '../modules/mycolour.js';
import { perkLine, ranks } from '../modules/levels.js';
import { DESK } from '../modules/predict.js';
import { HUB } from '../modules/booth.js';

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
  entrance: { name: '🚪┃the-entrance-exam', topic: 'Every Agency member passed it once. Press the button to walk in.' },
  rules: { name: '📜┃agency-rules', topic: 'The Agency\'s rules. Short, fair, and Kunikida will enforce every one of them.' },
  roles: { name: '🎭┃pick-your-roles', topic: 'Ping roles and name colours. Pick from the menus, unpick to drop.' },
  promotions: { name: '🎖️┃promotions', topic: 'Rank ups, posted by Texz. Every level is a step closer to Agency president.' },
  office: { name: '💬┃agency-office', topic: 'The general chat. Desks, coffee, Dazai asleep on the sofa. Talk about anything.' },
  evidence: { name: '📸┃evidence-board', topic: 'Pictures, clips, memes and screenshots. Evidence of everything.' },
  pokedex: { name: '🔴┃pokedex-bureau', topic: 'Pokétwo spawns and catching. Texz posts the name and the catch line under every spawn.' },
  cards: { name: '🃏┃card-vault', topic: 'Shoob card drops. Rare tiers ping the Shoob Rare Drops role.' },
  owo: { name: '🐾┃stray-dogs-den', topic: 'OwO hunting, battling and gambling. Texz keeps your timers.' },
  ranks: { name: '📈┃ranks-and-perks', topic: 'Every Agency rank, the level it takes and what it gets you, plus the special roles and how to earn them.' },
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
    everyone: { SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false, CreatePrivateThreads: false, AddReactions: true, ReadMessageHistory: true, UseApplicationCommands: false, MentionEveryone: false, SendTTSMessages: false },
    me: { ViewChannel: true, SendMessages: true, EmbedLinks: true, AttachFiles: true, AddReactions: true, ReadMessageHistory: true, ManageMessages: true, MentionEveryone: true, UseExternalEmojis: true },
  },
  // people type, no threads, files, stickers or polls getting in the way
  chat: {
    everyone: { SendMessages: true, ReadMessageHistory: true, AddReactions: false, CreatePublicThreads: false, CreatePrivateThreads: false, SendMessagesInThreads: false, AttachFiles: false, EmbedLinks: false, UseExternalStickers: false, SendVoiceMessages: false, SendPolls: false, UseApplicationCommands: false, MentionEveryone: false, SendTTSMessages: false },
    me: { ViewChannel: true, SendMessages: true, AddReactions: true, ReadMessageHistory: true, ManageMessages: true, EmbedLinks: true },
  },
  // a room for running commands: type and react, no threads or files
  bot: {
    everyone: { SendMessages: true, ReadMessageHistory: true, AddReactions: true, UseApplicationCommands: true, CreatePublicThreads: false, CreatePrivateThreads: false, SendMessagesInThreads: false, AttachFiles: false, SendVoiceMessages: false, SendPolls: false, MentionEveryone: false, SendTTSMessages: false },
    me: { ViewChannel: true, SendMessages: true, EmbedLinks: true, AttachFiles: true, AddReactions: true, ReadMessageHistory: true, ManageMessages: true, UseExternalEmojis: true },
  },
  // ordinary chat, everything a person normally does
  open: {
    everyone: { SendMessages: true, ReadMessageHistory: true, AddReactions: true, AttachFiles: true, EmbedLinks: true, UseExternalEmojis: true, UseExternalStickers: true, CreatePublicThreads: true, SendMessagesInThreads: true, MentionEveryone: false, SendTTSMessages: false },
    me: { ViewChannel: true, SendMessages: true, EmbedLinks: true, AttachFiles: true, AddReactions: true, ReadMessageHistory: true, ManageMessages: true, UseExternalEmojis: true },
  },
  // staff read, nobody else sees it
  private: {
    everyone: { ViewChannel: false, SendMessages: false },
    staff: { ViewChannel: true, ReadMessageHistory: true, SendMessages: false, AddReactions: true },
    me: { ViewChannel: true, SendMessages: true, EmbedLinks: true, AttachFiles: true, ReadMessageHistory: true },
  },
};

// who sees a room once the entrance exam is on: members only, newcomers only, or everyone
type Who = 'members' | 'guests' | 'all';

async function lock(store: Store, ch: CategoryChannel | TextChannel | VoiceChannel, me: GuildMember, mode: Mode, who: Who = 'members') {
  const l = locks[mode];
  const everyone = ch.guild.roles.everyone;
  const member = store.getKv(`verifyrole:${ch.guild.id}`);
  const gated = !!member && mode !== 'private';
  const view: Perms = gated ? { ViewChannel: who !== 'members' } : {};
  await ch.permissionOverwrites.edit(me.id, only(me, l.me)).catch(() => {});
  await ch.permissionOverwrites.edit(everyone, only(me, { ...l.everyone, ...view })).catch(() => {});
  if (gated && member && ch.guild.roles.cache.has(member)) {
    if (who === 'all') await ch.permissionOverwrites.delete(member).catch(() => {});
    else await ch.permissionOverwrites.edit(member, { ViewChannel: who === 'members' }).catch(() => {});
  }
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

async function room(guild: Guild, store: Store, cat: CategoryChannel, saved: string | null | undefined, spec: { name: string; topic: string }, mode: Mode, me: GuildMember, olds: string[] = [], who: Who = 'members') {
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
  await lock(store, text, me, mode, who);
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
  // right under Texz and above the rank roles, so the colour actually shows; personal roles go above the palette
  void me;
  const personal = store.kvByPrefix(`myrole:${guild.id}:`).map((x) => guild.roles.cache.get(x.value)).filter((r): r is Role => !!r);
  await liftColours(guild, store, [...personal, ...out]);
  return out;
}

// the two menus in the roles room, edited in place on every build so there's never a pile of old ones
async function rolePanels(store: Store, guild: Guild, ch: TextChannel, colours: Role[], info: { key: string; title: string; about: string; style: 'menu' | 'single'; roles: Role[] }[]) {
  const g = store.guild(guild.id);
  // the prediction desk gets its own ping role, so the morning calls don't get missed
  const oracle = await keptRole(store, guild, 'predict', 'Deduction Informant');
  if (oracle) store.setKv(`predrole:${guild.id}`, oracle.id);
  const pings = [
    g.bulletins.f1.role, g.bulletins.football.role, oracle?.id,
    store.getKv(`spawnrole:${guild.id}:p2rare`), store.getKv(`spawnrole:${guild.id}:shoobrare`),
  ].map((id) => (id ? guild.roles.cache.get(id) : undefined)).filter((r): r is Role => !!r && r.editable);
  const panels: [string, ReturnType<typeof pickerView>][] = [];
  if (pings.length) panels.push(['pings', pickerView('Informant roles', 'Pick the pings you want: race days, big matches, the morning prediction calls, rare spawns and rare drops. Pick as many as you like, unpick to drop one.', 'menu', pings)]);
  for (const set of info) panels.push([set.key, pickerView(set.title, set.about, set.style, set.roles)]);
  if (colours.length) panels.push(['colours', pickerView('Agency colours', 'One colour for your name. Pick another to swap, clear the menu to go plain.\n-# Want one nobody else has? `tz mycolour` sells you your own.', 'single', colours)]);
  for (const [key, view] of panels) {
    const kv = `rolepanel:${guild.id}:${key}`;
    const old = store.getKv(kv) ? await ch.messages.fetch(store.getKv(kv)!).catch(() => null) : null;
    const msg = old ? await old.edit({ ...view, allowedMentions: { parse: [] } }).catch(() => null) : await ch.send({ ...view, allowedMentions: { parse: [] } }).catch(() => null);
    if (msg) store.setKv(kv, msg.id);
  }
}

// a plain role Texz keeps track of by key, made when missing
async function keptRole(store: Store, guild: Guild, key: string, name: string) {
  const kv = `infor:${guild.id}:${key}`;
  const saved = store.getKv(kv);
  let r = (saved ? guild.roles.cache.get(saved) : undefined) ?? guild.roles.cache.find((x) => x.name === name);
  r ??= await guild.roles.create({ name, permissions: [], hoist: false, mentionable: false, reason: 'Agency layout roles' }).catch(() => undefined);
  if (r) store.setKv(kv, r.id);
  return r ?? null;
}

// the about-you menus in the roles room, each set kept by key
export const INFO: { key: string; title: string; about: string; style: 'menu' | 'single'; roles: [string, string][] }[] = [
  { key: 'pronouns', title: 'Pronouns', about: 'How people should refer to you. One at a time, picking another swaps it.', style: 'single', roles: [['he', 'He/Him'], ['she', 'She/Her'], ['they', 'They/Them'], ['any', 'Any pronouns'], ['ask', 'Ask my pronouns']] },
  { key: 'region', title: 'Which branch', about: 'Where in the world you are, so people know your time of day.', style: 'single', roles: [['asia', 'Asia Branch'], ['europe', 'Europe Branch'], ['namerica', 'North America Branch'], ['samerica', 'South America Branch'], ['africa', 'Africa Branch'], ['oceania', 'Oceania Branch']] },
  { key: 'dms', title: 'Direct line', about: 'Whether people can message you privately.', style: 'single', roles: [['open', 'Line Open'], ['ask', 'Knock First'], ['closed', 'Line Closed']] },
];

async function infoRoles(store: Store, guild: Guild) {
  const out: { key: string; title: string; about: string; style: 'menu' | 'single'; roles: Role[] }[] = [];
  for (const set of INFO) {
    const roles: Role[] = [];
    for (const [k, name] of set.roles) { const r = await keptRole(store, guild, `${set.key}:${k}`, name); if (r) roles.push(r); }
    if (roles.length) out.push({ ...set, roles });
  }
  return out;
}

// existing channels people could see stay visible to members only, private ones are left as they are
async function gateEverything(store: Store, guild: Guild, member: Role, skip: Set<string>) {
  const everyone = guild.roles.everyone;
  for (const c of guild.channels.cache.values()) {
    if (skip.has(c.id) || c.isThread() || !('permissionOverwrites' in c)) continue;
    // a channel that follows its category gets the category's lock
    if (c.parentId && 'permissionsLocked' in c && c.permissionsLocked && !skip.has(c.parentId)) continue;
    if (!c.permissionsFor(everyone)?.has('ViewChannel')) continue;
    await c.permissionOverwrites.edit(everyone, { ViewChannel: false }, { reason: 'members only after the entrance exam' }).catch(() => {});
    await c.permissionOverwrites.edit(member, { ViewChannel: true }, { reason: 'members only after the entrance exam' }).catch(() => {});
  }
}

// bots wear only their own role and the Black Lizard Unit, and the unit sees every room members see
export async function botAccess(store: Store, guild: Guild) {
  const unit = store.getKv(`botrole:${guild.id}`);
  const member = store.getKv(`verifyrole:${guild.id}`);
  if (!unit || !guild.roles.cache.has(unit)) return 0;
  let fixed = 0;
  if (member) {
    for (const c of guild.channels.cache.values()) {
      if (c.isThread() || !('permissionOverwrites' in c)) continue;
      const allow = c.permissionOverwrites.cache.get(member)?.allow.has('ViewChannel');
      const has = c.permissionOverwrites.cache.get(unit)?.allow.has('ViewChannel');
      if (allow && !has) { await c.permissionOverwrites.edit(unit, { ViewChannel: true }, { reason: 'bots see what members see' }).catch(() => {}); fixed++; }
    }
  }
  // rank roles, the member role and any join role come off the bots, the unit goes on
  const rewards = new Set(Object.values(store.guild(guild.id).levels.rewards ?? {}));
  const all = await guild.members.fetch().catch(() => null);
  for (const b of all?.filter((m) => m.user.bot && m.id !== guild.members.me?.id).values() ?? []) {
    if (!b.roles.cache.has(unit)) await b.roles.add(unit, 'bots join the Black Lizard').catch(() => {});
    for (const r of b.roles.cache.values()) if ((r.id === member || rewards.has(r.id)) && r.editable) await b.roles.remove(r, 'bots keep only their own role and the unit').catch(() => {});
  }
  return fixed;
}

// every rank with its level and perks, then the roles you get some other way
function ranksView(store: Store, guild: Guild, rolesRoom: string, patronRoom: string, yenRoom: string) {
  const rewards = store.guild(guild.id).levels.rewards ?? {};
  const roleOf = (at: number) => (rewards[String(at)] && guild.roles.cache.has(rewards[String(at)]) ? ` · <@&${rewards[String(at)]}>` : '');
  const member = store.getKv(`verifyrole:${guild.id}`);
  const unit = store.getKv(`botrole:${guild.id}`);
  const lines = ranks.map((r) => `${r.emoji} **${r.name}** · level ${r.at}${roleOf(r.at)}\n-# ${perkLine(r.name)}`);
  const special = [
    member ? `🕵️ <@&${member}> · pass the entrance exam` : null,
    `🎨 Agency colours · pick one in <#${rolesRoom}>`,
    `✨ A role of your own · \`tz mycolour buy #hex\` for ¥5,000 in <#${yenRoom}>, then any colour, name or icon`,
    `🔔 Informant pings, pronouns, region and DMs · <#${rolesRoom}>`,
    `💎 Server booster · boost the server, thanked in <#${patronRoom}>`,
    `🛍️ Shop roles · \`tz shop\` sells what the admins put up`,
    unit ? `🤖 <@&${unit}> · bots only` : null,
  ].filter(Boolean);
  return {
    embeds: [
      card({ kind: 'bulletin', title: '📈 Agency ranks and perks', emoji: '', gif: 'off', line: '', body: `Chatting earns xp, xp earns levels, levels earn ranks. Each rank shows as its own group in the member list.\n\n${lines.join('\n')}\n\n-# \`tz rank\` shows where you are, \`tz perks\` what's next.` }),
      card({ kind: 'bulletin', title: '🎖️ Special roles', emoji: '', gif: 'off', line: '', body: special.join('\n') }),
    ],
    allowedMentions: { parse: [] as never[] },
  };
}

export const entranceView = () => ({
  embeds: [card({ kind: 'bulletin', title: '🚪 The entrance exam', emoji: '', gif: 'off', line: '',
    body: 'Every member of the Agency passed this once. Atsushi nearly failed it, you\'ll be fine.\n\nRead the rules above, then press the button to walk in. The rest of the building opens up the moment you do.' })],
  components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(new ButtonBuilder().setCustomId('verify').setLabel('I passed the exam').setEmoji('🕵️').setStyle(ButtonStyle.Success))],
});

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

  // the entrance exam: newcomers see only the exam and the rules until they press the button
  const member = await keptRole(store, guild, 'member', 'Agency Member');
  if (member) store.setKv(`verifyrole:${guild.id}`, member.id);
  const g = store.guild(guild.id);
  const ex = await room(guild, store, front, store.getKv(`entrancech:${guild.id}`), extraRooms.entrance, 'read', me, ['verify', 'verification', 'entrance'], 'guests');
  const door = await room(guild, store, front, g.welcome.channel, extraRooms.arrivals, 'read', me, ['welcome', 'arrivals', 'new-recruits']);
  const ru = await room(guild, store, front, store.getKv(`rulesch:${guild.id}`), extraRooms.rules, 'read', me, ['rules', 'server-rules'], 'all');
  const ro = await room(guild, store, front, store.getKv(`rolesch:${guild.id}`), extraRooms.roles, 'read', me, ['roles', 'self-roles', 'reaction-roles', 'get-roles']);
  const rk = await room(guild, store, front, store.getKv(`ranksch:${guild.id}`), extraRooms.ranks, 'read', me, ['ranks', 'levels-info', 'perks']);
  const p = await room(guild, store, front, store.getKv(`boostch:${guild.id}`), extraRooms.patrons, 'read', me, ['boosts', 'boosters']);
  const pr = await room(guild, store, board, g.levels.channel, extraRooms.promotions, 'read', me, ['level-ups', 'levels', 'rank-ups']);
  const dk = await room(guild, store, board, store.getKv(`deskch:${guild.id}`), DESK, 'read', me, ['predictions', 'predict']);
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
    // join it and Texz builds you a private room of your own
    await voice(guild, store, lounge, 'booth', HUB),
  ];
  store.setKv(`boothhub:${guild.id}`, voices[voices.length - 1].id);

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
  // the old join role is replaced by the exam
  if (member) { const w = store.guild(guild.id); w.welcome.autorole = null; store.saveGuild(guild.id, w); }
  const kvs: [string, string][] = [
    [`entrancech:${guild.id}`, ex.ch.id],
    [`ranksch:${guild.id}`, rk.ch.id],
    [`deskch:${guild.id}`, dk.ch.id],
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
  const inside = [ex.ch.id, ru.ch.id, door.ch.id, ro.ch.id, rk.ch.id, p.ch.id, ...feeds, dk.ch.id, pr.ch.id, q.ch.id, a.ch.id, gen.ch.id, ev.ch.id, pk.ch.id, sh.ch.id, ow.ch.id, k.ch.id, y.ch.id, f.ch.id, o.ch.id, w.ch.id, l.ch.id];
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
  // every rank shows as its own group in the member list
  for (const id of Object.values(store.guild(guild.id).levels.rewards ?? {})) {
    const r = typeof id === 'string' ? guild.roles.cache.get(id) : undefined;
    if (r?.editable && !r.hoist) await r.setHoist(true, 'every rank gets its own spot in the member list').catch(() => {});
  }
  const colours = await colourRoles(store, guild, me);
  const info = await infoRoles(store, guild);
  await rolePanels(store, guild, ro.ch, colours, info);

  // the bots get a unit of their own, shown apart in the member list
  const unit = await keptRole(store, guild, 'bots', 'Black Lizard Unit');
  if (unit) {
    store.setKv(`botrole:${guild.id}`, unit.id);
    if (unit.editable && (!unit.hoist || unit.color !== 0x3a3a3a)) await unit.edit({ hoist: true, colors: { primaryColor: 0x3a3a3a }, reason: 'bot role' }).catch(() => {});
  }

  // everyone already here passes the exam automatically, bots too so they can still see their rooms
  let passed = 0;
  if (member) {
    const all = await guild.members.fetch().catch(() => null);
    for (const m of all?.values() ?? []) if (!m.user.bot && !m.roles.cache.has(member.id)) { if (await m.roles.add(member, 'already a member when the exam started').then(() => true).catch(() => false)) passed++; }
    // the categories: the front door is open to all, the rest to members
    const everyone = guild.roles.everyone;
    for (const cat of [board, bar, lounge]) {
      await cat.permissionOverwrites.edit(everyone, { ViewChannel: false }).catch(() => {});
      await cat.permissionOverwrites.edit(member, { ViewChannel: true }).catch(() => {});
    }
    for (const id of feeds) {
      const c = guild.channels.cache.get(id) as TextChannel | undefined;
      await c?.permissionOverwrites.edit(everyone, { ViewChannel: false }).catch(() => {});
      await c?.permissionOverwrites.edit(member, { ViewChannel: true }).catch(() => {});
    }
    for (const v of voices) await v.lockPermissions().catch(() => {});
    const done = new Set([front.id, board.id, bar.id, lounge.id, logs.id, ...inside, ...voices.map((v) => v.id)]);
    await gateEverything(store, guild, member, done);
  }
  await botAccess(store, guild);
  // the ranks room, edited in place so it's always current
  const rkMsg = await rk.ch.messages.fetch(store.getKv(`ranksmsg:${guild.id}`) ?? '0').catch(() => null);
  const rkView = ranksView(store, guild, ro.ch.id, p.ch.id, y.ch.id);
  const rkSent = rkMsg ? await rkMsg.edit(rkView).catch(() => null) : await rk.ch.send(rkView).catch(() => null);
  if (rkSent) store.setKv(`ranksmsg:${guild.id}`, rkSent.id);
  const old = await ex.ch.messages.fetch(store.getKv(`entrancemsg:${guild.id}`) ?? '0').catch(() => null);
  const sent = old ? await old.edit(entranceView()).catch(() => null) : await ex.ch.send(entranceView()).catch(() => null);
  if (sent) store.setKv(`entrancemsg:${guild.id}`, sent.id);

  if (door.fresh) await door.ch.send({ embeds: [card({ kind: 'bulletin', title: '🌸 The Agency front door', emoji: '', gif: 'off', body: `Everyone who walks in gets greeted here.\nRead <#${ru.ch.id}>, pick your roles in <#${ro.ch.id}>, then come say hi in <#${gen.ch.id}>.` })] }).catch(() => {});
  if (ru.fresh) await ru.ch.send({ embeds: [rulesCard(guild)] }).catch(() => {});
  if (dk.fresh) await dk.ch.send({ embeds: [card({ kind: 'bulletin', title: '🔮 Ranpo\'s deductions', emoji: '', gif: 'off', line: '', body: 'Every morning the day\'s big matches land here with buttons, and on race week the podium does too. Call it before kick-off or lights out.\nRight calls pay yen. `tz predict top` has the season\'s best.' })] }).catch(() => {});
  if (pr.fresh) await pr.ch.send({ embeds: [card({ kind: 'bulletin', title: '🎖️ Promotions', emoji: '', gif: 'off', body: 'Every rank up gets announced here. Chat, catch, quiz, and climb.\n`tz rank` shows where you stand.' })] }).catch(() => {});
  if (k.fresh) await k.ch.send(countIntro()).then((m) => m.pin().catch(() => {})).catch(() => {});
  if (f.fresh) await f.ch.send(confessIntro()).then((m) => m.pin().catch(() => {})).catch(() => {});
  if (pk.fresh) await pk.ch.send({ embeds: [card({ kind: 'bulletin', title: '🔴 Pokédex Bureau', emoji: '', gif: 'off', body: 'Pokétwo spawns land here. Texz names every one and hands you the catch line.\n-# Admins: run `@Pokétwo redirect` with this channel so every spawn comes here.' })] }).catch(() => {});
  if (sh.fresh) await sh.ch.send({ embeds: [card({ kind: 'bulletin', title: '🃏 Card Vault', emoji: '', gif: 'off', body: 'Shoob drops land here. Tier 5 and 6 ping the rare drop role, pick it up in the roles room.' })] }).catch(() => {});
  if (l.fresh) await l.ch.send({ embeds: [card({ kind: 'bulletin', title: '📓 Texz ledger', emoji: '', gif: 'off', body: 'Every settings change and every building job gets a line here, so staff can see who changed what.' })] }).catch(() => {});

  const lines = [
    `**${FLOORS.front}** · <#${ex.ch.id}> <#${ru.ch.id}> <#${door.ch.id}> <#${ro.ch.id}> <#${rk.ch.id}> <#${p.ch.id}>`,
    `**${FLOORS.board}** · ${feeds.map((x) => `<#${x}>`).join(' ')} <#${dk.ch.id}> <#${pr.ch.id}> <#${q.ch.id}> <#${a.ch.id}>`,
    `**${FLOORS.bar}** · <#${gen.ch.id}> <#${ev.ch.id}> <#${pk.ch.id}> <#${sh.ch.id}> <#${ow.ch.id}> <#${k.ch.id}> <#${y.ch.id}> <#${f.ch.id}>`,
    `**${FLOORS.lounge}** · ${voices.map((v) => `<#${v.id}>`).join(' ')}`,
    `**${FLOORS.logs}** · <#${o.ch.id}> <#${w.ch.id}> <#${l.ch.id}>, staff only`,
  ];
  void botLog(guild, store, `🏗️ The Agency layout was built or refreshed.\n${lines.join('\n')}`);
  return `${boardNote.startsWith('🕵️') ? '' : `${boardNote}\n`}🏗️ The building is in order:\n${lines.join('\n')}\n-# Notice rooms are read-only with reactions, chat rooms are open, bot rooms take commands but no threads or files, the archives are staff only. Ping and colour roles carry no permissions. Run \`@Pokétwo redirect #${pk.ch.name}\` once so spawns land in the bureau.${member ? `\n-# The entrance exam is on: newcomers see only <#${ex.ch.id}> and the rules until they press the button. ${passed} people already here got <@&${member.id}>.` : ''}`;
}

// a line in the Texz ledger, quietly skipped when there isn't one
export async function botLog(guild: Guild, store: Store, text: string) {
  const id = store.getKv(`botlog:${guild.id}`);
  if (!id) return;
  const ch = await guild.channels.fetch(id).catch(() => null);
  if (ch?.isSendable()) await ch.send({ content: text.slice(0, 1900), allowedMentions: { parse: [] } }).catch(() => {});
}
