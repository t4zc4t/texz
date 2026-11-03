import { PermissionFlagsBits, SlashCommandBuilder, type Message } from 'discord.js';
import type { Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import { card, say } from '../theme.js';

export const YEN = '¥';
// daily pay grows with the streak for a week, chat pays a little once a minute
export const DAILY_BASE = 150;
export const DAILY_STEP = 25;
export const CHAT_PAY = 2;
export const GUESS_PAY = 40;

const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

export function claimDaily(store: Store, guildId: string, userId: string): { ok: false; next: number } | { ok: true; got: number; streak: number } {
  const w = store.wallet(guildId, userId);
  if (w.daily_day === today()) {
    const midnight = Date.parse(`${today()}T00:00:00Z`) + 86_400_000;
    return { ok: false, next: midnight };
  }
  const streak = w.daily_day === yesterday() ? w.streak + 1 : 1;
  const got = DAILY_BASE + DAILY_STEP * Math.min(streak - 1, 6);
  store.pay(guildId, userId, got, { daily_day: today(), streak });
  return { ok: true, got, streak };
}

// a couple of yen for chatting, once a minute, only where the economy is on
export function chatPay(store: Store, m: Message) {
  if (!m.guildId || m.author.bot || !store.rules(m.guildId, 'economy').enabled) return;
  const w = store.wallet(m.guildId, m.author.id);
  if (Date.now() - w.chat_at < 60_000) return;
  store.pay(m.guildId, m.author.id, CHAT_PAY, { chat_at: Date.now() });
}

const fmt = (n: number) => `${YEN}${n.toLocaleString()}`;

const daily: Command = {
  name: 'daily',
  group: 'eco',
  data: new SlashCommandBuilder().setName('daily').setDescription('Collect your daily yen, more for each day in a row').toJSON(),
  text: { aliases: ['yen'] },
  run: (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Yen lives in servers.');
    const r = claimDaily(store, ctx.guildId, ctx.userId);
    if (!r.ok) return ctx.reply({ content: `⏳ Already collected today. Next one <t:${Math.floor(r.next / 1000)}:R>.`, temp: true });
    const w = store.wallet(ctx.guildId, ctx.userId);
    return ctx.reply({ content: `💴 **+${fmt(r.got)}** · day ${r.streak} in a row · you have **${fmt(w.yen)}**\n-# ${say('ecoDaily')}`, temp: true });
  },
};

const balance: Command = {
  name: 'balance',
  group: 'eco',
  data: new SlashCommandBuilder().setName('balance').setDescription('How much yen someone has')
    .addUserOption((o) => o.setName('user').setDescription('Whose, yours if empty')).toJSON(),
  text: { aliases: ['bal', 'wallet'], args: ['user'] },
  run: (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Yen lives in servers.');
    const id = ctx.user('user') ?? ctx.userId;
    const w = store.wallet(ctx.guildId, id);
    return ctx.reply({ content: `💴 <@${id}> has **${fmt(w.yen)}**${w.streak ? ` · daily streak ${w.streak}` : ''}`, temp: true });
  },
};

const give: Command = {
  name: 'give',
  group: 'eco',
  data: new SlashCommandBuilder().setName('give').setDescription('Hand some of your yen to someone')
    .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
    .addIntegerOption((o) => o.setName('amount').setDescription('How much').setRequired(true).setMinValue(1).setMaxValue(10_000_000)).toJSON(),
  text: { aliases: ['pay'], args: ['user', 'amount'] },
  run: (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Yen lives in servers.');
    const to = ctx.user('user');
    const n = ctx.int('amount');
    if (!to || !n || n < 1) return ctx.reply('Like this: `tz give @someone 100`');
    if (to === ctx.userId) return ctx.reply('Paying yourself? That\'s just moving money between pockets.');
    if (!store.pay(ctx.guildId, ctx.userId, -n)) return ctx.reply(`You don't have ${fmt(n)}.`);
    store.pay(ctx.guildId, to, n);
    return ctx.reply({ content: `💸 <@${ctx.userId}> gave <@${to}> **${fmt(n)}**.`, ping: [to], public: true, temp: true });
  },
};

const rich: Command = {
  name: 'rich',
  group: 'eco',
  as: 'top',
  data: new SlashCommandBuilder().setName('rich').setDescription('The richest people in the server').toJSON(),
  text: { aliases: ['baltop', 'richest'] },
  run: (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Yen lives in servers.');
    const rows = store.richest(ctx.guildId);
    const medal = ['🥇', '🥈', '🥉'];
    const body = rows.length ? rows.map((r, i) => `${medal[i] ?? `\`#${i + 1}\``} <@${r.user_id}> · **${fmt(r.yen)}**`).join('\n') : 'Everyone is broke. Very relatable.';
    return ctx.reply({ embeds: [card({ kind: 'ecoTop', title: 'Deepest pockets', emoji: '💴', gif: 'off', body })] });
  },
};

const shop: Command = {
  name: 'roleshop',
  group: 'eco',
  as: 'shop',
  data: new SlashCommandBuilder().setName('roleshop').setDescription('Roles you can buy with yen')
    .addSubcommand((s) => s.setName('view').setDescription('What\'s for sale'))
    .addSubcommand((s) => s.setName('buy').setDescription('Buy a role')
      .addIntegerOption((o) => o.setName('id').setDescription('Item number').setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName('add').setDescription('Put a role up for sale (admins)')
      .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
      .addIntegerOption((o) => o.setName('price').setDescription('Price in yen').setRequired(true).setMinValue(1).setMaxValue(100_000_000)))
    .addSubcommand((s) => s.setName('remove').setDescription('Take an item off sale (admins)')
      .addIntegerOption((o) => o.setName('id').setDescription('Item number').setRequired(true).setMinValue(1)))
    .toJSON(),
  text: { aliases: ['market'], sub: true, subArgs: { buy: ['id'], add: ['role', 'price'], remove: ['id'] } },
  run: async (ctx, store) => {
    if (!ctx.guild) return ctx.reply('Yen lives in servers.');
    const sub = ctx.sub() ?? 'view';
    const items = store.shopItems(ctx.guild.id);
    if (sub === 'add' || sub === 'remove') {
      if (!ctx.member?.permissions.has(PermissionFlagsBits.ManageRoles)) return ctx.reply('Only people who manage roles can stock the shop.');
      if (sub === 'remove') return ctx.reply(store.removeShopItem(ctx.guild.id, ctx.int('id') ?? 0) ? '🗑️ Off the shelf.' : 'No item with that number.');
      const roleId = ctx.role('role');
      const price = ctx.int('price');
      if (!roleId || !price) return ctx.reply('Like this: `tz market add @role 5000`');
      const role = await ctx.guild.roles.fetch(roleId).catch(() => null);
      const me = await ctx.guild.members.fetchMe();
      if (!role || role.managed || role.id === ctx.guild.id || role.position >= me.roles.highest.position) return ctx.reply('I can\'t hand out that role. Move my role above it first.');
      const id = store.addShopItem(ctx.guild.id, roleId, price);
      return ctx.reply(`🛍️ Item #${id}: <@&${roleId}> for **${fmt(price)}**.`);
    }
    if (sub === 'buy') {
      const item = items.find((x) => x.id === ctx.int('id'));
      if (!item) return ctx.reply('No item with that number. `tz market` shows the shelf.');
      if (ctx.member?.roles.cache.has(item.role_id)) return ctx.reply('You already have that one.');
      if (!store.pay(ctx.guild.id, ctx.userId, -item.price)) return ctx.reply(`That costs ${fmt(item.price)}, you have ${fmt(store.wallet(ctx.guild.id, ctx.userId).yen)}.`);
      const ok = await ctx.member?.roles.add(item.role_id, 'bought in the role shop').then(() => true).catch(() => false);
      if (!ok) { store.pay(ctx.guild.id, ctx.userId, item.price); return ctx.reply('I couldn\'t give you the role, your yen is back. Tell an admin to check my permissions.'); }
      return ctx.reply({ content: `🛍️ <@&${item.role_id}> is yours. ${say('ecoBuy')}`, temp: true });
    }
    const w = store.wallet(ctx.guild.id, ctx.userId);
    const body = items.length
      ? items.map((x) => `\`#${x.id}\` <@&${x.role_id}> · **${fmt(x.price)}**${ctx.member?.roles.cache.has(x.role_id) ? ' · owned' : ''}`).join('\n')
      : 'The shelves are empty. Admins stock them with `/eco shop add`.';
    return ctx.reply({ embeds: [card({ kind: 'ecoShop', title: 'Role shop', emoji: '🛍️', gif: 'off', body, fields: [{ name: '👛 You have', value: fmt(w.yen), inline: true }] })] });
  },
};

export const economy: Module = {
  name: 'economy',
  label: 'Economy',
  about: 'Yen from a daily claim, chatting and games, and a shop where admins sell roles',
  commands: [daily, balance, give, rich, shop],
};
