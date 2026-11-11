import { backupCmd } from './backupcmd.js';
import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, Events, MessageFlags, OverwriteType, PermissionFlagsBits,
  SlashCommandBuilder, type Client, type Guild, type Interaction, type MessageActionRowComponentBuilder, type MessageReaction, type PartialMessageReaction,
} from 'discord.js';
import type { Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import { parseLength, human } from './moderation.js';
import { COLOR, bar, card, say } from '../theme.js';
import { zonedTime } from '../time.js';
import { report } from '../ops.js';
import { fixText } from '../core/fixes.js';

const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);
const unix = (ms: number) => Math.floor(ms / 1000);
const dayAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

// ---------- starboard ----------

const plain = (e: string | null) => (e ?? '').replace(/\uFE0F/g, '');
const sameEmoji = (r: MessageReaction | PartialMessageReaction, want: string) => (r.emoji.id ? want.includes(r.emoji.id) : plain(r.emoji.name) === plain(want));

async function onStar(store: Store, r: MessageReaction | PartialMessageReaction) {
  const guild = r.message.guild;
  if (!guild || !store.rules(guild.id, 'server').enabled) return;
  const sb = store.guild(guild.id).starboard;
  if (!sb.channel || r.message.channelId === sb.channel || !sameEmoji(r, sb.emoji)) return;
  if (r.partial) await r.fetch().catch(() => null);
  const msg = r.message.partial ? await r.message.fetch().catch(() => null) : r.message;
  if (!msg || msg.author?.bot) return;
  // the author starring their own post doesn't count unless the server allows it
  let count = r.count ?? 0;
  if (!sb.self && msg.author && (await r.users.fetch().catch(() => null))?.has(msg.author.id)) count--;
  const known = store.star(guild.id, msg.id);
  const board = await guild.channels.fetch(sb.channel).catch(() => null);
  if (!board?.isSendable()) return;
  const line = `${sb.emoji} **${count}** · <#${msg.channelId}>`;
  if (known?.board_id) {
    const posted = await board.messages.fetch(known.board_id).catch(() => null);
    if (posted) await posted.edit({ content: line }).catch(() => {});
    store.setStar(guild.id, msg.id, known.board_id, count);
    return;
  }
  if (count < sb.min) { store.setStar(guild.id, msg.id, null, count); return; }
  const e = new EmbedBuilder().setColor(COLOR)
    .setAuthor({ name: msg.member?.displayName ?? msg.author?.username ?? 'someone', iconURL: msg.author?.displayAvatarURL() })
    .setDescription(msg.content?.slice(0, 4000) || null)
    .setTimestamp(msg.createdTimestamp);
  const img = msg.attachments.find((a) => a.contentType?.startsWith('image/'));
  if (img) e.setImage(img.url);
  const jump = row(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(msg.url).setLabel('Jump to it'));
  const posted = await board.send({ content: line, embeds: [e], components: [jump], allowedMentions: { parse: [] } }).catch(() => null);
  store.setStar(guild.id, msg.id, posted?.id ?? null, count);
}

// ---------- tickets ----------

export function ticketPanel() {
  const e = card({ kind: 'ticket', title: 'Need a hand?', emoji: '🎫', gif: 'off', body: 'Press the button and a private channel opens with you and the staff. Only one at a time, please.' });
  return { embeds: [e], components: [row(new ButtonBuilder().setCustomId('tk|open').setLabel('Open a ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary))] };
}

async function openTicket(store: Store, guild: Guild, userId: string, username: string) {
  const t = store.guild(guild.id).tickets;
  const already = store.openTicket(guild.id, userId);
  if (already && guild.channels.cache.has(already.channel_id)) return `You already have one open: <#${already.channel_id}>`;
  if (already) store.closeTicket(already.channel_id);
  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) return fixText(guild, { perms: ['ManageChannels'], doing: 'open tickets' }) ?? 'I need the Manage Channels permission to open tickets.';
  const see = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles];
  const ch = await guild.channels.create({
    name: `ticket-${username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90) || 'ticket',
    type: ChannelType.GuildText,
    parent: t.category ?? undefined,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: userId, type: OverwriteType.Member, allow: see },
      { id: me.id, type: OverwriteType.Member, allow: [...see, PermissionFlagsBits.ManageChannels] },
      ...(t.staff ? [{ id: t.staff, type: OverwriteType.Role, allow: see }] : []),
    ],
    reason: `ticket for ${username}`,
  }).catch((e) => { report('ticket open', e); return null; });
  if (!ch) return 'Discord wouldn\'t let me make the channel. Check my permissions on the ticket category.';
  const num = store.addTicket(guild.id, userId, ch.id);
  await ch.send({
    content: `<@${userId}>${t.staff ? ` <@&${t.staff}>` : ''}`,
    embeds: [card({ kind: 'ticket', title: `Ticket #${num}`, emoji: '🎫', gif: 'off', body: 'Tell us what\'s going on. Whoever opened it or the staff can close it with the button.' })],
    components: [row(new ButtonBuilder().setCustomId('tk|close').setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Danger))],
    allowedMentions: { users: [userId], roles: t.staff ? [t.staff] : [] },
  });
  return `Opened <#${ch.id}>.`;
}

async function closeTicket(store: Store, i: Interaction & { channelId: string | null }) {
  if (!i.isButton() || !i.guild || !i.channelId) return;
  const tk = store.ticket(i.channelId);
  if (!tk || tk.closed_at) { await i.reply({ content: 'This isn\'t an open ticket.', flags: MessageFlags.Ephemeral }); return; }
  const t = store.guild(i.guild.id).tickets;
  const member = await i.guild.members.fetch(i.user.id).catch(() => null);
  const staff = !!member && (member.permissions.has(PermissionFlagsBits.ManageChannels) || (!!t.staff && member.roles.cache.has(t.staff)));
  if (i.user.id !== tk.user_id && !staff) { await i.reply({ content: 'Only whoever opened it or the staff can close it.', flags: MessageFlags.Ephemeral }); return; }
  await i.reply({ content: `🔒 Closing in 5 seconds. ${say('ticketClose')}` });
  store.closeTicket(i.channelId);
  const ch = i.channel;
  // a plain text copy of the conversation goes to the ticket log, if there is one
  if (t.log && ch?.isTextBased()) {
    const msgs = await ch.messages.fetch({ limit: 100 }).catch(() => null);
    const text = msgs ? [...msgs.values()].reverse().map((m) => `[${new Date(m.createdTimestamp).toISOString().slice(0, 16).replace('T', ' ')}] ${m.author.username}: ${m.content}${m.attachments.size ? ` (${m.attachments.map((a) => a.url).join(' ')})` : ''}`).join('\n') : '';
    const logCh = await i.guild.channels.fetch(t.log).catch(() => null);
    if (logCh?.isSendable()) {
      await logCh.send({
        content: `🎫 Ticket #${tk.num} from <@${tk.user_id}> closed by <@${i.user.id}> · opened <t:${unix(tk.opened_at)}:R>`,
        files: [new AttachmentBuilder(Buffer.from(text || 'nothing was said'), { name: `ticket-${tk.num}.txt` })],
        allowedMentions: { parse: [] },
      }).catch(() => {});
    }
  }
  setTimeout(() => void ch?.delete(`ticket #${tk.num} closed`).catch(() => {}), 5000);
}

export async function onServerComponent(store: Store, i: Interaction): Promise<boolean> {
  if (!i.isButton() || !i.customId.startsWith('tk|') || !i.guild) return false;
  if (i.customId === 'tk|close') { await closeTicket(store, i); return true; }
  if (!store.rules(i.guild.id, 'server').enabled) { await i.reply({ content: 'Tickets are switched off here.', flags: MessageFlags.Ephemeral }); return true; }
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  await i.editReply(await openTicket(store, i.guild, i.user.id, i.user.username));
  return true;
}

// ---------- scheduled posts ----------

// "in 2h", "2h", "<t:1767225600>", "18:30" (next one in your timezone), "tomorrow 09:00"
export function parseWhen(raw: string, tz: string, now = Date.now()): number | null {
  const t = raw.trim().toLowerCase();
  const stamp = t.match(/^(?:<t:)?(\d{10})/);
  if (stamp) return Number(stamp[1]) * 1000;
  const clock = t.match(/^(tomorrow\s+)?(\d{1,2}):(\d{2})$/);
  if (clock) {
    const [h, mi] = [Number(clock[2]), Number(clock[3])];
    if (h > 23 || mi > 59) return null;
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
    let at = zonedTime(tz, Number(p.year), Number(p.month), Number(p.day) + (clock[1] ? 1 : 0), h, mi).getTime();
    if (at <= now) at = zonedTime(tz, Number(p.year), Number(p.month), Number(p.day) + 1, h, mi).getTime();
    return at;
  }
  const len = parseLength(t.replace(/^in\s+/, ''));
  return len ? now + len : null;
}

const repeats: Record<string, number> = { once: 0, hourly: 3_600_000, daily: 86_400_000, weekly: 7 * 86_400_000 };

export function startServerTimers(client: Client, store: Store) {
  const tick = async () => {
    const now = Date.now();
    for (const s of store.dueSchedules(now)) {
      // a repeating post that was missed while offline goes out once, then picks up its rhythm
      let next = s.every_ms ? s.next_at + s.every_ms : null;
      while (next !== null && next <= now) next += s.every_ms;
      store.moveSchedule(s.id, next);
      const ch = await client.channels.fetch(s.channel_id).catch(() => null);
      if (ch?.isSendable()) await ch.send({ content: s.text, allowedMentions: { parse: ['roles', 'everyone', 'users'] } }).catch((e) => report('scheduled post', e));
    }
  };
  setInterval(() => void tick(), 30_000);
  void tick();
  client.on(Events.GuildMemberAdd, (m) => store.countDay(m.guild.id, 'join', 'all'));
  client.on(Events.GuildMemberRemove, (m) => store.countDay(m.guild.id, 'leave', 'all'));
}

const announce: Command = {
  name: 'announce',
  group: 'staff',
  admin: true,
  data: new SlashCommandBuilder().setName('announce').setDescription('Posts that go out later, once or on repeat')
    .addSubcommand((s) => s.setName('add').setDescription('Plan a post')
      .addStringOption((o) => o.setName('when').setDescription('in 2h, 18:30, tomorrow 09:00 or a <t:unix> stamp').setRequired(true))
      .addStringOption((o) => o.setName('message').setDescription('What to post').setRequired(true).setMaxLength(2000))
      .addChannelOption((o) => o.setName('channel').setDescription('Where, here if empty').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addStringOption((o) => o.setName('repeat').setDescription('Once if empty').addChoices(...Object.keys(repeats).map((k) => ({ name: k, value: k })))))
    .addSubcommand((s) => s.setName('list').setDescription('Planned posts here'))
    .addSubcommand((s) => s.setName('delete').setDescription('Drop a planned post')
      .addIntegerOption((o) => o.setName('id').setDescription('Number from the list').setRequired(true).setMinValue(1)))
    .toJSON(),
  // tz announce add 18:30 daily Good evening agency!
  text: { aliases: ['schedule'], sub: true, subArgs: { add: ['when', 'message'], delete: ['id'] } },
  run: async (ctx, store) => {
    if (!ctx.guild) return ctx.reply('Server only.');
    const sub = ctx.sub() ?? 'list';
    if (sub === 'list') {
      const list = store.schedules(ctx.guild.id);
      const every = (ms: number) => Object.entries(repeats).find(([, v]) => v === ms)?.[0] ?? human(ms);
      const body = list.length
        ? list.map((s) => `\`#${s.id}\` <#${s.channel_id}> · <t:${unix(s.next_at)}:f>${s.every_ms ? ` · ${every(s.every_ms)}` : ''}\n-# ${s.text.slice(0, 90).replace(/\n/g, ' ')}`).join('\n')
        : 'Nothing planned. The calendar is clear, how restful.';
      return ctx.reply({ embeds: [card({ kind: 'announce', title: 'Planned posts', emoji: '🗓️', gif: 'off', body })] });
    }
    if (sub === 'delete') return ctx.reply(store.deleteSchedule(ctx.guild.id, ctx.int('id') ?? 0) ? '🗑️ Dropped.' : 'No planned post with that number.');
    let when = ctx.str('when') ?? '';
    let text = ctx.str('message') ?? '';
    let repeat = ctx.str('repeat') ?? 'once';
    // text form: "tz announce add 18:30 daily hello", the repeat word is optional, "tomorrow 09:00" takes two words
    if (ctx.viaText) {
      const words = text.split(/\s+/);
      if (when === 'tomorrow' || when === 'in') when = `${when} ${words.shift() ?? ''}`;
      if (repeats[words[0]?.toLowerCase()] !== undefined) repeat = words.shift()!.toLowerCase();
      text = words.join(' ');
    }
    const at = parseWhen(when, store.settings(ctx.userId).timezone);
    if (!at || at < Date.now() - 60_000 || at > Date.now() + 365 * 86_400_000) return ctx.reply('When? Like `in 2h`, `18:30`, `tomorrow 09:00` or a `<t:unix>` stamp, within a year.');
    if (!text) return ctx.reply('What should I post?');
    const chId = ctx.channel('channel') ?? ctx.channelId;
    const ch = await ctx.guild.channels.fetch(chId).catch(() => null);
    if (!ch?.isSendable()) return ctx.reply('I can\'t post in that channel.');
    const id = store.addSchedule({ guild_id: ctx.guild.id, channel_id: ch.id, text, next_at: at, every_ms: repeats[repeat] ?? 0, by_id: ctx.userId });
    return ctx.reply(`🗓️ Post #${id} goes out in <#${ch.id}> <t:${unix(at)}:R>${repeat !== 'once' ? `, then ${repeat}` : ''}. Times like 18:30 use your timezone from \`tz settings\`.`);
  },
};

const stats: Command = {
  name: 'serverstats',
  group: 'staff',
  as: 'stats',
  admin: true,
  data: new SlashCommandBuilder().setName('serverstats').setDescription('Messages, busiest channels and people, joins and leaves')
    .addIntegerOption((o) => o.setName('days').setDescription('How far back, 7 if empty').setMinValue(1).setMaxValue(90)).toJSON(),
  text: { aliases: ['activity'], args: ['days'] },
  run: (ctx, store) => {
    if (!ctx.guild) return ctx.reply('Server only.');
    const days = Math.min(Math.max(ctx.int('days') ?? 7, 1), 90);
    const since = dayAgo(days - 1);
    const perDay = store.dayTotals(ctx.guild.id, 'msg', since);
    const total = perDay.reduce((a, d) => a + d.n, 0);
    const top = Math.max(1, ...perDay.map((d) => d.n));
    const joins = store.dayTotals(ctx.guild.id, 'join', since).reduce((a, d) => a + d.n, 0);
    const leaves = store.dayTotals(ctx.guild.id, 'leave', since).reduce((a, d) => a + d.n, 0);
    const chans = store.keyTotals(ctx.guild.id, 'msg', since);
    const people = store.keyTotals(ctx.guild.id, 'user', since);
    const graph = perDay.slice(-14).map((d) => `\`${d.day.slice(5)}\` ${bar(d.n, top, 12)} ${d.n}`).join('\n');
    return ctx.reply({ embeds: [card({
      kind: 'stats', title: `Last ${days} day${days === 1 ? '' : 's'}`, emoji: '📊', gif: 'off',
      body: graph || 'Nothing counted yet. I only count what I see after I join.',
      fields: [
        { name: '💬 Messages', value: `**${total.toLocaleString()}** · ${Math.round(total / days)} a day`, inline: true },
        { name: '📥 Joins / 📤 leaves', value: `**${joins}** / **${leaves}**`, inline: true },
        { name: '📍 Busiest channels', value: chans.map((c) => `<#${c.key}> ${c.n}`).join('\n') || '*none*', inline: true },
        { name: '🗣️ Most active', value: people.map((p) => `<@${p.key}> ${p.n}`).join('\n') || '*none*', inline: true },
      ],
    })] });
  },
};

export const server: Module = {
  name: 'server',
  label: 'Server tools',
  about: 'Starboard, tickets, planned announcements and activity stats. Starboard and tickets are set up in /setup',
  commands: [announce, stats, backupCmd],
};
