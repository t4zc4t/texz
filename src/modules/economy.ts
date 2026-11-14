import { mycolour } from './mycolour.js';
import { casinoCommands, money } from './casino.js';
import { choresLine, hustleCommands, vaultOf } from './hustle.js';
import { track } from './missions.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, SlashCommandBuilder, type Message, type MessageActionRowComponentBuilder } from 'discord.js';
import type { Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import { card, pick, say } from '../theme.js';
import { fixText, setupButton } from '../core/fixes.js';
import { levelOf, perksFor } from './levels.js';

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
  // higher Agency ranks get a bigger daily
  const rankBonus = store.rules(guildId, 'levels').enabled ? perksFor(levelOf(store.xpOf(guildId, userId).xp).level).yen : 0;
  const got = DAILY_BASE + DAILY_STEP * Math.min(streak - 1, 6) + rankBonus;
  store.pay(guildId, userId, got, { daily_day: today(), streak });
  return { ok: true, got, streak };
}

// a couple of yen for chatting, once a minute, only where the economy is on
export function chatPay(store: Store, m: Message) {
  if (!m.guildId || m.author.bot || !store.rules(m.guildId, 'economy').enabled) return;
  const w = store.wallet(m.guildId, m.author.id);
  if (Date.now() - w.chat_at < 60_000) return;
  store.pay(m.guildId, m.author.id, CHAT_PAY, { chat_at: Date.now() });
  const extra = track(store, m.guildId, m.author.id, 'yen', w.yen + CHAT_PAY);
  if (extra.length && m.channel.isSendable()) void m.channel.send({ content: extra.join('\n'), allowedMentions: { users: [m.author.id] } }).catch(() => {});
}

const fmt = (n: number) => `${YEN}${n.toLocaleString()}`;

const daily: Command = {
  name: 'daily',
  group: 'you',
  hidden: true,
  data: new SlashCommandBuilder().setName('daily').setDescription('Collect your daily yen, more for each day in a row').toJSON(),
  text: { aliases: ['yen'] },
  run: (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Yen lives in servers.');
    const r = claimDaily(store, ctx.guildId, ctx.userId);
    if (!r.ok) return ctx.reply({ content: `⏳ Already collected today. Next one <t:${Math.floor(r.next / 1000)}:R>.`, temp: true });
    // every seventh day in a row opens a crate on top
    const crate = r.streak % 7 === 0 ? pick([['🍶', 'a bottle Mori forgot', 400], ['💼', 'a Guild briefcase', 650], ['🦀', 'a crate of crab', 500], ['📜', 'Fukuzawa\'s bonus envelope', 800], ['🎩', 'Chuuya\'s spare hat, pawned', 1200]] as [string, string, number][]) : null;
    if (crate) store.pay(ctx.guildId, ctx.userId, crate[2]);
    const w = store.wallet(ctx.guildId, ctx.userId);
    const week = Array.from({ length: 7 }, (_, i) => (i < ((r.streak - 1) % 7) + 1 ? '▰' : '▱')).join('');
    const extra = [
      `${week} day ${((r.streak - 1) % 7) + 1} of 7${crate ? '' : ` · crate on day 7`}`,
      ...(crate ? [`${crate[0]} **Day 7 crate:** ${crate[1]}, worth **+${fmt(crate[2])}**`] : []),
      ...track(store, ctx.guildId, ctx.userId, 'daily'),
      ...track(store, ctx.guildId, ctx.userId, 'dailyStreak', r.streak),
      ...track(store, ctx.guildId, ctx.userId, 'yen', w.yen),
    ];
    return ctx.reply({ content: [`💴 **+${fmt(r.got)}** · day ${r.streak} in a row · you have **${fmt(w.yen)}**`, ...extra, `-# ${say('ecoDaily')}`].join('\n'), temp: !crate });
  },
};

// balance, daily and the richest list on one page
const balance: Command = {
  name: 'wallet',
  group: 'you',
  data: new SlashCommandBuilder().setName('wallet').setDescription('Your yen (money), your daily and the richest people here')
    .addUserOption((o) => o.setName('user').setDescription('Whose, yours if empty')).toJSON(),
  text: { aliases: ['bal', 'balance'], args: ['user'] },
  run: (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Yen lives in servers.');
    const id = ctx.user('user') ?? ctx.userId;
    const w = store.wallet(ctx.guildId, id);
    const mine = id === ctx.userId;
    const ready = w.daily_day !== today();
    const next = Math.floor((Date.parse(`${today()}T00:00:00Z`) + 86_400_000) / 1000);
    const vault = vaultOf(store, ctx.guildId, id).yen;
    const worth = w.yen + vault;
    const top = store.richest(ctx.guildId, 1000);
    const place = top.findIndex((r) => r.user_id === id) + 1;
    const lines = [
      `👛 Wallet **${fmt(w.yen)}**${vault ? ` · 🏦 Vault **${fmt(vault)}**` : ''}`,
      `💎 Net worth **${fmt(worth)}**${place ? ` · #${place} richest here` : ''}`,
      w.streak ? `🔥 ${w.streak} day${w.streak === 1 ? '' : 's'} of daily in a row` : null,
      mine ? (ready ? '🎁 Your daily is **ready**' : `⏳ Next daily <t:${next}:R>`) : null,
      mine ? `\n${choresLine(store, ctx.guildId, id)}` : null,
      // a little character judgement on the bottom line
      `-# ${worth >= 1_000_000 ? 'Mori would like a word about your tax situation.' : worth >= 100_000 ? 'Comfortable. The Guild might try to recruit you.' : worth >= 10_000 ? 'Doing well. Kunikida approves of the budgeting.' : worth >= 1000 ? 'Enough for crab tonight.' : 'Broke, like Dazai. At least you\'re in good company.'}`,
    ].filter(Boolean).join('\n');
    const btn = (cmd: string, emoji: string, label: string, on = false) => new ButtonBuilder().setCustomId(`nav|${cmd}|owner=${ctx.userId}`).setEmoji(emoji).setLabel(label).setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary);
    const rows = [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      ...(mine ? [btn('daily', '🎁', ready ? 'Claim daily' : 'Daily', ready)] : []),
      btn('rich', '🏆', 'Richest'),
      ...(mine ? [btn('bank', '🏦', 'Vault')] : []),
      btn('roleshop.view', '🛍️', 'Role shop'),
    )];
    return ctx.reply({ embeds: [card({ kind: 'help', title: mine ? 'Your ledger' : 'Ledger', emoji: '👛', gif: 'off', body: lines })], components: rows });
  },
};

const give: Command = {
  name: 'give',
  group: 'you',
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
    const extra = [...track(store, ctx.guildId, ctx.userId, 'gave', n), ...track(store, ctx.guildId, to, 'yen', store.wallet(ctx.guildId, to).yen)];
    return ctx.reply({ content: [`💸 <@${ctx.userId}> gave <@${to}> **${fmt(n)}**.`, ...extra].join('\n'), ping: [to], public: true, temp: !extra.length });
  },
};

const rich: Command = {
  name: 'rich',
  group: 'you',
  hidden: true,
  as: 'top',
  data: new SlashCommandBuilder().setName('rich').setDescription('The richest people in the server').toJSON(),
  text: { aliases: ['baltop', 'richest'] },
  run: (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Yen lives in servers.');
    const medal = ['🥇', '🥈', '🥉'];
    // vaults count too, the list is by everything someone owns
    const all = store.richest(ctx.guildId, 1000).map((r) => ({ ...r, worth: r.yen + vaultOf(store, ctx.guildId!, r.user_id).yen })).sort((a, b) => b.worth - a.worth);
    const me = all.findIndex((r) => r.user_id === ctx.userId);
    const body = all.length ? all.slice(0, 10).map((r, i) => `${medal[i] ?? `\`#${i + 1}\``} <@${r.user_id}> · **${fmt(r.worth)}**${r.user_id === ctx.userId ? ' ← you' : ''}`).join('\n')
      + (me >= 10 ? `\n⋯\n\`#${me + 1}\` <@${ctx.userId}> · **${fmt(all[me].worth)}** ← you\n-# ${fmt(all[me - 1].worth - all[me].worth)} more to pass #${me}` : '')
      : 'Everyone is broke. Very relatable.';
    return ctx.reply({ embeds: [card({ kind: 'ecoTop', title: 'Deepest pockets', emoji: '💴', gif: 'off', body: `${body}\n-# wallet plus vault` })] });
  },
};

const shop: Command = {
  name: 'roleshop',
  group: 'you',
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
      if (!role || role.managed || role.id === ctx.guild.id) return ctx.reply('That role can\'t be handed out by a bot.');
      if (role.position >= me.roles.highest.position) return ctx.reply({ content: fixText(ctx.guild, { roles: [role], doing: `sell ${role.name}` }) ?? '', components: [setupButton(ctx.userId)] });
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
      : 'The shelves are empty. Admins stock them with `/yen view:shop`.';
    return ctx.reply({ embeds: [card({ kind: 'ecoShop', title: 'Role shop', emoji: '🛍️', gif: 'off', body, fields: [{ name: '👛 You have', value: fmt(w.yen), inline: true }] })] });
  },
};

export const economy: Module = {
  name: 'economy',
  label: 'Economy',
  about: 'Yen from a daily claim, chatting and games, and a shop where admins sell roles',
  commands: [daily, balance, give, rich, shop, mycolour, ...casinoCommands, ...hustleCommands, money],
};
