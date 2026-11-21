import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, TextInputBuilder, TextInputStyle,
  type CategoryChannel, type Client, type Guild, type GuildBasedChannel, type Interaction, type Message, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import { card } from '../theme.js';
import { isStaff } from '../core/staff.js';
import { fixText } from '../core/fixes.js';
import { CATEGORY } from './bulletins.js';
import { track } from './missions.js';
import { staffRoles } from '../core/staff.js';

// the community corner of the Agency board: quotes, the archive, the count and the confessional, plus a Monday recap

const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);
const COLOR = 0xc8283c;

export const rooms = {
  quotes: { name: '🖋️┃ink-and-regret', topic: 'Things people said and can never take back, framed by Texz. Right click a message → Apps → Make it a Quote.' },
  archive: { name: '⭐┃the-agency-files', topic: 'Messages the server starred enough to keep. React with ⭐ anywhere, five stars and it\'s filed here.' },
  count: { name: '🔢┃kunikidas-ledger', topic: 'Kunikida keeps the numbers. Only numbers here, one each, no two in a row. A wrong number sends it back to 1. Beating the record pays, see tz count.' },
  confess: { name: '🕯️┃midnight-confessions', topic: 'Anonymous confessions, posted by Texz. Press the button on the pinned message, or /fun confess.' },
} as const;

interface Count { channel: string | null; n: number; last: string | null; best: number; runBest?: number }
const countOf = (store: Store, g: string): Count => ({ channel: null, n: 0, last: null, best: 0, ...JSON.parse(store.getKv(`count:${g}`) ?? '{}') });
const saveCount = (store: Store, g: string, c: Count) => store.setKv(`count:${g}`, JSON.stringify(c));
const confessCh = (store: Store, g: string) => store.getKv(`confessch:${g}`);
export const recapOn = (store: Store, g: string) => store.getKv(`recap:${g}`) !== 'off';

// the rooms themselves are made by the Agency layout in /setup, see features/layout.ts

export const countIntro = () => ({ embeds: [card({ kind: 'bulletin', title: '🔢 The count', emoji: '', gif: 'off', body: 'One number each, going up from **1**. Nobody counts twice in a row, and a wrong number sends everyone back to the start. Only numbers go here, anything else is cleared.\n\nPushing past the record pays, so does every new hundred beyond it, and your own tally earns titles, bonuses and pardons that save the count when you slip. `tz count` shows your book.' })] });

// ---------- the count ----------

// your own page in the ledger
interface Book { n: number; ruins: number; saves: number; tier: number; day?: string; dayYen?: number }
const bookOf = (store: Store, g: string, u: string): Book => ({ n: 0, ruins: 0, saves: 0, tier: 0, ...JSON.parse(store.getKv(`countme:${g}:${u}`) ?? '{}') });
const saveBook = (store: Store, g: string, u: string, b: Book) => store.setKv(`countme:${g}:${u}`, JSON.stringify(b));
const yen = (n: number) => `¥${n.toLocaleString()}`;

// titles for numbers you got right yourself, each pays once and hands you a pardon
export const TITLES = [
  { at: 50, name: 'Clerk', bonus: 500 },
  { at: 250, name: 'Bookkeeper', bonus: 1500 },
  { at: 1000, name: 'Accountant', bonus: 5000 },
  { at: 2500, name: 'Kunikida\'s right hand', bonus: 10000 },
  { at: 5000, name: 'The Ideal', bonus: 25000 },
];
const titleOf = (n: number) => [...TITLES].reverse().find((t) => n >= t.at)?.name ?? 'New hire';
const MAX_SAVES = 2;
const PARDON = 1500;
// leaving chatter in the count is a choice staff make, by default only numbers stay
export const countChat = (store: Store, g: string) => store.getKv(`countchat:${g}`) === 'on';

// a short note that clears itself, at most once a couple of minutes per person
async function nudge(store: Store, m: Message, text: string) {
  const key = `countnudge:${m.guildId}:${m.author.id}`;
  if (Date.now() - Number(store.getKv(key) ?? 0) < 120_000 || !m.channel.isSendable()) return;
  store.setKv(key, String(Date.now()));
  const n = await m.channel.send({ content: text, allowedMentions: { users: [m.author.id] } }).catch(() => null);
  if (n) setTimeout(() => void n.delete().catch(() => {}), 6000);
}

export async function onCount(store: Store, m: Message) {
  if (!m.guildId || m.author.bot || !store.rules(m.guildId, 'community').enabled) return;
  const g = m.guildId;
  const c = countOf(store, g);
  if (!c.channel || m.channelId !== c.channel) return;
  const pure = /^\s*(\d{1,7})\s*$/.exec(m.content)?.[1];
  const said = pure ?? (countChat(store, g) ? /^\s*(\d{1,7})\b/.exec(m.content)?.[1] : undefined);
  if (!said) {
    // only numbers stay, staff and typed commands aside
    const prefix = store.guild(g).prefix;
    const staff = m.member?.permissions.has(PermissionFlagsBits.ManageMessages) || staffRoles(store, g).some((r) => m.member?.roles.cache.has(r));
    if (countChat(store, g) || staff || m.content.toLowerCase().startsWith(`${prefix.toLowerCase()} `)) return;
    await m.delete().catch(() => {});
    await nudge(store, m, `🔢 <@${m.author.id}> only numbers go in the ledger. The next one is **${c.n + 1}**.`);
    return;
  }
  const n = Number(said);
  const paid = store.rules(g, 'economy').enabled;
  const book = bookOf(store, g, m.author.id);
  const notes: string[] = [];
  if (n === c.n + 1 && m.author.id !== c.last) {
    // the record as it stood when this run began, so passing it pays once and not on every number after
    c.runBest ??= c.best;
    c.n = n;
    c.last = m.author.id;
    if (n > c.best) c.best = n;
    const broke = n === c.runBest + 1 && c.runBest >= 25;
    const fresh = n > c.runBest; // numbers nobody has reached before
    saveCount(store, g, c);
    book.n += 1;
    // the pay is for real progress: passing the record once, and the hundreds and thousands past it,
    // so counting back up to ground already covered after a reset pays nothing
    let earn = 0;
    if (fresh && n % 1000 === 0) { earn += 1000; notes.push(`🎉 **${n.toLocaleString()}**! <@${m.author.id}> landed the big one${paid ? ` and gets **${yen(1000)}**` : ''}.`); }
    else if (fresh && n % 100 === 0) earn += 100;
    if (broke) {
      earn += 250;
      notes.push(`🏆 <@${m.author.id}> pushed the count past the old record of **${c.runBest}**${paid ? `, **${yen(250)}** for that` : ''}. Every new hundred from here pays too.`);
      notes.push(...track(store, g, m.author.id, 'countRecord'));
    }
    // a new title from your own tally
    const t = TITLES[book.tier];
    if (t && book.n >= t.at) {
      book.tier += 1;
      earn += t.bonus;
      const gotSave = book.saves < MAX_SAVES;
      if (gotSave) book.saves += 1;
      notes.push(`📒 <@${m.author.id}> has **${book.n.toLocaleString()}** numbers in the ledger and is now **${t.name}**${paid ? `, **${yen(t.bonus)}**` : ''}${gotSave ? ' and a pardon that saves the count once' : ''}.`);
    }
    if (paid && earn) store.pay(g, m.author.id, earn);
    saveBook(store, g, m.author.id, book);
    await m.react(fresh && n % 100 === 0 ? '💯' : broke ? '🏆' : '✅').catch(() => {});
    notes.push(...track(store, g, m.author.id, 'counted'));
    if (notes.length && m.channel.isSendable()) await m.channel.send({ content: notes.join('\n'), allowedMentions: { users: [m.author.id] } }).catch(() => {});
    return;
  }
  // the same person twice is only a slip, the number stays where it was
  if (m.author.id === c.last) {
    await m.delete().catch(() => {});
    await nudge(store, m, `✋ <@${m.author.id}> you said the last one, let someone else say **${c.n + 1}**.`);
    return;
  }
  // a wrong number: a pardon saves the run, otherwise it goes back to 1
  if (c.n > 0 && book.saves > 0) {
    book.saves -= 1;
    saveBook(store, g, m.author.id, book);
    await m.react('🛡️').catch(() => {});
    if (m.channel.isSendable()) await m.channel.send({ content: `🛡️ <@${m.author.id}> said **${n}**, but used a pardon. The count stays at **${c.n}**, next is **${c.n + 1}**. ${book.saves} pardon${book.saves === 1 ? '' : 's'} left.`, allowedMentions: { users: [m.author.id] } }).catch(() => {});
    return;
  }
  await m.react('❌').catch(() => {});
  if (c.n > 0) {
    book.ruins += 1;
    saveBook(store, g, m.author.id, book);
    const fine = paid && c.n >= 10 ? Math.min(store.wallet(g, m.author.id).yen, Math.min(500, c.n * 2)) : 0;
    if (fine) store.pay(g, m.author.id, -fine);
    if (m.channel.isSendable()) await m.channel.send({ content: `💥 <@${m.author.id}> said **${n}**, the next was **${c.n + 1}**. The count stopped at **${c.n}**, the record is **${c.best}**. Back to **1**.${fine ? `\n-# Kunikida fined them ${yen(fine)}. A pardon would have saved it, \`tz count\`.` : ''}`, allowedMentions: { users: [m.author.id] } }).catch(() => {});
  }
  c.n = 0;
  c.last = null;
  c.runBest = c.best;
  saveCount(store, g, c);
}

// the ledger page: where the count is, your own book, the best counters and what it pays
function ledger(store: Store, g: string, u: string, note?: string) {
  const c = countOf(store, g);
  const b = bookOf(store, g, u);
  const next = TITLES[b.tier];
  const top = store.kvByPrefix(`countme:${g}:`)
    .map((r) => ({ id: r.key.split(':')[2], n: (JSON.parse(r.value) as Book).n ?? 0 }))
    .filter((r) => r.n > 0).sort((x, y) => y.n - x.n).slice(0, 5);
  const e = card({
    kind: 'bulletin', title: '🔢 Kunikida\'s ledger', emoji: '', gif: 'off', line: '',
    body: [c.channel ? `The count is at **${c.n}** in <#${c.channel}>, the record is **${c.best}**. Next up: **${c.n + 1}**.` : 'There\'s no count here yet. An admin can make one in /setup → Community.', note ? `\n${note}` : ''].join(''),
    fields: [
      { name: 'Your book', value: [`**${titleOf(b.n)}** · ${b.n.toLocaleString()} right`, next ? `${next.name} at ${next.at.toLocaleString()}, pays ${yen(next.bonus)}` : 'Every title earned', `🛡️ ${b.saves}/${MAX_SAVES} pardons · 💥 broke it ${b.ruins} time${b.ruins === 1 ? '' : 's'}`].join('\n'), inline: true },
      { name: 'Top counters', value: top.map((r, i) => `${['🥇', '🥈', '🥉', '4.', '5.'][i]} <@${r.id}> · ${r.n.toLocaleString()}`).join('\n') || 'Nobody yet', inline: true },
      { name: 'What it pays', value: [`${yen(250)} for pushing past the record`, `${yen(100)} for every new hundred past it, ${yen(1000)} for a new thousand`, 'Titles pay a bonus and a pardon', `A pardon saves the count once, or buy one for ${yen(PARDON)}`, 'Breaking the count costs a small fine'].join('\n'), inline: false },
    ],
  });
  const full = b.saves >= MAX_SAVES;
  return {
    embeds: [e],
    components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`cnt|buy|${u}`).setLabel(full ? 'Pardons full' : `Buy a pardon · ${yen(PARDON)}`).setEmoji('🛡️').setStyle(ButtonStyle.Secondary).setDisabled(full || !store.rules(g, 'economy').enabled),
    )],
  };
}

export async function onCountButton(store: Store, i: Interaction) {
  if (!i.isButton() || !i.customId.startsWith('cnt|') || !i.guildId) return false;
  const [, what, owner] = i.customId.split('|');
  if (i.user.id !== owner) { await i.reply({ content: 'That\'s someone else\'s book, open yours with `tz count`.', flags: MessageFlags.Ephemeral }); return true; }
  if (what === 'buy') {
    const b = bookOf(store, i.guildId, owner);
    let note: string;
    if (b.saves >= MAX_SAVES) note = 'You already hold as many pardons as Kunikida allows.';
    else if (!store.pay(i.guildId, owner, -PARDON)) note = `A pardon costs ${yen(PARDON)}, you're short.`;
    else { b.saves += 1; saveBook(store, i.guildId, owner, b); note = `🛡️ Bought a pardon. If you slip, it keeps the count going.`; }
    await i.update(ledger(store, i.guildId, owner, note));
  }
  return true;
}

export const count: Command = {
  name: 'count',
  group: 'you',
  data: new SlashCommandBuilder().setName('count').setDescription('The count: where it is, your own tally, pardons and what it pays')
    .addStringOption((o) => o.setName('chat').setDescription('Staff: let chatter stay in the count channel').addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })).toJSON(),
  text: { aliases: ['ledger', 'counting'], args: ['chat'] },
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('The count is per server.');
    const chat = ctx.str('chat')?.toLowerCase();
    if (chat === 'on' || chat === 'off') {
      if (!isStaff(store, ctx)) return ctx.reply({ content: 'Only staff can change that.', temp: true });
      store.setKv(`countchat:${ctx.guildId}`, chat === 'on' ? 'on' : null);
      return ctx.reply({ content: chat === 'on' ? 'Chatter can stay in the count now, only numbers at the start count.' : 'Only numbers stay in the count now, everything else is cleared.', temp: true });
    }
    return ctx.reply(ledger(store, ctx.guildId, ctx.userId));
  },
};

// ---------- the confessional ----------

export function confessIntro() {
  return {
    embeds: [card({ kind: 'bulletin', title: '🕯️ The confessional', emoji: '', gif: 'off', body: 'Say it without your name on it. Press the button, write it, and Texz posts it here as a numbered confession.\n-# Staff can look up who wrote one if it breaks the rules, so keep it kind.' })],
    components: [row(new ButtonBuilder().setCustomId('cf|open').setLabel('Write a confession').setEmoji('🕯️').setStyle(ButtonStyle.Secondary))],
  };
}

const confessModal = () => new ModalBuilder().setCustomId('cf|send').setTitle('The confessional').addComponents(
  new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('v').setLabel('Your confession, posted without your name').setStyle(TextInputStyle.Paragraph).setMaxLength(1500).setRequired(true)),
);

async function postConfession(store: Store, guild: Guild, userId: string, text: string): Promise<string> {
  const chId = confessCh(store, guild.id);
  const ch = chId ? await guild.channels.fetch(chId).catch(() => null) : null;
  if (!ch?.isSendable()) return 'There\'s no confessional here yet. An admin can make one in /setup → Community.';
  const wait = Number(store.getKv(`confesswait:${guild.id}:${userId}`) ?? 0) - Date.now();
  if (wait > 0) return `One confession every five minutes, try again <t:${Math.floor((Date.now() + wait) / 1000)}:R>.`;
  const n = Number(store.getKv(`confessn:${guild.id}`) ?? 0) + 1;
  const e = new EmbedBuilder().setColor(COLOR).setTitle(`Confession #${n}`).setDescription(text.slice(0, 1500)).setFooter({ text: 'anonymous · write your own with the button on the pinned message' }).setTimestamp();
  const sent = await ch.send({ embeds: [e], allowedMentions: { parse: [] } }).catch(() => null);
  if (!sent) return 'I couldn\'t post in the confessional, check my permissions there.';
  store.setKv(`confessn:${guild.id}`, String(n));
  store.setKv(`confessby:${guild.id}:${n}`, userId);
  store.setKv(`confesswait:${guild.id}:${userId}`, String(Date.now() + 5 * 60_000));
  return `🕯️ Posted as **Confession #${n}** in <#${ch.id}>. Nobody sees your name.`;
}

export async function onConfess(store: Store, i: Interaction) {
  if (!('customId' in i) || typeof i.customId !== 'string' || !i.customId.startsWith('cf|') || !i.guild) return false;
  if (i.isButton()) { await i.showModal(confessModal()); return true; }
  if (i.isModalSubmit()) {
    const msg = await postConfession(store, i.guild, i.user.id, i.fields.getTextInputValue('v'));
    await i.reply({ content: msg, flags: MessageFlags.Ephemeral });
  }
  return true;
}

export const confess: Command = {
  name: 'confess',
  group: 'you',
  data: new SlashCommandBuilder().setName('confess').setDescription('Post an anonymous confession, or for staff, look one up')
    .addStringOption((o) => o.setName('text').setDescription('What you want to say, or "trace 12" for staff')).toJSON(),
  text: { aliases: ['confession'], args: ['text'] },
  run: async (ctx, store) => {
    if (!ctx.guild) return ctx.reply('Confessions are per server.');
    const text = ctx.str('text')?.trim();
    // staff can see who wrote one that broke the rules
    const trace = text && /^trace\s+#?(\d+)$/i.exec(text);
    if (trace) {
      if (!isStaff(store, ctx)) return ctx.reply({ content: 'Only staff can look a confession up.', private: true });
      const who = store.getKv(`confessby:${ctx.guild.id}:${trace[1]}`);
      return ctx.reply({ content: who ? `🔍 Confession #${trace[1]} was written by <@${who}>.` : `No confession #${trace[1]} on file.`, private: true });
    }
    if (!text) return ctx.reply({ embeds: confessIntro().embeds, components: confessIntro().components, private: true });
    // a typed confession has the author's name on it, so the message goes before anything else
    if (ctx.dropSource) {
      // typed: the message goes, and the receipt comes by DM so nothing in the channel points back at you
      await ctx.dropSource();
      const msg = await postConfession(store, ctx.guild, ctx.userId, text);
      await ctx.client.users.send(ctx.userId, msg).catch(() => {});
      return;
    }
    return ctx.reply({ content: await postConfession(store, ctx.guild, ctx.userId, text), private: true });
  },
};

// ---------- Monday recap ----------

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const medal = ['🥇', '🥈', '🥉'];

export function recapEmbed(store: Store, guild: Guild) {
  const since = day(7);
  const people = store.keyTotals(guild.id, 'user', since, 3);
  const chans = store.keyTotals(guild.id, 'msg', since, 1);
  const msgs = store.dayTotals(guild.id, 'msg', since).reduce((a, d) => a + d.n, 0);
  const joins = store.dayTotals(guild.id, 'join', since).reduce((a, d) => a + d.n, 0);
  const catches = store.catchBoard(guild.id, Date.now() - 7 * 86_400_000, 3);
  const quotes = (JSON.parse(store.getKv(`quotes:${guild.id}`) ?? '[]') as { at: number }[]).filter((q) => q.at > Date.now() - 7 * 86_400_000).length;
  const count = countOf(store, guild.id);
  const fields = [
    { name: '💬 Loudest voices', value: people.map((p, n) => `${medal[n]} <@${p.key}> · ${p.n.toLocaleString()}`).join('\n') || 'a quiet week', inline: true },
    ...(catches.length ? [{ name: '🔴 Top catchers', value: catches.map((c, n) => `${medal[n]} <@${c.user_id}> · ${c.n}`).join('\n'), inline: true }] : []),
    { name: '📈 The week in numbers', value: [`💬 ${msgs.toLocaleString()} messages`, chans[0] ? `📍 busiest <#${chans[0].key}>` : null, `👋 ${joins} joined`, quotes ? `🖋️ ${quotes} quotes made` : null, count.channel ? `🔢 the count is at ${count.n}, record ${count.best}` : null].filter(Boolean).join('\n'), inline: false },
  ];
  return new EmbedBuilder().setColor(COLOR).setTitle(`🗂️ The week's file · ${guild.name}`).setDescription('Monday, so here\'s what the Agency got up to.').addFields(fields).setTimestamp();
}

// Mondays, once, a little after the morning in India
export function startRecap(client: Client, store: Store) {
  const tick = async () => {
    const now = new Date();
    if (now.getUTCDay() !== 1 || now.getUTCHours() < 4) return;
    const week = now.toISOString().slice(0, 10);
    for (const guild of client.guilds.cache.values()) {
      if (!recapOn(store, guild.id) || store.getKv(`recap:sent:${guild.id}`) === week) continue;
      store.setKv(`recap:sent:${guild.id}`, week);
      const chId = store.guild(guild.id).starboard.channel ?? guild.systemChannelId;
      const ch = chId ? await guild.channels.fetch(chId).catch(() => null) : null;
      if (ch?.isSendable()) await ch.send({ embeds: [recapEmbed(store, guild)], allowedMentions: { parse: [] } }).catch(() => {});
    }
  };
  setInterval(() => void tick().catch(() => {}), 30 * 60_000).unref?.();
}

export const community: Module = {
  name: 'community',
  label: 'Community',
  about: 'The archive, the count, the confessional and the Monday recap. Set up in /setup → Community',
  commands: [confess, count],
};
