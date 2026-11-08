import { AttachmentBuilder } from 'discord.js';
import { birthdayCard, fetchAvatar } from '../features/rankcard.js';
import { PermissionFlagsBits, SlashCommandBuilder, type Client } from 'discord.js';
import type { Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import { card, say } from '../theme.js';

const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const daysIn = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const fmtDate = (month: number, day: number) => `${day} ${months[month - 1][0].toUpperCase()}${months[month - 1].slice(1, 3)}`;

// "14 feb", "feb 14", "14/2", "14-02", "14 2" are all the 14th of February, day first like most of the world
export function parseDate(raw: string | null): { month: number; day: number } | null {
  if (!raw) return null;
  const t = raw.toLowerCase().replace(/(st|nd|rd|th)\b/g, '').trim();
  let day: number | undefined;
  let month: number | undefined;
  const named = months.findIndex((m) => new RegExp(`\\b${m.slice(0, 3)}[a-z]*\\b`).test(t));
  if (named >= 0) {
    month = named + 1;
    day = Number(t.match(/\d{1,2}/)?.[0]);
  } else {
    const nums = t.match(/\d+/g)?.map(Number) ?? [];
    if (nums.length < 2) return null;
    // 2001-02-14 style puts the year first
    if (nums[0] > 31) [, month, day] = nums;
    else [day, month] = nums;
  }
  if (!month || !day || month < 1 || month > 12 || day < 1 || day > daysIn[month - 1]) return null;
  return { month, day };
}

// today's date where that person lives
export function localDate(tz: string, at = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(at).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// the 29th of February is celebrated on the 28th in other years
export function isBirthday(b: { month: number; day: number }, today: { year: number; month: number; day: number }) {
  if (b.month === 2 && b.day === 29 && !leap(today.year)) return today.month === 2 && today.day === 28;
  return b.month === today.month && b.day === today.day;
}

// days until the next one, used to sort the upcoming list
export function daysUntil(b: { month: number; day: number }, today: { year: number; month: number; day: number }) {
  const from = Date.UTC(today.year, today.month - 1, today.day);
  let next = Date.UTC(today.year, b.month - 1, b.day);
  if (next < from) next = Date.UTC(today.year + 1, b.month - 1, b.day);
  return Math.round((next - from) / 86_400_000);
}

export function startBirthdays(client: Client, store: Store) {
  const tick = async () => {
    const now = Date.now();
    // roles from yesterday's birthdays come off first
    for (const r of store.dueBirthdayRoles(now)) {
      const roleId = store.guild(r.guild_id).birthdays.role;
      const guild = client.guilds.cache.get(r.guild_id);
      const m = roleId ? await guild?.members.fetch(r.user_id).catch(() => null) : null;
      if (m && roleId) await m.roles.remove(roleId, 'birthday is over').catch(() => {});
    }
    const all = store.birthdays();
    if (!all.length) return;
    for (const guild of client.guilds.cache.values()) {
      const g = store.guild(guild.id);
      if (!store.rules(guild.id, 'birthdays').enabled || (!g.birthdays.channel && !g.birthdays.role)) continue;
      for (const b of all) {
        const today = localDate(store.settings(b.user_id).timezone);
        if (!isBirthday(b, today) || store.birthdayDone(guild.id, b.user_id, today.year)) continue;
        const m = await guild.members.fetch(b.user_id).catch(() => null);
        if (!m) continue;
        store.markBirthday(guild.id, b.user_id, today.year, g.birthdays.role ? now + 24 * 3_600_000 : null);
        if (g.birthdays.role) await m.roles.add(g.birthdays.role, 'birthday').catch(() => {});
        const ch = g.birthdays.channel ? await guild.channels.fetch(g.birthdays.channel).catch(() => null) : null;
        if (!ch?.isSendable()) continue;
        const vars = { user: `<@${m.id}>`, name: m.displayName, server: guild.name };
        const e = card({ kind: 'birthday', title: `Happy birthday, ${m.displayName}!`, emoji: '🎂', vars, line: g.birthdays.message ?? undefined, gif: g.gifs.birthday ?? null });
        // a drawn card with their face, the gif stays in the embed if there is one
        const png = await birthdayCard({ name: m.displayName, server: guild.name, avatar: await fetchAvatar(m.displayAvatarURL({ extension: 'png', forceStatic: true, size: 512 })) }).catch(() => null);
        if (png) e.setImage('attachment://birthday.png'); else e.setThumbnail(m.displayAvatarURL({ size: 256, forceStatic: false }));
        await ch.send({ content: `<@${m.id}>`, embeds: [e], files: png ? [new AttachmentBuilder(png, { name: 'birthday.png' })] : [], allowedMentions: { users: [m.id] } }).catch(() => {});
      }
    }
  };
  setInterval(() => void tick(), 10 * 60_000);
  setTimeout(() => void tick(), 15_000);
}

const birthday: Command = {
  name: 'birthday',
  group: 'info',
  data: new SlashCommandBuilder().setName('birthday').setDescription('Your birthday, so Texz can make a fuss on the day')
    .addSubcommand((s) => s.setName('set').setDescription('Save your birthday, no year needed')
      .addIntegerOption((o) => o.setName('day').setDescription('Day of the month').setRequired(true).setMinValue(1).setMaxValue(31))
      .addIntegerOption((o) => o.setName('month').setDescription('Month').setRequired(true)
        .addChoices(...months.map((m, i) => ({ name: m[0].toUpperCase() + m.slice(1), value: i + 1 })))))
    .addSubcommand((s) => s.setName('remove').setDescription('Forget your birthday'))
    .addSubcommand((s) => s.setName('list').setDescription('Upcoming birthdays in this server'))
    .addSubcommand((s) => s.setName('check').setDescription('When someone\'s birthday is')
      .addUserOption((o) => o.setName('user').setDescription('Who, you if empty')))
    .toJSON(),
  // tz bday set 14 feb, tz bday remove, tz bday, tz bday @user
  text: { aliases: ['bday', 'bd'], sub: true, subArgs: { set: ['date'], check: ['user'] } },
  run: async (ctx, store) => {
    let sub = ctx.sub() ?? 'list';
    let who = ctx.user('user');
    if (ctx.viaText && /^<@!?\d+>$/.test(sub)) { who = sub.replace(/\D/g, ''); sub = 'check'; }
    if (sub === 'set') {
      const date = ctx.viaText ? parseDate(ctx.str('date')) : (() => {
        const day = ctx.int('day');
        const month = ctx.int('month');
        return day && month ? parseDate(`${day}/${month}`) : null;
      })();
      if (!date) return ctx.reply('That date doesn\'t exist, even in my calendar. Like this: `tz bday set 14 feb`');
      store.setBirthday(ctx.userId, date.month, date.day);
      const tz = store.settings(ctx.userId).timezone;
      return ctx.reply({ content: `🎂 **${fmtDate(date.month, date.day)}**, noted. ${say('birthdaySet')}\n-# I go by your timezone (${tz}), \`tz remind\` → Settings changes it.`, temp: true });
    }
    if (sub === 'remove') return ctx.reply(store.removeBirthday(ctx.userId) ? '🎂 Forgotten. Ageless, like me.' : 'I didn\'t have it anyway.');
    if (sub === 'check') {
      const id = who ?? ctx.userId;
      const b = store.birthday(id);
      if (!b) return ctx.reply(id === ctx.userId ? 'You haven\'t told me. `tz bday set 14 feb`' : 'They haven\'t told me theirs. Very mysterious.');
      const n = daysUntil(b, localDate(store.settings(id).timezone));
      return ctx.reply({ content: `🎂 <@${id}>'s birthday is **${fmtDate(b.month, b.day)}**, ${n === 0 ? '**today**!' : `in ${n} day${n === 1 ? '' : 's'}.`}`, temp: true });
    }
    if (!ctx.guild) return ctx.reply('The list is per server.');
    // only people who are actually in this server
    const today = localDate('UTC');
    const list = [];
    for (const b of store.birthdays()) {
      const m = ctx.guild.members.cache.get(b.user_id) ?? await ctx.guild.members.fetch(b.user_id).catch(() => null);
      if (m) list.push({ ...b, n: daysUntil(b, today) });
    }
    list.sort((a, b) => a.n - b.n);
    const g = store.guild(ctx.guild.id);
    const setupHint = !g.birthdays.channel && ctx.member?.permissions.has(PermissionFlagsBits.ManageGuild) ? '\n\n-# No birthday channel yet, set one in `/setup` → Birthdays.' : '';
    const body = (list.length
      ? list.slice(0, 15).map((b) => `🎂 <@${b.user_id}> · **${fmtDate(b.month, b.day)}** · ${b.n === 0 ? 'today!' : `in ${b.n}d`}`).join('\n')
      : 'Nobody has told me their birthday. `tz bday set 14 feb` to be first.') + setupHint;
    return ctx.reply({ embeds: [card({ kind: 'birthdayList', title: 'Upcoming birthdays', emoji: '📅', gif: 'off', body })], private: false });
  },
};

export const birthdays: Module = {
  name: 'birthdays',
  label: 'Birthdays',
  about: 'A Dazai-style greeting on everyone\'s birthday, with an optional birthday role for the day. Channel and role are in /setup',
  commands: [birthday],
};
