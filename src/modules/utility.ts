import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, type Interaction, type Message, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import { bar, card, pick, say } from '../theme.js';

const unix = (ms: number) => Math.floor(ms / 1000);

const avatar: Command = {
  name: 'avatar',
  data: new SlashCommandBuilder().setName('avatar').setDescription('Someone\'s profile picture, full size')
    .addUserOption((o) => o.setName('user').setDescription('Whose, yours if empty')).toJSON(),
  text: { aliases: ['av', 'pfp'], args: ['user'] },
  run: async (ctx) => {
    const id = ctx.user('user') ?? ctx.userId;
    const member = await ctx.guild?.members.fetch(id).catch(() => null);
    const user = member?.user ?? (await (ctx.guild?.client ?? null)?.users.fetch(id).catch(() => null));
    if (!user) return ctx.reply('I can\'t find that person.');
    const url = (member ?? user).displayAvatarURL({ size: 1024 });
    const e = card({ kind: 'avatar', title: member?.displayName ?? user.username, emoji: '🖼️', gif: 'off', body: `[Open full size](${url})` }).setImage(url);
    return ctx.reply({ embeds: [e], private: false });
  },
};

const user: Command = {
  name: 'user',
  data: new SlashCommandBuilder().setName('user').setDescription('A quick file on someone in this server')
    .addUserOption((o) => o.setName('user').setDescription('Who, you if empty')).toJSON(),
  text: { aliases: ['whois', 'ui'], args: ['user'] },
  run: async (ctx) => {
    if (!ctx.guild) return ctx.reply('That works inside a server.');
    const m = await ctx.guild.members.fetch(ctx.user('user') ?? ctx.userId).catch(() => null);
    if (!m) return ctx.reply('Nobody by that name here.');
    const roles = m.roles.cache.filter((r) => r.id !== ctx.guild!.id).sort((a, b) => b.position - a.position);
    const e = card({
      kind: 'user', title: m.displayName, emoji: '🗃️', gif: 'off', color: m.displayColor || undefined,
      fields: [
        { name: '🪪 Username', value: m.user.username, inline: true },
        { name: '🤖 Bot', value: m.user.bot ? 'yes' : 'no', inline: true },
        { name: '🆔 ID', value: `\`${m.id}\``, inline: true },
        { name: '🎂 Account made', value: `<t:${unix(m.user.createdTimestamp)}:D>\n<t:${unix(m.user.createdTimestamp)}:R>`, inline: true },
        { name: '🚪 Joined here', value: m.joinedTimestamp ? `<t:${unix(m.joinedTimestamp)}:D>\n<t:${unix(m.joinedTimestamp)}:R>` : '?', inline: true },
        { name: `🎭 Roles · ${roles.size}`, value: roles.size ? roles.first(12).map((r) => `<@&${r.id}>`).join(' ') : 'none', inline: false },
      ],
    }).setThumbnail(m.displayAvatarURL({ size: 256 }));
    return ctx.reply({ embeds: [e], private: false });
  },
};

const server: Command = {
  name: 'server',
  data: new SlashCommandBuilder().setName('server').setDescription('Everything about this server at a glance').toJSON(),
  text: { aliases: ['si', 'guild'] },
  run: async (ctx) => {
    const g = ctx.guild;
    if (!g) return ctx.reply('That works inside a server.');
    const owner = await g.fetchOwner().catch(() => null);
    const channels = g.channels.cache;
    const e = card({
      kind: 'server', title: g.name, emoji: '🏛️', gif: 'off',
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
    const sent = await ctx.reply({ ...pollView(null, p), private: false }) as Message | { fetchReply?: () => Promise<Message> } | undefined;
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
  data: new SlashCommandBuilder().setName('choose').setDescription('Let Texz pick for you')
    .addStringOption((o) => o.setName('options').setDescription('Split with | like sleep | work').setRequired(true)).toJSON(),
  text: { aliases: ['pick'], args: ['options'] },
  run: (ctx) => {
    const options = (ctx.str('options') ?? '').split(/\||,| or /).map((x) => x.trim()).filter(Boolean);
    if (options.length < 2) return ctx.reply('Give me at least two: `tz choose nap | work`');
    return ctx.reply({ embeds: [card({ kind: 'choose', title: pick(options), emoji: '🎯', gif: 'off', body: `-# out of ${options.join(', ')}` })], private: false });
  },
};

const roll: Command = {
  name: 'roll',
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
    return ctx.reply({ embeds: [card({ kind: 'roll', title: `${total}`, emoji: '🎲', gif: 'off', body: n > 1 ? `${rolls.join(' + ')}\n-# ${n}d${sides}` : `-# d${sides}` })], private: false });
  },
};

const coin: Command = {
  name: 'coin',
  data: new SlashCommandBuilder().setName('coin').setDescription('Flip a coin').toJSON(),
  text: { aliases: ['flip', 'cf'] },
  run: (ctx) => ctx.reply({ embeds: [card({ kind: 'coin', title: Math.random() < 0.5 ? 'Heads' : 'Tails', emoji: '🪙', gif: 'off' })], private: false }),
};

const eightball: Command = {
  name: '8ball',
  data: new SlashCommandBuilder().setName('8ball').setDescription('Ask Texz a yes or no question')
    .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true).setMaxLength(200)).toJSON(),
  text: { aliases: ['ask8', '8b'], args: ['question'] },
  run: (ctx) => {
    const q = ctx.str('question');
    if (!q) return ctx.reply('Ask me something: `tz 8ball will I pull a fabled today?`');
    return ctx.reply({ embeds: [card({ kind: 'eightball', title: q.slice(0, 200), emoji: '🎱', gif: 'off', body: '' })], private: false });
  },
};

const afk: Command = {
  name: 'afk',
  data: new SlashCommandBuilder().setName('afk').setDescription('Tell people you\'re away, Texz answers when they ping you')
    .addStringOption((o) => o.setName('reason').setDescription('Why, optional').setMaxLength(120)).toJSON(),
  text: { args: ['reason'] },
  run: (ctx, store) => {
    const reason = ctx.str('reason') ?? 'away';
    store.setAfk(ctx.userId, reason);
    return ctx.reply({ embeds: [card({ kind: 'afkSet', title: 'Marked as away', emoji: '💤', gif: 'off', body: `**${reason}**\n-# I'll clear it when you next talk.` })], private: false });
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
    const lines = away.map(({ u, a }) => `💤 **${u.displayName}** ${say('afkMention')}: ${a!.reason} · <t:${unix(a!.at)}:R>`);
    await m.reply({ content: lines.join('\n'), allowedMentions: { repliedUser: false, parse: [] } }).catch(() => {});
  }
}

export const utility: Module = {
  name: 'utility',
  label: 'Utility and fun',
  about: 'Avatars, user and server info, polls, choose, dice, coin, 8ball and AFK',
  commands: [avatar, user, server, poll, choose, roll, coin, eightball, afk],
};
