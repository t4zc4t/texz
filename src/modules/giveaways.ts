import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
  type Client, type Guild, type GuildMember, type Interaction, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Giveaway, Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import { parseLength, human } from './moderation.js';
import { levelOf } from './levels.js';
import { card } from '../theme.js';

export interface GiveawayRules {
  // any one of these roles lets you in
  needRoles: string[];
  blockRoles: string[];
  minLevel: number;
  minMessages: number;
  minAccountDays: number;
  minServerDays: number;
  // server boosters get this many tickets instead of one
  boosterBonus: number;
  // role → tickets, the best one counts
  bonusRoles: Record<string, number>;
}

const noRules = (): GiveawayRules => ({ needRoles: [], blockRoles: [], minLevel: 0, minMessages: 0, minAccountDays: 0, minServerDays: 0, boosterBonus: 1, bonusRoles: {} });
const rulesOf = (g: Giveaway): GiveawayRules => ({ ...noRules(), ...JSON.parse(g.rules) });
const unix = (ms: number) => Math.floor(ms / 1000);
const DAY = 86_400_000;

// why someone can't enter, or null when they can
export function blocker(store: Store, r: GiveawayRules, m: GuildMember, now = Date.now()): string | null {
  if (m.user.bot) return 'Bots don\'t win prizes. I checked.';
  if (r.blockRoles.some((id) => m.roles.cache.has(id))) return 'One of your roles can\'t enter this one.';
  if (r.needRoles.length && !r.needRoles.some((id) => m.roles.cache.has(id))) return `You need one of these roles: ${r.needRoles.map((id) => `<@&${id}>`).join(', ')}`;
  if (r.minLevel && levelOf(store.xpOf(m.guild.id, m.id).xp).level < r.minLevel) return `You need to be level **${r.minLevel}** here first.`;
  if (r.minMessages && (store.activity(m.guild.id, m.id)?.messages ?? 0) < r.minMessages) {
    return `You need **${r.minMessages}** messages here, you have ${store.activity(m.guild.id, m.id)?.messages ?? 0}.`;
  }
  if (r.minAccountDays && now - m.user.createdTimestamp < r.minAccountDays * DAY) return `Your account needs to be **${r.minAccountDays} days** old.`;
  if (r.minServerDays && now - (m.joinedTimestamp ?? now) < r.minServerDays * DAY) return `You need to have been here **${r.minServerDays} days**.`;
  return null;
}

export function tickets(r: GiveawayRules, m: GuildMember): number {
  const boost = m.premiumSinceTimestamp ? r.boosterBonus : 1;
  const role = Math.max(1, ...m.roles.cache.map((x) => r.bonusRoles[x.id] ?? 1));
  return Math.max(boost, role);
}

// weighted draw without putting anyone in twice
export function draw<T>(pool: { who: T; weight: number }[], count: number, rand = Math.random): T[] {
  const left = [...pool];
  const out: T[] = [];
  while (out.length < count && left.length) {
    const total = left.reduce((a, p) => a + p.weight, 0);
    let roll = rand() * total;
    const i = left.findIndex((p) => (roll -= p.weight) < 0);
    out.push(left.splice(i < 0 ? left.length - 1 : i, 1)[0].who);
  }
  return out;
}

function rulesText(r: GiveawayRules): string {
  const lines = [
    r.needRoles.length && `🎭 needs ${r.needRoles.map((id) => `<@&${id}>`).join(' or ')}`,
    r.blockRoles.length && `🚫 not for ${r.blockRoles.map((id) => `<@&${id}>`).join(', ')}`,
    r.minLevel && `🎖️ level ${r.minLevel}+`,
    r.minMessages && `💬 ${r.minMessages}+ messages here`,
    r.minAccountDays && `🪪 account ${r.minAccountDays}+ days old`,
    r.minServerDays && `🏠 here for ${r.minServerDays}+ days`,
    r.boosterBonus > 1 && `💎 boosters get ${r.boosterBonus}x the chance`,
    ...Object.entries(r.bonusRoles).map(([id, n]) => `🍀 <@&${id}> gets ${n}x the chance`),
  ].filter(Boolean);
  return lines.join('\n');
}

function view(store: Store, g: Giveaway) {
  const r = rulesOf(g);
  const count = store.entries(g.id).length;
  const done = !!g.ended;
  const winners = g.picked ? JSON.parse(g.picked) as string[] : [];
  const e = card({
    kind: done ? (winners.length ? 'giveawayEnd' : 'giveawayNone') : 'giveaway', title: g.prize, emoji: '🎁', gif: 'off',
    fields: [
      { name: done ? '🏁 Ended' : '⏳ Ends', value: `<t:${unix(g.ends_at)}:R>`, inline: true },
      { name: '🏆 Winners', value: done ? (winners.map((id) => `<@${id}>`).join(' ') || '*nobody*') : String(g.winners), inline: true },
      { name: '🎟️ Entries', value: String(count), inline: true },
      { name: '🕵️ Hosted by', value: `<@${g.host_id}>`, inline: true },
      ...(rulesText(r) ? [{ name: '📋 Conditions', value: rulesText(r), inline: false }] : []),
    ],
  });
  e.setFooter({ text: `Giveaway #${g.id}${done ? '' : ' · press the button to enter, again to leave'}` });
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`gw|${g.id}|enter`).setLabel(done ? 'Ended' : 'Enter').setEmoji('🎉').setStyle(done ? ButtonStyle.Secondary : ButtonStyle.Success).setDisabled(done),
  );
  return { embeds: [e], components: [row] };
}

async function refresh(client: Client, store: Store, g: Giveaway) {
  if (!g.message_id) return;
  const ch = await client.channels.fetch(g.channel_id).catch(() => null);
  if (!ch?.isTextBased()) return;
  const msg = await ch.messages.fetch(g.message_id).catch(() => null);
  await msg?.edit(view(store, g)).catch(() => {});
}

// entry counts on the message are refreshed at most every few seconds, a busy giveaway would hit rate limits otherwise
const pendingRefresh = new Map<number, NodeJS.Timeout>();
function refreshSoon(client: Client, store: Store, id: number) {
  if (pendingRefresh.has(id)) return;
  pendingRefresh.set(id, setTimeout(() => {
    pendingRefresh.delete(id);
    const g = store.giveaway(id);
    if (g && !g.ended) void refresh(client, store, g);
  }, 5000));
}

async function pickWinners(guild: Guild, store: Store, g: Giveaway, count: number, skip: string[] = []) {
  const r = rulesOf(g);
  const pool: { who: string; weight: number }[] = [];
  for (const id of store.entries(g.id)) {
    if (skip.includes(id)) continue;
    const m = await guild.members.fetch(id).catch(() => null);
    // conditions are checked again at the draw, leaving the server or losing a role counts
    if (!m || blocker(store, r, m)) continue;
    pool.push({ who: id, weight: tickets(r, m) });
  }
  return draw(pool, count);
}

export async function finish(client: Client, store: Store, g: Giveaway) {
  store.updateGiveaway(g.id, { ended: 1 });
  const guild = await client.guilds.fetch(g.guild_id).catch(() => null);
  const winners = guild ? await pickWinners(guild, store, g, g.winners) : [];
  store.updateGiveaway(g.id, { picked: JSON.stringify(winners) });
  const done = store.giveaway(g.id)!;
  await refresh(client, store, done);
  const ch = await client.channels.fetch(g.channel_id).catch(() => null);
  if (!ch?.isSendable()) return;
  const text = winners.length
    ? `🎉 ${winners.map((id) => `<@${id}>`).join(', ')} won **${g.prize}**! Congratulations, the Agency will pretend it's not jealous.`
    : `Nobody could win **${g.prize}**. Not one eligible soul. How tragic.`;
  await ch.send({ content: text, allowedMentions: { users: winners }, ...(g.message_id ? { reply: { messageReference: g.message_id, failIfNotExists: false } } : {}) }).catch(() => {});
}

export function startGiveaways(client: Client, store: Store) {
  const tick = async () => {
    for (const g of store.dueGiveaways(Date.now())) await finish(client, store, g).catch((e) => console.error('giveaway', e));
  };
  setInterval(() => void tick(), 15_000);
  void tick();
}

export async function onGiveawayButton(store: Store, i: Interaction): Promise<boolean> {
  if (!i.isButton() || !i.customId.startsWith('gw|') || !i.guild) return false;
  const [, rawId, what] = i.customId.split('|');
  const g = store.giveaway(Number(rawId));
  if (!g || g.ended) {
    await i.reply({ content: 'This giveaway is over.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const entered = store.entries(g.id).includes(i.user.id);
  if (what === 'leave' || (what === 'enter' && entered)) {
    if (what === 'enter') {
      // first press asks, so a misclick doesn't quietly take someone out
      await i.reply({
        content: 'You\'re already in. Want out?', flags: MessageFlags.Ephemeral,
        components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`gw|${g.id}|leave`).setLabel('Leave the giveaway').setStyle(ButtonStyle.Danger))],
      });
      return true;
    }
    if (entered) store.toggleEntry(g.id, i.user.id);
    await i.update({ content: 'You\'re out. Your loss, quite literally.', components: [] });
    refreshSoon(i.client, store, g.id);
    return true;
  }
  const m = await i.guild.members.fetch(i.user.id).catch(() => null);
  const why = m ? blocker(store, rulesOf(g), m) : 'I couldn\'t find you in this server.';
  if (why) {
    await i.reply({ content: `🚪 ${why}`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return true;
  }
  store.toggleEntry(g.id, i.user.id);
  const n = tickets(rulesOf(g), m!);
  await i.reply({ content: `🎟️ You're in${n > 1 ? ` with **${n}x** the chance` : ''}. Good luck, not that luck is a real thing.`, flags: MessageFlags.Ephemeral });
  refreshSoon(i.client, store, g.id);
  return true;
}

const giveaway: Command = {
  name: 'giveaway',
  admin: true,
  data: new SlashCommandBuilder().setName('giveaway').setDescription('Run giveaways with a button to enter (admins)')
    .addSubcommand((c) => c.setName('start').setDescription('Start one')
      .addStringOption((o) => o.setName('prize').setDescription('What they win').setRequired(true).setMaxLength(200))
      .addStringOption((o) => o.setName('length').setDescription('How long, like 1h, 2d or 1w').setRequired(true))
      .addIntegerOption((o) => o.setName('winners').setDescription('How many winners, 1 if empty').setMinValue(1).setMaxValue(20))
      .addChannelOption((o) => o.setName('channel').setDescription('Where, here if empty').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addRoleOption((o) => o.setName('need_role').setDescription('Only people with this role can enter'))
      .addRoleOption((o) => o.setName('block_role').setDescription('People with this role can\'t enter'))
      .addIntegerOption((o) => o.setName('min_level').setDescription('Lowest level allowed').setMinValue(1).setMaxValue(500))
      .addIntegerOption((o) => o.setName('min_messages').setDescription('Messages they need in this server').setMinValue(1).setMaxValue(1_000_000))
      .addIntegerOption((o) => o.setName('account_days').setDescription('Account at least this many days old').setMinValue(1).setMaxValue(3650))
      .addIntegerOption((o) => o.setName('server_days').setDescription('In the server at least this many days').setMinValue(1).setMaxValue(3650))
      .addIntegerOption((o) => o.setName('booster_bonus').setDescription('Server boosters get this many times the chance').setMinValue(2).setMaxValue(10))
      .addRoleOption((o) => o.setName('bonus_role').setDescription('A role that gets extra chances'))
      .addIntegerOption((o) => o.setName('bonus').setDescription('How many times the chance for bonus_role, 2 if empty').setMinValue(2).setMaxValue(10)))
    .addSubcommand((c) => c.setName('end').setDescription('End one now and draw')
      .addIntegerOption((o) => o.setName('id').setDescription('Giveaway number').setRequired(true).setMinValue(1)))
    .addSubcommand((c) => c.setName('reroll').setDescription('Pick new winners for an ended one')
      .addIntegerOption((o) => o.setName('id').setDescription('Giveaway number').setRequired(true).setMinValue(1))
      .addIntegerOption((o) => o.setName('winners').setDescription('How many to redraw, all if empty').setMinValue(1).setMaxValue(20)))
    .addSubcommand((c) => c.setName('cancel').setDescription('Call one off without winners')
      .addIntegerOption((o) => o.setName('id').setDescription('Giveaway number').setRequired(true).setMinValue(1)))
    .addSubcommand((c) => c.setName('list').setDescription('Running giveaways here'))
    .toJSON(),
  // tz gw start 1d 2 Nitro Classic, tz gw end 4, tz gw reroll 4
  text: { aliases: ['gw', 'gaw'], sub: true, subArgs: { start: ['length', 'winners', 'prize'], end: ['id'], reroll: ['id', 'winners'], cancel: ['id'] } },
  run: async (ctx, store) => {
    if (!ctx.guild) return ctx.reply('Giveaways live in servers.');
    const p = store.guild(ctx.guild.id).prefix;
    const sub = ctx.sub() ?? 'list';
    if (sub === 'start') {
      const ms = parseLength(ctx.str('length'));
      let winners = ctx.int('winners') ?? 1;
      let prize = ctx.str('prize');
      // "tz gw start 1d Nitro" works without a winner count
      if (ctx.viaText && ctx.str('winners') && Number.isNaN(Number(ctx.str('winners')))) { prize = `${ctx.str('winners')} ${prize ?? ''}`.trim(); winners = 1; }
      if (!ms || ms < 60_000 || ms > 60 * 86_400_000) return ctx.reply(`Like this: \`${p} gw start 1d 2 Nitro\` (length from a minute to 60 days, then winners, then the prize). Conditions are on \`/giveaway start\`.`);
      if (!prize) return ctx.reply('What\'s the prize?');
      if (winners < 1 || winners > 20) return ctx.reply('Between 1 and 20 winners.');
      const r = noRules();
      const need = ctx.role('need_role'); if (need) r.needRoles = [need];
      const block = ctx.role('block_role'); if (block) r.blockRoles = [block];
      r.minLevel = ctx.viaText ? 0 : ctx.int('min_level') ?? 0;
      r.minMessages = ctx.viaText ? 0 : ctx.int('min_messages') ?? 0;
      r.minAccountDays = ctx.viaText ? 0 : ctx.int('account_days') ?? 0;
      r.minServerDays = ctx.viaText ? 0 : ctx.int('server_days') ?? 0;
      r.boosterBonus = ctx.viaText ? 1 : ctx.int('booster_bonus') ?? 1;
      const bonusRole = ctx.role('bonus_role');
      if (bonusRole) r.bonusRoles[bonusRole] = ctx.int('bonus') ?? 2;
      if (r.minLevel && !store.rules(ctx.guild.id, 'levels').enabled) return ctx.reply('Levels are off here, so a level condition can\'t work. Switch them on in `/setup` first.');
      const chId = ctx.channel('channel') ?? ctx.channelId;
      const ch = await ctx.guild.channels.fetch(chId).catch(() => null);
      if (!ch?.isSendable()) return ctx.reply('I can\'t post in that channel.');
      const me = await ctx.guild.members.fetchMe();
      if (!ch.permissionsFor(me).has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return ctx.reply('I need Send Messages and Embed Links there.');
      const id = store.addGiveaway({ guild_id: ctx.guild.id, channel_id: ch.id, host_id: ctx.userId, prize, winners, ends_at: Date.now() + ms, rules: JSON.stringify(r) });
      const sent = await ch.send(view(store, store.giveaway(id)!)).catch(() => null);
      if (!sent) return ctx.reply('Discord wouldn\'t let me post it.');
      store.updateGiveaway(id, { message_id: sent.id });
      return ctx.reply(`🎁 Giveaway **#${id}** is up in <#${ch.id}>, ending in ${human(ms)}.`);
    }
    if (sub === 'list') {
      const list = store.activeGiveaways(ctx.guild.id);
      const body = list.length
        ? list.map((g) => `\`#${g.id}\` **${g.prize}** · ${g.winners} winner${g.winners === 1 ? '' : 's'} · <#${g.channel_id}> · ends <t:${unix(g.ends_at)}:R> · ${store.entries(g.id).length} in`).join('\n')
        : 'Nothing running. Generosity is on a break.';
      return ctx.reply({ embeds: [card({ kind: 'giveaway', title: 'Giveaways', emoji: '🎁', gif: 'off', body })], private: false });
    }
    const g = store.giveaway(ctx.int('id') ?? 0);
    if (!g || g.guild_id !== ctx.guild.id) return ctx.reply(`Which one? \`${p} gw list\` shows the numbers.`);
    if (sub === 'end') {
      if (g.ended) return ctx.reply('That one already ended. Use reroll for new winners.');
      store.updateGiveaway(g.id, { ends_at: Date.now() });
      await finish(ctx.guild.client, store, { ...g, ends_at: Date.now() });
      return ctx.reply(`🏁 Giveaway #${g.id} drawn.`);
    }
    if (sub === 'cancel') {
      if (g.ended) return ctx.reply('That one already ended.');
      store.updateGiveaway(g.id, { ended: 1, picked: '[]', ends_at: Date.now() });
      await refresh(ctx.guild.client, store, store.giveaway(g.id)!);
      return ctx.reply(`🗑️ Giveaway #${g.id} called off.`);
    }
    if (sub === 'reroll') {
      if (!g.ended) return ctx.reply('It hasn\'t ended yet. End it first, or let it run.');
      const old = g.picked ? JSON.parse(g.picked) as string[] : [];
      const n = Math.min(ctx.int('winners') ?? (old.length || g.winners), 20);
      const fresh = await pickWinners(ctx.guild, store, g, n, old);
      if (!fresh.length) return ctx.reply('Nobody left to draw from.');
      // a partial reroll swaps out the last few, a full one replaces everyone
      const kept = n >= old.length ? [] : old.slice(0, old.length - n);
      store.updateGiveaway(g.id, { picked: JSON.stringify([...kept, ...fresh]) });
      await refresh(ctx.guild.client, store, store.giveaway(g.id)!);
      const ch = await ctx.guild.channels.fetch(g.channel_id).catch(() => null);
      if (ch?.isSendable()) await ch.send({ content: `🔁 Reroll for **${g.prize}**: ${fresh.map((id) => `<@${id}>`).join(', ')}! Fate changed its mind.`, allowedMentions: { users: fresh } }).catch(() => {});
      return ctx.reply(`🔁 Rerolled giveaway #${g.id}.`);
    }
    return ctx.reply(`Like this: \`${p} gw start 1d 2 Nitro\`, \`${p} gw end 3\`, \`${p} gw reroll 3\`, \`${p} gw list\``);
  },
};

export const giveaways: Module = {
  name: 'giveaways',
  label: 'Giveaways',
  about: 'Timed giveaways with a button to enter, conditions like roles, level or messages, and extra chances for boosters',
  commands: [giveaway],
};
