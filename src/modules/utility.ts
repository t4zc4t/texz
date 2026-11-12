import { booth } from './booth.js';
import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder,
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
  data: new SlashCommandBuilder().setName('server').setDescription('Everything about this server at a glance').toJSON(),
  text: { aliases: ['si', 'guild'] },
  run: async (ctx) => {
    const g = ctx.guild;
    if (!g) return ctx.reply('That works inside a server.');
    const owner = await g.fetchOwner().catch(() => null);
    const channels = g.channels.cache;
    const e = card({
      kind: 'server', title: `Establishment report · ${g.name}`, emoji: '🏛️', gif: 'off',
      fields: [
        { name: '👑 Owner', value: owner ? `<@${owner.id}>` : '?', inline: true },
        { name: '👥 Members', value: g.memberCount.toLocaleString(), inline: true },
        { name: '🚀 Boosts', value: `${g.premiumSubscriptionCount ?? 0} · tier ${g.premiumTier}`, inline: true },
        { name: '💬 Channels', value: `${channels.filter((c) => c.isTextBased()).size} text · ${channels.filter((c) => c.isVoiceBased()).size} voice`, inline: true },
        { name: '🎭 Roles', value: String(g.roles.cache.size - 1), inline: true },
        { name: '😀 Emojis', value: String(g.emojis.cache.size), inline: true },
        { name: '🎂 Created', value: `<t:${unix(g.createdTimestamp)}:D> · <t:${unix(g.createdTimestamp)}:R>`, inline: false },
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

const choose: Command = {
  name: 'choose',
  group: 'games',
  data: new SlashCommandBuilder().setName('choose').setDescription('Let Texz pick for you')
    .addStringOption((o) => o.setName('options').setDescription('Split with | like sleep | work').setRequired(true)).toJSON(),
  text: { aliases: ['pick'], args: ['options'] },
  run: (ctx) => {
    const options = (ctx.str('options') ?? '').split(/\||,| or /).map((x) => x.trim()).filter(Boolean);
    if (options.length < 2) return ctx.reply('Give me at least two: `tz choose nap | work`');
    return ctx.reply({ content: `🎯 **${pick(options)}**. ${say('choose')}\n-# out of ${options.join(', ')}`, temp: true });
  },
};

const roll: Command = {
  name: 'roll',
  group: 'games',
  data: new SlashCommandBuilder().setName('roll').setDescription('Roll dice, like 2d6 or d20')
    .addStringOption((o) => o.setName('dice').setDescription('Like 2d6, d20, 100')).toJSON(),
  text: { aliases: ['dice'], args: ['dice'] },
  run: (ctx) => {
    const raw = (ctx.str('dice') ?? 'd6').toLowerCase();
    const m = raw.match(/^(\d{0,2})d(\d{1,4})$/) ?? raw.match(/^()(\d{1,6})$/);
    if (!m) return ctx.reply('Try `tz roll 2d6`, `tz roll d20` or `tz roll 100`.');
    const n = Math.min(Math.max(Number(m[1] || 1), 1), 20);
    const sides = Math.max(Number(m[2]), 2);
    const rolls = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * sides));
    const total = rolls.reduce((a, b) => a + b, 0);
    return ctx.reply({ content: `🎲 **${total}**${n > 1 ? ` (${rolls.join(' + ')})` : ''} · ${n}d${sides}\n-# ${say('roll')}`, temp: true });
  },
};

const coin: Command = {
  name: 'coin',
  group: 'games',
  data: new SlashCommandBuilder().setName('coin').setDescription('Flip a coin').toJSON(),
  text: { aliases: ['flip', 'cf'] },
  run: (ctx) => ctx.reply({ content: `🪙 **${Math.random() < 0.5 ? 'Heads' : 'Tails'}**. ${say('coin')}`, temp: true }),
};

const eightball: Command = {
  name: '8ball',
  group: 'games',
  data: new SlashCommandBuilder().setName('8ball').setDescription('Ask Texz a yes or no question')
    .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true).setMaxLength(200)).toJSON(),
  text: { aliases: ['ask8', '8b'], args: ['question'] },
  run: (ctx) => {
    const q = ctx.str('question');
    if (!q) return ctx.reply('Ask me something: `tz 8ball will I pull a fabled today?`');
    return ctx.reply({ content: `🎱 *${q.slice(0, 200)}*\n**${say('eightball')}**`, temp: true });
  },
};

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
    return ctx.reply({ content: `💤 Away: **${reason}**\n-# ${say('afkSet')} I'll clear it the moment you speak again.`, temp: true });
  },
};

// clears your afk when you talk, and answers for people you mention who are away
export async function afkWatch(store: Store, m: Message) {
  if (m.author.bot) return;
  const mine = store.afk(m.author.id);
  if (mine && Date.now() - mine.at > 15_000) {
    store.setAfk(m.author.id, null);
    await m.reply({ content: `💤 ${say('afkBack')}`, allowedMentions: { repliedUser: false } }).then((r) => setTimeout(() => void r.delete().catch(() => {}), 8000)).catch(() => {});
  }
  const away = m.mentions.users.filter((u) => u.id !== m.author.id).map((u) => ({ u, a: store.afk(u.id) })).filter((x) => x.a);
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
