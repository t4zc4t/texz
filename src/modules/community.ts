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

// the community corner of the Agency board: quotes, the archive, the count and the confessional, plus a Monday recap

const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);
const COLOR = 0xc8283c;

export const rooms = {
  quotes: { name: '🖋️┃words-on-file', topic: 'Messages made into quotes, hung here by Texz. Right click a message → Apps → Make it a Quote.' },
  archive: { name: '📁┃agency-archive', topic: 'Messages the server starred enough to keep. React with ⭐ anywhere, five stars and it\'s filed here.' },
  count: { name: '🔢┃the-count', topic: 'Count up together, one number each, no two in a row. A wrong number sends it back to 1.' },
  confess: { name: '🕯️┃the-confessional', topic: 'Anonymous confessions, posted by Texz. Press the button on the pinned message, or /you view:confess.' },
} as const;

interface Count { channel: string | null; n: number; last: string | null; best: number }
const countOf = (store: Store, g: string): Count => ({ channel: null, n: 0, last: null, best: 0, ...JSON.parse(store.getKv(`count:${g}`) ?? '{}') });
const saveCount = (store: Store, g: string, c: Count) => store.setKv(`count:${g}`, JSON.stringify(c));
const confessCh = (store: Store, g: string) => store.getKv(`confessch:${g}`);
export const recapOn = (store: Store, g: string) => store.getKv(`recap:${g}`) !== 'off';

// the bulletin category, made if it isn't there yet, so every Texz channel sits together
async function category(store: Store, guild: Guild): Promise<CategoryChannel> {
  const g = store.guild(guild.id);
  let cat = g.bulletins.category ? await guild.channels.fetch(g.bulletins.category).catch(() => null) : null;
  cat ??= guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === CATEGORY) ?? null;
  cat ??= await guild.channels.create({ name: CATEGORY, type: ChannelType.GuildCategory, reason: 'Agency channels from /setup' });
  g.bulletins.category = cat.id;
  store.saveGuild(guild.id, g);
  return cat as CategoryChannel;
}

async function room(guild: Guild, catId: string, saved: string | null | undefined, key: keyof typeof rooms, quiet: boolean) {
  const r = rooms[key];
  let ch: GuildBasedChannel | null = saved ? await guild.channels.fetch(saved).catch(() => null) : null;
  ch ??= guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === r.name) ?? null;
  const fresh = !ch;
  ch ??= await guild.channels.create({ name: r.name, type: ChannelType.GuildText, parent: catId, topic: r.topic, reason: 'Agency channels from /setup' });
  // the read-only rooms: people react and read, Texz posts
  if (quiet && 'permissionOverwrites' in ch) {
    await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false, CreatePublicThreads: false, CreatePrivateThreads: false, AddReactions: true }).catch(() => {});
    await ch.permissionOverwrites.edit(guild.members.me!.id, { SendMessages: true, EmbedLinks: true, AttachFiles: true }).catch(() => {});
  }
  return { ch, fresh };
}

// makes the four rooms under the bulletin category, reusing any that exist
export async function buildCommunity(store: Store, guild: Guild): Promise<string> {
  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) return fixText(guild, { perms: ['ManageChannels'], doing: 'make the channels' }) ?? 'I need Manage Channels for that.';
  const cat = await category(store, guild);
  const g = store.guild(guild.id);
  const q = await room(guild, cat.id, g.quotes.channel, 'quotes', true);
  const a = await room(guild, cat.id, g.starboard.channel, 'archive', true);
  const c = countOf(store, guild.id);
  const k = await room(guild, cat.id, c.channel, 'count', false);
  const f = await room(guild, cat.id, confessCh(store, guild.id), 'confess', true);
  const fresh = store.guild(guild.id);
  fresh.quotes.channel = q.ch.id;
  fresh.starboard.channel = a.ch.id;
  if (fresh.starboard.min < 5) fresh.starboard.min = 5;
  store.saveGuild(guild.id, fresh);
  c.channel = k.ch.id;
  saveCount(store, guild.id, c);
  store.setKv(`confessch:${guild.id}`, f.ch.id);
  if (k.fresh && k.ch.isSendable()) await k.ch.send({ embeds: [card({ kind: 'bulletin', title: '🔢 The count', emoji: '', gif: 'off', body: 'One number each, going up from **1**. Nobody counts twice in a row, and a wrong number sends everyone back to the start. The record is kept.' })] }).then((m) => m.pin().catch(() => {})).catch(() => {});
  if (f.fresh && f.ch.isSendable()) await f.ch.send(confessIntro()).then((m) => m.pin().catch(() => {})).catch(() => {});
  return `🕵️ Done, all under **${CATEGORY}**: <#${q.ch.id}> for quotes, <#${a.ch.id}> for the archive (5 ⭐), <#${k.ch.id}> for counting and <#${f.ch.id}> for confessions.`;
}

// ---------- the count ----------

export async function onCount(store: Store, m: Message) {
  if (!m.guildId || m.author.bot) return;
  const c = countOf(store, m.guildId);
  if (!c.channel || m.channelId !== c.channel) return;
  const said = /^\s*(\d{1,7})\b/.exec(m.content)?.[1];
  // chatter in the channel is fine, only numbers count
  if (!said) return;
  const n = Number(said);
  if (n === c.n + 1 && m.author.id !== c.last) {
    c.n = n;
    c.last = m.author.id;
    const record = n > c.best;
    if (record) c.best = n;
    saveCount(store, m.guildId, c);
    await m.react(n % 100 === 0 ? '💯' : record && n > 10 ? '🏆' : '✅').catch(() => {});
    const lines = track(store, m.guildId, m.author.id, 'counted');
    if (lines.length && m.channel.isSendable()) await m.channel.send({ content: lines.join('\n'), allowedMentions: { users: [m.author.id] } }).catch(() => {});
    return;
  }
  const why = m.author.id === c.last ? 'counted twice in a row' : `said **${n}**, the next was **${c.n + 1}**`;
  await m.react('❌').catch(() => {});
  if (c.n > 0 && m.channel.isSendable()) await m.channel.send({ content: `💥 <@${m.author.id}> ${why}. The count stopped at **${c.n}**, the record is **${c.best}**. Back to **1**.`, allowedMentions: { users: [m.author.id] } }).catch(() => {});
  c.n = 0;
  c.last = null;
  saveCount(store, m.guildId, c);
}

// ---------- the confessional ----------

function confessIntro() {
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
  commands: [confess],
};
