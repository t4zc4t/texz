import { booth } from './booth.js';
import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, GuildVerificationLevel, MessageFlags, SlashCommandBuilder,
  type Client, type Guild, type Interaction, type Message, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import { bar, card, pick, say } from '../theme.js';
import { profile } from './profile.js';
import { ship } from './ship.js';
import { f1Quiz, f1Today, f1Trivia } from './bulletins.js';
import { guess } from './anime.js';
import { crestQuiz } from './f1quiz.js';
import { quote } from './quote.js';
import { achievements, mission } from './missions.js';

const unix = (ms: number) => Math.floor(ms / 1000);

type Look = 'server' | 'main' | 'banner';

// one mugshot card that can flip between the server picture, the main one and the banner
export async function mugshot(guild: Guild | null, client: Client, targetId: string, look: Look) {
  const member = guild ? await guild.members.fetch(targetId).catch(() => null) : null;
  const user = await client.users.fetch(targetId, { force: true }).catch(() => null);
  if (!user) return null;
  const hasServer = !!member?.avatar;
  const hasBanner = !!user.banner;
  const pickLook: Look = look === 'server' && !hasServer ? 'main' : look === 'banner' && !hasBanner ? 'main' : look;
  const hash = pickLook === 'server' ? member!.avatar! : pickLook === 'banner' ? user.banner! : user.avatar ?? '';
  const animated = hash.startsWith('a_');
  // animated pictures keep moving as long as the gif version is asked for
  const opts = { size: 1024, extension: animated ? 'gif' : 'png', forceStatic: false } as const;
  const url = pickLook === 'server' ? member!.avatarURL(opts)! : pickLook === 'banner' ? user.bannerURL(opts)! : user.displayAvatarURL(opts);
  const labels: Record<Look, string> = { server: 'server picture', main: 'main picture', banner: 'banner' };
  const e = card({
    kind: 'avatar', title: `Mugshot · ${member?.displayName ?? user.globalName ?? user.username}`, emoji: '🖼️', gif: 'off',
    body: `${labels[pickLook]}${animated ? ' · ✨ animated' : ''} · [open full size](${url})`,
  }).setImage(url);
  const btn = (l: Look, label: string, emoji: string, ok: boolean) => new ButtonBuilder().setCustomId(`av|${targetId}|${l}`)
    .setLabel(label).setEmoji(emoji).setStyle(l === pickLook ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(!ok || l === pickLook);
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    btn('server', 'Server', '🏠', hasServer),
    btn('main', 'Main', '👤', true),
    btn('banner', 'Banner', '🎏', hasBanner),
  );
  return { embeds: [e], components: [row] };
}

const avatar: Command = {
  name: 'avatar',
  group: 'you',
  hidden: true,
  data: new SlashCommandBuilder().setName('avatar').setDescription('Someone\'s picture, server or main, animated ones included')
    .addUserOption((o) => o.setName('user').setDescription('Whose, yours if empty')).toJSON(),
  text: { aliases: ['av', 'pfp', 'mugshot'], args: ['user'] },
  run: async (ctx) => {
    const id = ctx.user('user') ?? ctx.userId;
    const client = ctx.guild?.client;
    if (!client) return ctx.reply('That works inside a server.');
    const view = await mugshot(ctx.guild, client, id, 'server');
    if (!view) return ctx.reply('I can\'t find that person. Even I have limits.');
    return ctx.reply({ ...view, private: false });
  },
};

export async function onAvatarButton(i: Interaction) {
  if (!i.isButton() || !i.customId.startsWith('av|')) return false;
  const [, id, look] = i.customId.split('|');
  const view = await mugshot(i.guild, i.client, id, look as Look);
  if (view) await i.update(view);
  return true;
}

// little conclusions Texz draws from what he can see, the detective part of the dossier
function deduce(facts: {
  ageDays: number; joinedDays: number | null; position: number | null; messages: number; lastAt: number | null;
  admin: boolean; animated: boolean; bot: boolean; activity: string | null; boosting: boolean; roles: number;
}): string[] {
  const out: string[] = [];
  if (facts.bot) out.push('A bot. One of my kind, sort of. Less charming, obviously.');
  if (facts.ageDays < 30) out.push('A very fresh account. Barely a month old. Suspicious~');
  else if (facts.ageDays > 365 * 5) out.push('A Discord veteran. Probably remembers when it was only for gamers.');
  if (facts.position !== null && facts.position <= 10) out.push(`Joined #${facts.position}. Practically part of the furniture here.`);
  else if (facts.joinedDays !== null && facts.joinedDays < 7) out.push('Arrived this week. Still learning where the crab is kept.');
  if (facts.admin) out.push('Holds the keys to this place. Be nice to them.');
  if (facts.boosting) out.push('Pays to boost the server. Generous, or trying to buy loyalty. Both work.');
  if (facts.activity) out.push(`Currently ${facts.activity}. Clearly avoiding their duties. A kindred spirit.`);
  if (facts.lastAt && Date.now() - facts.lastAt < 10 * 60_000) out.push('Spoke here minutes ago. The trail is still warm.');
  if (facts.messages > 1000) out.push('Talks a lot. I like them already.');
  else if (facts.messages === 0) out.push('Hasn\'t said a word where I could hear. The quiet ones always know the most.');
  if (facts.animated) out.push('Animated avatar. Taste, or vanity? I\'d say both.');
  if (facts.roles > 10) out.push('Collects roles like I collect excuses.');
  if (!out.length) out.push('Perfectly ordinary. Which is exactly what someone with secrets would want me to think~');
  return out.slice(0, 3);
}

// the full member list is only needed for join order, so it's fetched at most every 10 minutes per server
const lists = new Map<string, { at: number; members: Map<string, number> }>();
async function memberList(guild: Guild) {
  const hit = lists.get(guild.id);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.members;
  const fetched = await guild.members.fetch().catch(() => null);
  if (!fetched) return hit?.members ?? null;
  const members = new Map([...fetched.values()].map((m) => [m.id, m.joinedTimestamp ?? 0]));
  lists.set(guild.id, { at: Date.now(), members });
  return members;
}

const user: Command = {
  name: 'user',
  group: 'you',
  data: new SlashCommandBuilder().setName('user').setDescription('Texz opens a dossier on someone, deductions included')
    .addUserOption((o) => o.setName('user').setDescription('Who, you if empty')).toJSON(),
  text: { aliases: ['whois', 'ui', 'dossier'], args: ['user'] },
  run: async (ctx, store) => {
    if (!ctx.guild) return ctx.reply('That works inside a server.');
    const m = await ctx.guild.members.fetch(ctx.user('user') ?? ctx.userId).catch(() => null);
    if (!m) return ctx.reply('Nobody by that name here. Either they left, or they\'re very good at hiding.');
    const u = await m.user.fetch(true).catch(() => m.user);
    const all = await memberList(ctx.guild);
    const position = all && m.joinedTimestamp ? [...all.values()].filter((t) => t < m.joinedTimestamp!).length + 1 : null;
    const roles = m.roles.cache.filter((r) => r.id !== ctx.guild!.id).sort((a, b) => b.position - a.position);
    const act = store.activity(ctx.guild.id, m.id);
    const presence = m.presence;
    const doing = presence?.activities.find((x) => x.type !== 4);
    const activityText = doing ? `${['playing', 'streaming', 'listening to', 'watching', '', 'competing in'][doing.type] ?? 'doing'} ${doing.name}`.trim() : null;
    const statusIcon: Record<string, string> = { online: '🟢 online', idle: '🌙 idle', dnd: '⛔ do not disturb', offline: '⚫ offline' };
    const badges = u.flags?.toArray().map((f) => f.replace(/([a-z])([A-Z])/g, '$1 $2')) ?? [];
    const ageDays = Math.floor((Date.now() - u.createdTimestamp) / 86_400_000);
    const joinedDays = m.joinedTimestamp ? Math.floor((Date.now() - m.joinedTimestamp) / 86_400_000) : null;
    const lines = deduce({
      ageDays, joinedDays, position, messages: act?.messages ?? 0, lastAt: act?.last_at ?? null,
      admin: m.permissions.has('Administrator'), animated: !!(m.avatar ?? u.avatar)?.startsWith('a_'), bot: u.bot,
      activity: activityText, boosting: !!m.premiumSince, roles: roles.size,
    });
    const e = card({
      kind: 'user', title: `Dossier · ${m.displayName}`, emoji: '🗃️', gif: 'off', color: m.displayColor || undefined,
      body: `🔎 **Deductions**\n${lines.map((l) => `> ${l}`).join('\n')}`,
      fields: [
        { name: '🪪 Identity', value: `${u.username}${u.globalName && u.globalName !== m.displayName ? ` · ${u.globalName}` : ''}\n\`${u.id}\``, inline: true },
        { name: '📡 Right now', value: `${statusIcon[presence?.status ?? 'offline'] ?? '⚫ offline'}${activityText ? `\n${activityText}` : ''}`, inline: true },
        { name: '👣 Last seen', value: act ? `<t:${unix(act.last_at)}:R>${act.last_channel ? ` in <#${act.last_channel}>` : ''}\n${act.messages.toLocaleString()} messages heard` : 'not by me', inline: true },
        { name: '🎂 Account', value: `<t:${unix(u.createdTimestamp)}:D>\n${ageDays.toLocaleString()} days old`, inline: true },
        { name: '🚪 Joined here', value: m.joinedTimestamp ? `<t:${unix(m.joinedTimestamp)}:D>${position ? `\n#${position} to join` : ''}` : '?', inline: true },
        { name: '💎 Boosting', value: m.premiumSince ? `since <t:${unix(m.premiumSince.getTime())}:D>` : 'no', inline: true },
        { name: `🎭 Roles · ${roles.size}`, value: roles.size ? roles.first(10).map((r) => `<@&${r.id}>`).join(' ') : 'none', inline: false },
        ...(badges.length ? [{ name: '🏅 Badges', value: badges.join(' · '), inline: false }] : []),
      ],
    }).setThumbnail(m.displayAvatarURL({ size: 256, forceStatic: false }));
    const banner = u.bannerURL({ size: 1024, forceStatic: false });
    if (banner) e.setImage(banner);
    const av = new ButtonBuilder().setCustomId(`nav|avatar|owner=${ctx.userId},user=${m.id}`).setEmoji('🖼️').setLabel('Avatar').setStyle(ButtonStyle.Secondary);
    return ctx.reply({ embeds: [e], components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(av)], private: false });
  },
};

const server: Command = {
  name: 'server',
  group: 'you',
  data: new SlashCommandBuilder().setName('server').setDescription('An inspection of this server: who\'s here, how busy it is, what it\'s made of').toJSON(),
  text: { aliases: ['si', 'guild'] },
  run: async (ctx, store) => {
    const g = ctx.guild;
    if (!g) return ctx.reply('That works inside a server.');
    const [owner, counted] = await Promise.all([
      g.fetchOwner().catch(() => null),
      g.client.guilds.fetch({ guild: g.id, withCounts: true, force: true }).catch(() => null),
    ]);
    await memberList(g);
    const channels = g.channels.cache;
    const bots = g.members.cache.filter((m) => m.user.bot).size;
    const online = counted?.approximatePresenceCount ?? null;
    const inVoice = g.voiceStates.cache.filter((v) => !!v.channelId && !v.member?.user.bot).size;
    const day = new Date().toISOString().slice(0, 10);
    const week = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    const today = store.dayTotals(g.id, 'msg', day)[0]?.n ?? 0;
    const perDay = store.dayTotals(g.id, 'msg', week);
    const avg = perDay.length ? Math.round(perDay.reduce((a, b) => a + b.n, 0) / perDay.length) : 0;
    const busiest = store.keyTotals(g.id, 'msg', day, 1)[0];
    const joins = store.dayTotals(g.id, 'join', week).reduce((a, b) => a + b.n, 0);
    const leaves = store.dayTotals(g.id, 'leave', week).reduce((a, b) => a + b.n, 0);
    const ageDays = Math.floor((Date.now() - g.createdTimestamp) / 86_400_000);
    const levels = { [GuildVerificationLevel.None]: 'none', [GuildVerificationLevel.Low]: 'low', [GuildVerificationLevel.Medium]: 'medium', [GuildVerificationLevel.High]: 'high', [GuildVerificationLevel.VeryHigh]: 'highest' } as Record<number, string>;
    // Texz sizes the place up before the numbers
    const mood = today > avg * 1.3 && avg > 20 ? 'Busier than usual today. Something is going on, and I intend to find out what.'
      : online !== null && online / Math.max(1, g.memberCount) > 0.4 ? 'Half the building is awake. Unusual. Suspicious, even.'
      : today === 0 ? 'Quiet as a stakeout. Nobody has said a word today.'
      : ageDays > 365 * 3 ? 'An old establishment. The walls have heard a lot.'
      : 'A respectable establishment. Could use more crab.';
    const e = card({
      kind: 'server', title: `Establishment report · ${g.name}`, emoji: '🏛️', gif: 'off',
      body: `*${mood}*`,
      fields: [
        { name: '👑 Owner', value: owner ? `<@${owner.id}>` : '?', inline: true },
        { name: '👥 Members', value: `${g.memberCount.toLocaleString()}${bots ? `\n${(g.memberCount - bots).toLocaleString()} people · ${bots} bots` : ''}`, inline: true },
        { name: '📡 Right now', value: `${online !== null ? `🟢 ${online.toLocaleString()} online` : '?'}${inVoice ? `\n🎙️ ${inVoice} in voice` : ''}`, inline: true },
        { name: '💬 Today', value: `${today.toLocaleString()} messages${avg ? `\n${avg.toLocaleString()} a day lately` : ''}${busiest ? `\nbusiest <#${busiest.key}>` : ''}`, inline: true },
        { name: '🚪 This week', value: `+${joins} joined · −${leaves} left`, inline: true },
        { name: '🚀 Boosts', value: `${g.premiumSubscriptionCount ?? 0} · tier ${g.premiumTier}`, inline: true },
        { name: '🏗️ Made of', value: `${channels.filter((c) => c.isTextBased() && !c.isThread()).size} text · ${channels.filter((c) => c.isVoiceBased()).size} voice · ${g.roles.cache.size - 1} roles · ${g.emojis.cache.size} emojis${g.stickers.cache.size ? ` · ${g.stickers.cache.size} stickers` : ''}`, inline: false },
        { name: '🛡️ Verification', value: levels[g.verificationLevel] ?? '?', inline: true },
        { name: '🎂 Founded', value: `<t:${unix(g.createdTimestamp)}:D> · ${ageDays.toLocaleString()} days ago`, inline: true },
      ],
    });
    const icon = g.iconURL({ size: 256 });
    if (icon) e.setThumbnail(icon);
    const banner = g.bannerURL({ size: 1024 });
    if (banner) e.setImage(banner);
    return ctx.reply({ embeds: [e], private: false });
  },
};

const letters = ['🇦', '🇧', '🇨', '🇩', '🇪'];

export function pollView(messageId: string | null, p: { question: string; options: string[]; votes: Record<string, number>; owner: string; closed?: boolean }) {
  const counts = p.options.map((_, i) => Object.values(p.votes).filter((v) => v === i).length);
  const total = counts.reduce((a, b) => a + b, 0);
  const top = Math.max(...counts, 0);
  const body = p.options.map((o, i) => {
    const pct = total ? Math.round((counts[i] / total) * 100) : 0;
    return `${letters[i]} **${o}**${p.closed && counts[i] === top && top > 0 ? ' 👑' : ''}\n${bar(counts[i], total || 1, 14)} ${counts[i]} · ${pct}%`;
  }).join('\n\n');
  const e = card({ kind: 'poll', title: p.question, emoji: p.closed ? '🔒' : '🗳️', gif: 'off', body, fields: [{ name: '🧮 Votes', value: String(total), inline: true }, { name: '📌 Status', value: p.closed ? 'closed' : 'open, press to vote or change your vote', inline: true }] });
  const id = messageId ?? 'new';
  const rows = p.closed ? [] : [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      ...p.options.map((o, i) => new ButtonBuilder().setCustomId(`poll|${id}|${i}`).setEmoji(letters[i]).setLabel(o.slice(0, 40)).setStyle(ButtonStyle.Secondary)),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`poll|${id}|close`).setLabel('End poll').setEmoji('🔒').setStyle(ButtonStyle.Danger),
    ),
  ];
  return { embeds: [e], components: rows };
}

const poll: Command = {
  name: 'poll',
  group: 'games',
  data: new SlashCommandBuilder().setName('poll').setDescription('Start a vote with buttons, up to 5 options')
    .addStringOption((o) => o.setName('question').setDescription('What are we voting on').setRequired(true).setMaxLength(200))
    .addStringOption((o) => o.setName('options').setDescription('Options split with | like pizza | burger | crab').setRequired(true).setMaxLength(400)).toJSON(),
  text: { args: ['all'] },
  run: async (ctx, store) => {
    // text form: tz poll best snack? | pizza | crab
    let question = ctx.str('question');
    let raw = ctx.str('options');
    if (!question && ctx.str('all')) {
      const parts = ctx.str('all')!.split('|').map((x) => x.trim()).filter(Boolean);
      question = parts.shift() ?? null;
      raw = parts.join('|');
    }
    const options = (raw ?? '').split('|').map((x) => x.trim()).filter(Boolean).slice(0, 5);
    if (!question || options.length < 2) return ctx.reply('Like this: `tz poll best snack? | pizza | crab`');
    const p = { question, options, votes: {}, owner: ctx.userId };
    const sent = await ctx.reply({ ...pollView(null, p), public: true }) as Message | { fetchReply?: () => Promise<Message> } | undefined;
    // slash replies hand back an interaction response, fetch the real message to key the poll on
    const msg = sent && 'id' in (sent as object) && 'edit' in (sent as object) ? sent as Message : await ((sent as { resource?: { message?: Message } })?.resource?.message ?? null);
    if (msg) {
      store.savePoll(msg.id, p);
      await msg.edit(pollView(msg.id, p)).catch(() => {});
    }
  },
};

export async function onPollButton(store: Store, i: Interaction) {
  if (!i.isButton() || !i.customId.startsWith('poll|')) return false;
  const [, , what] = i.customId.split('|');
  const p = store.poll(i.message.id);
  if (!p) { await i.reply({ content: 'This poll is from before I remembered polls.', flags: 64 }); return true; }
  if (what === 'close') {
    if (i.user.id !== p.owner && !i.memberPermissions?.has('ManageMessages')) {
      await i.reply({ content: 'Only whoever started it can end it.', flags: 64 });
      return true;
    }
    p.closed = true;
  } else {
    const n = Number(what);
    if (p.votes[i.user.id] === n) delete p.votes[i.user.id];
    else p.votes[i.user.id] = n;
  }
  store.savePoll(i.message.id, p);
  await i.update(pollView(i.message.id, p));
  return true;
}

// ---------- the little games: each one plays out in its own message and buttons edit it in place ----------

const g = (...c: ButtonBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
// a slash reply hands back an interaction response, a typed one the message itself
const messageOf = (sent: unknown): Message | null => {
  const m = (sent as { resource?: { message?: Message } })?.resource?.message ?? (sent as Message | undefined);
  return m && typeof (m as { edit?: unknown }).edit === 'function' ? m : null;
};

// Ranpo's 8ball: the same question gets the same answer all day, asking again only annoys him
const VERDICTS: [string, 'yes' | 'maybe' | 'no'][] = [
  ['Without a doubt. I knew before you finished typing.', 'yes'],
  ['Yes. Even Kunikida would sign off on it.', 'yes'],
  ['Every clue points to yes.', 'yes'],
  ['Yes~ but act surprised when it happens.', 'yes'],
  ['Likely. I\'d bet a crab on it.', 'yes'],
  ['The evidence is thin. Ask me after my nap.', 'maybe'],
  ['Cloudy. Like Chuuya\'s judgement.', 'maybe'],
  ['I could tell you, but the suspense is half the fun.', 'maybe'],
  ['Depends who\'s asking. And you\'re asking, so... maybe.', 'maybe'],
  ['Unlikely. Even my schemes have limits.', 'no'],
  ['No. Not even in a story Atsushi would believe.', 'no'],
  ['Absolutely not. I\'ve seen how this ends.', 'no'],
  ['The river says no, and the river is never wrong.', 'no'],
];
const TONE = { yes: [0x3fa76a, '🟢 Yes'], maybe: [0xc8a97e, '🟡 Maybe'], no: [0xc8283c, '🔴 No'] } as const;
const hashOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
function verdictFor(userId: string, q: string) {
  const day = new Date().toISOString().slice(0, 10);
  return VERDICTS[hashOf(`${userId}|${day}|${q.toLowerCase().replace(/[^a-z0-9]/g, '')}`) % VERDICTS.length];
}
const ballCard = (q: string, v: (typeof VERDICTS)[number] | null, again = 0) => {
  const e = new EmbedBuilder().setTitle('🎱 Ranpo\'s deduction').setColor(v ? TONE[v[1]][0] : 0x2a211b);
  const nag = ['', '\n-# I already told you. The answer doesn\'t change because you blink.', '\n-# Asking twice won\'t change it. Asking three times is just rude.', '\n-# Fine. Same answer. It\'s the same all day, you know.'];
  e.setDescription(`> *${q.slice(0, 200)}*\n\n${v ? `**${TONE[v[1]][1]}** · ${v[0]}${nag[Math.min(again, 3)]}` : '*Ranpo squints at the glasses... the sweets... the evidence...*'}`);
  return e;
};
const eightball: Command = {
  name: '8ball',
  group: 'games',
  data: new SlashCommandBuilder().setName('8ball').setDescription('Ask Ranpo a yes or no question, his answer holds all day')
    .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true).setMaxLength(200)).toJSON(),
  text: { aliases: ['ask8', '8b', 'ranpo'], args: ['question'] },
  run: async (ctx) => {
    const q = ctx.str('question');
    if (!q) return ctx.reply('Ask me something: `tz 8ball will I pull a fabled today?`');
    const v = verdictFor(ctx.userId, q);
    const again = new ButtonBuilder().setCustomId(`g8|${ctx.userId}|1`).setLabel('Ask again').setEmoji('🔁').setStyle(ButtonStyle.Secondary);
    const sent = await ctx.reply({ embeds: [ballCard(q, null)], public: true });
    const msg = messageOf(sent);
    if (!msg) return sent;
    await wait(1400);
    await msg.edit({ embeds: [ballCard(q, v)], components: [g(again)] }).catch(() => {});
    return sent;
  },
};

// coin: call it first and it keeps your record, or just flip
const coinFace = (side: 'Heads' | 'Tails') => (side === 'Heads' ? '🌕' : '🌑');
function coinView(owner: string, result: 'Heads' | 'Tails' | null, call: string | null, rec: { w: number; l: number; streak: number }) {
  const e = new EmbedBuilder().setTitle('🪙 Coin flip').setColor(0xc8a97e);
  if (!result) e.setDescription('Call it in the air, or just flip.\n-# calling keeps a record of how good your guesses are');
  else {
    const hit = call ? call === result : null;
    e.setColor(hit === null ? 0xc8a97e : hit ? 0x3fa76a : 0xc8283c)
      .setDescription(`# ${coinFace(result)} ${result}\n${hit === null ? say('coin') : hit ? `You called it. ${rec.streak > 1 ? `**${rec.streak} in a row.**` : ''}` : 'Wrong call. The coin feels nothing.'}${call ? `\n-# your calls: ${rec.w} right, ${rec.l} wrong` : ''}`);
  }
  const b = (id: string, label: string, emoji: string) => new ButtonBuilder().setCustomId(`gc|${owner}|${id}`).setLabel(label).setEmoji(emoji).setStyle(ButtonStyle.Secondary);
  return { embeds: [e], components: [g(b('Heads', 'Heads', '🌕'), b('Tails', 'Tails', '🌑'), b('none', result ? 'Flip again' : 'Just flip', '🪙'))] };
}
const coin: Command = {
  name: 'coin',
  group: 'games',
  data: new SlashCommandBuilder().setName('coin').setDescription('Flip a coin, call it first to keep a record').toJSON(),
  text: { aliases: ['flip', 'cf'] },
  run: (ctx, store) => ctx.reply({ ...coinView(ctx.userId, null, null, coinRecord(store, ctx.userId)), public: true }),
};
const coinRecord = (store: Store, u: string) => ({ w: 0, l: 0, streak: 0, ...JSON.parse(store.getKv(`coincall:${u}`) ?? '{}') }) as { w: number; l: number; streak: number };

// dice: 2d6+3, d20 adv, 4d6 drop the lowest is too much, but these cover most tables
const PIPS = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
function rollDice(raw: string) {
  const s = raw.toLowerCase().replace(/\s+/g, '');
  const adv = /adv|advantage/.test(s) ? 'adv' : /dis|disadvantage/.test(s) ? 'dis' : null;
  const m = /^(\d{0,2})d(\d{1,4})([+-]\d{1,4})?/.exec(s.replace(/adv(antage)?|dis(advantage)?/, '')) ?? /^()(\d{1,6})()$/.exec(s);
  if (!m) return null;
  const n = Math.min(Math.max(Number(m[1] || 1), 1), 20);
  const sides = Math.max(Number(m[2]), 2);
  const mod = Number(m[3] ?? 0);
  const once = () => Array.from({ length: n }, () => 1 + Math.floor(Math.random() * sides));
  let rolls = once();
  let other: number[] | null = null;
  if (adv) {
    other = once();
    const a = rolls.reduce((x, y) => x + y, 0);
    const b = other.reduce((x, y) => x + y, 0);
    if ((adv === 'adv' && b > a) || (adv === 'dis' && b < a)) [rolls, other] = [other, rolls];
  }
  const total = rolls.reduce((x, y) => x + y, 0) + mod;
  return { n, sides, mod, adv, rolls, other, total, label: `${n > 1 ? n : ''}d${sides}${mod ? (mod > 0 ? `+${mod}` : mod) : ''}${adv ? ` ${adv}` : ''}` };
}
function diceView(owner: string, raw: string) {
  const r = rollDice(raw);
  if (!r) return null;
  const face = (x: number) => (r.sides === 6 ? PIPS[x] : `\`${x}\``);
  const nat = r.n === 1 && r.sides === 20 ? r.rolls[0] : null;
  const flavour = nat === 20 ? '**Natural 20.** Fate itself stood up and clapped.' : nat === 1 ? '**Natural 1.** Somewhere, Dazai is laughing.' : r.total === r.n * r.sides + r.mod ? 'Every die maxed. Suspicious, honestly.' : say('roll');
  const e = new EmbedBuilder().setTitle(`🎲 ${r.label}`).setColor(nat === 20 ? 0x3fa76a : nat === 1 ? 0xc8283c : 0xc8a97e)
    .setDescription(`# ${r.total}\n${r.rolls.map(face).join(' ')}${r.mod ? ` ${r.mod > 0 ? '+' : '−'} ${Math.abs(r.mod)}` : ''}${r.other ? `\n-# the other roll: ${r.other.map(face).join(' ')} · ${r.adv === 'adv' ? 'advantage keeps the higher' : 'disadvantage keeps the lower'}` : ''}\n${flavour}`);
  const again = new ButtonBuilder().setCustomId(`gr|${owner}|${raw.slice(0, 60)}`).setLabel('Roll again').setEmoji('🎲').setStyle(ButtonStyle.Secondary);
  return { embeds: [e], components: [g(again)] };
}
const roll: Command = {
  name: 'roll',
  group: 'games',
  data: new SlashCommandBuilder().setName('roll').setDescription('Roll dice: 2d6, d20, 3d8+2, d20 adv, or just 100')
    .addStringOption((o) => o.setName('dice').setDescription('Like 2d6, d20 adv, 3d8+2, 100')).toJSON(),
  text: { aliases: ['dice'], args: ['dice'] },
  example: 'd20 adv',
  run: (ctx) => {
    const view = diceView(ctx.userId, ctx.str('dice') ?? 'd6');
    return view ? ctx.reply({ ...view, public: true }) : ctx.reply('Try `tz roll 2d6`, `tz roll d20 adv`, `tz roll 3d8+2` or `tz roll 100`.');
  },
};

// choose: Kunikida crosses options off his plan one at a time until one is left
function chooseView(owner: string, options: string[], out: Set<number>, done: boolean) {
  const lines = options.map((o, i) => (out.has(i) ? `~~${o}~~` : done ? `**➤ ${o}**` : `▫️ ${o}`));
  const e = new EmbedBuilder().setTitle(done ? '📓 The ideal is decided' : '📓 Kunikida consults the notebook').setColor(done ? 0x3fa76a : 0xc8a97e)
    .setDescription(`${lines.join('\n')}${done ? `\n\n${say('choose')}` : ''}`);
  const again = new ButtonBuilder().setCustomId(`gch|${owner}`).setLabel('Decide again').setEmoji('📓').setStyle(ButtonStyle.Secondary);
  return { embeds: [e], components: done ? [g(again)] : [] };
}
async function playChoose(edit: (v: ReturnType<typeof chooseView>) => Promise<unknown>, owner: string, options: string[]) {
  const out = new Set<number>();
  const order = options.map((_, i) => i).sort(() => Math.random() - 0.5);
  // cross off all but one, quicker when there are many
  const step = Math.max(350, Math.min(900, 3000 / options.length));
  for (const i of order.slice(0, -1)) {
    out.add(i);
    if (out.size < options.length - 1) { await edit(chooseView(owner, options, out, false)).catch(() => {}); await wait(step); }
  }
  await edit(chooseView(owner, options, out, true)).catch(() => {});
}
const chooseLists = new Map<string, string[]>();
const choose: Command = {
  name: 'choose',
  group: 'games',
  data: new SlashCommandBuilder().setName('choose').setDescription('Kunikida crosses options off until one is left')
    .addStringOption((o) => o.setName('options').setDescription('Split with | like sleep | work | crab').setRequired(true)).toJSON(),
  text: { aliases: ['pick', 'decide'], args: ['options'] },
  run: async (ctx) => {
    const options = [...new Set((ctx.str('options') ?? '').split(/\||,| or /).map((x) => x.trim()).filter(Boolean))].slice(0, 12);
    if (options.length < 2) return ctx.reply('Give me at least two: `tz choose nap | work | crab`');
    chooseLists.set(ctx.userId, options);
    const sent = await ctx.reply({ ...chooseView(ctx.userId, options, new Set(), false), public: true });
    const msg = messageOf(sent);
    if (msg) await playChoose((v) => msg.edit(v), ctx.userId, options);
    return sent;
  },
};

export async function onGames(store: Store, i: Interaction): Promise<boolean> {
  if (!i.isButton() || !/^(g8|gc|gr|gch)\|/.test(i.customId)) return false;
  const [kind, owner, arg] = i.customId.split('|');
  if (i.user.id !== owner) { await i.reply({ content: 'Start your own, this one belongs to someone else.', flags: MessageFlags.Ephemeral }); return true; }
  if (kind === 'g8') {
    const q = /\*(.+)\*/.exec(i.message.embeds[0]?.description ?? '')?.[1] ?? '';
    const n = Number(arg) || 1;
    const again = new ButtonBuilder().setCustomId(`g8|${owner}|${n + 1}`).setLabel('Ask again').setEmoji('🔁').setStyle(ButtonStyle.Secondary).setDisabled(n >= 3);
    await i.update({ embeds: [ballCard(q, verdictFor(owner, q), n)], components: [g(again)] });
    return true;
  }
  if (kind === 'gc') {
    // a quick spin in the air before it lands
    await i.update({ embeds: [new EmbedBuilder().setTitle('🪙 Coin flip').setColor(0xc8a97e).setDescription(`# 🪙 ...\n${arg === 'none' ? 'Up it goes.' : `You called **${arg}**. Up it goes.`}`)], components: [] });
    await wait(1100);
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
    const rec = coinRecord(store, owner);
    const call = arg === 'none' ? null : arg;
    if (call) {
      if (call === result) { rec.w++; rec.streak++; } else { rec.l++; rec.streak = 0; }
      store.setKv(`coincall:${owner}`, JSON.stringify(rec));
    }
    await i.editReply(coinView(owner, result, call, rec)).catch(() => {});
    return true;
  }
  if (kind === 'gr') {
    const view = diceView(owner, arg);
    if (view) await i.update(view);
    return true;
  }
  if (kind === 'gch') {
    const options = chooseLists.get(owner);
    if (!options) { await i.update({ components: [] }); return true; }
    await i.update(chooseView(owner, options, new Set(), false));
    await playChoose((v) => i.editReply(v), owner, options);
    return true;
  }
  return false;
}

const afk: Command = {
  name: 'afk',
  group: 'you',
  data: new SlashCommandBuilder().setName('afk').setDescription('Tell people you\'re away, Texz answers when they ping you')
    .addStringOption((o) => o.setName('reason').setDescription('Why, optional').setMaxLength(120)).toJSON(),
  text: { args: ['reason'] },
  run: (ctx, store) => {
    // no reason given, Texz makes one up for you
    const reason = ctx.str('reason') ?? say('afkReason');
    store.setAfk(ctx.userId, reason);
    store.setKv(`afkpings:${ctx.userId}`, null);
    return ctx.reply({ content: `💤 Away: **${reason}**\n-# ${say('afkSet')} I'll keep track of who pings you and show you when you're back.`, temp: true });
  },
};

// clears your afk when you talk, and answers for people you mention who are away
export async function afkWatch(store: Store, m: Message) {
  if (m.author.bot) return;
  const mine = store.afk(m.author.id);
  if (mine && Date.now() - mine.at > 15_000) {
    store.setAfk(m.author.id, null);
    // what happened while they were gone: who pinged them and where, with links back
    const pings = JSON.parse(store.getKv(`afkpings:${m.author.id}`) ?? '[]') as { by: string; url: string; at: number }[];
    store.setKv(`afkpings:${m.author.id}`, null);
    const gone = Date.now() - mine.at;
    const away = gone >= 3_600_000 ? `${Math.floor(gone / 3_600_000)}h ${Math.floor((gone % 3_600_000) / 60_000)}m` : `${Math.max(1, Math.floor(gone / 60_000))}m`;
    const list = pings.slice(-5).map((p) => `> <@${p.by}> <t:${unix(p.at)}:R> · [jump](${p.url})`).join('\n');
    const text = `💤 ${say('afkBack')} You were away **${away}**.${pings.length ? `\n📬 **${pings.length}** mention${pings.length === 1 ? '' : 's'} while you were gone:\n${list}${pings.length > 5 ? `\n-# and ${pings.length - 5} more` : ''}` : ''}`;
    await m.reply({ content: text, allowedMentions: { repliedUser: false, parse: [] } }).then((r) => setTimeout(() => void r.delete().catch(() => {}), pings.length ? 60_000 : 8000)).catch(() => {});
  }
  const away = m.mentions.users.filter((u) => u.id !== m.author.id).map((u) => ({ u, a: store.afk(u.id) })).filter((x) => x.a);
  for (const { u } of away) {
    const list = JSON.parse(store.getKv(`afkpings:${u.id}`) ?? '[]') as { by: string; url: string; at: number }[];
    list.push({ by: m.author.id, url: m.url, at: Date.now() });
    store.setKv(`afkpings:${u.id}`, JSON.stringify(list.slice(-20)));
  }
  if (away.length) {
    const lines = away.map(({ u, a }) => `💤 **${u.displayName}** ${say('afkMention')} · *${a!.reason}* · since <t:${unix(a!.at)}:R>`);
    await m.reply({ content: lines.join('\n'), allowedMentions: { repliedUser: false, parse: [] } }).catch(() => {});
  }
}

export const utility: Module = {
  name: 'utility',
  label: 'Utility and fun',
  about: 'Avatars, user and server info, polls, choose, dice, coin, 8ball and AFK',
  commands: [avatar, user, profile, server, poll, choose, roll, coin, ship, eightball, afk, guess, f1Quiz, f1Trivia, f1Today, crestQuiz, quote, mission, achievements, booth],
};
