import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
  type Interaction, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Store } from '../db.js';
import type { Command } from '../core/module.js';

// the back room of Bar Lupin: coin flips, slots and blackjack for yen. Everything edits its own message, nothing piles up.

const MIN = 10;
const MAX = 10_000;
const fmt = (n: number) => `¥${n.toLocaleString()}`;
const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);

// a bet is a number, or "all" / "half" of what's in the wallet
function betOf(raw: string | null, have: number): number | null {
  const s = (raw ?? '').toLowerCase().replace(/[,¥]/g, '');
  const n = s === 'all' ? have : s === 'half' ? Math.floor(have / 2) : Number.parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX) : null;
}

function checkBet(store: Store, guild: string, user: string, raw: string | null): { bet: number } | { error: string } {
  const have = store.wallet(guild, user).yen;
  const bet = betOf(raw, have);
  if (!bet) return { error: `How much? Like \`100\`, \`half\` or \`all\`, from ${fmt(MIN)} to ${fmt(MAX)}.` };
  if (bet < MIN) return { error: `The smallest bet at the table is ${fmt(MIN)}.` };
  if (bet > have) return { error: `You've got ${fmt(have)}. Kunikida doesn't do credit.` };
  return { bet };
}

const card = (title: string, body: string, colour: number) => new EmbedBuilder().setColor(colour).setTitle(title).setDescription(body);
const WIN = 0x3fa76a;
const LOSE = 0xc8283c;
const PLAY = 0xc8a97e;

const coinflip: Command = {
  name: 'coinflip',
  cooldown: 4,
  data: new SlashCommandBuilder().setName('coinflip').setDescription('Bet yen on a coin flip, double or nothing')
    .addStringOption((o) => o.setName('bet').setDescription('How much, or half / all').setRequired(true))
    .addStringOption((o) => o.setName('side').setDescription('Heads or tails').addChoices({ name: 'heads', value: 'heads' }, { name: 'tails', value: 'tails' })).toJSON(),
  text: { aliases: ['flipbet', 'cfb'], args: ['bet', 'side'] },
  example: '100 heads',
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Bets live in servers.');
    const c = checkBet(store, ctx.guildId, ctx.userId, ctx.str('bet'));
    if ('error' in c) return ctx.reply({ content: c.error, temp: true });
    const pick = /^t/i.test(ctx.str('side') ?? '') ? 'tails' : 'heads';
    const landed = Math.random() < 0.5 ? 'heads' : 'tails';
    const won = landed === pick;
    store.pay(ctx.guildId, ctx.userId, won ? c.bet : -c.bet);
    const now = store.wallet(ctx.guildId, ctx.userId).yen;
    return ctx.reply({ embeds: [card(`🪙 ${landed}`, `${won ? `You called ${pick}. **+${fmt(c.bet)}**` : `You called ${pick}. **−${fmt(c.bet)}**, Dazai pockets it.`}\n-# wallet ${fmt(now)}`, won ? WIN : LOSE)], public: true });
  },
};

// three reels, weighted so the shiny ones are rare
const REEL: [string, number][] = [['🍒', 30], ['🍋', 25], ['🍙', 20], ['🦀', 14], ['🔔', 8], ['💎', 3]];
const PAYS: Record<string, number> = { '🍒': 3, '🍋': 4, '🍙': 5, '🦀': 8, '🔔': 15, '💎': 50 };
const spin = () => {
  let r = Math.random() * REEL.reduce((s, [, w]) => s + w, 0);
  for (const [e, w] of REEL) { if ((r -= w) < 0) return e; }
  return '🍒';
};

const slots: Command = {
  name: 'slots',
  cooldown: 5,
  data: new SlashCommandBuilder().setName('slots').setDescription('Pull the Lupin slot machine for yen')
    .addStringOption((o) => o.setName('bet').setDescription('How much, or half / all').setRequired(true)).toJSON(),
  text: { aliases: ['slot'], args: ['bet'] },
  example: '200',
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Bets live in servers.');
    const c = checkBet(store, ctx.guildId, ctx.userId, ctx.str('bet'));
    if ('error' in c) return ctx.reply({ content: c.error, temp: true });
    const reels = [spin(), spin(), spin()];
    const three = reels[0] === reels[1] && reels[1] === reels[2];
    const two = !three && new Set(reels).size === 2;
    const pair = two ? reels.find((r, i) => reels.indexOf(r) !== i)! : null;
    // three alike pays the table, a pair of crabs or better gets the bet back and a half
    const back = three ? c.bet * PAYS[reels[0]] : pair && PAYS[pair] >= 8 ? Math.floor(c.bet * 1.5) : 0;
    store.pay(ctx.guildId, ctx.userId, back - c.bet);
    const now = store.wallet(ctx.guildId, ctx.userId).yen;
    const line = three ? `**Jackpot row.** ${PAYS[reels[0]]}× pays **+${fmt(back - c.bet)}**` : back ? `A pair of ${pair}. **+${fmt(back - c.bet)}**` : `Nothing lines up. **−${fmt(c.bet)}**`;
    return ctx.reply({ embeds: [card('🎰 Lupin slots', `## ${reels.join(' ')}\n${line}\n-# 🍒3× 🍋4× 🍙5× 🦀8× 🔔15× 💎50× for three alike · wallet ${fmt(now)}`, back > c.bet ? WIN : back ? PLAY : LOSE)], public: true });
  },
};

// ---------- blackjack, played on one message with buttons ----------
type Hand = number[];
interface Game { guild: string; user: string; bet: number; deck: number[]; you: Hand; dealer: Hand; doubled: boolean; at: number }
const games = new Map<string, Game>();
const face = (c: number) => ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][c % 13] + ['♠', '♥', '♦', '♣'][Math.floor(c / 13) % 4];
const value = (h: Hand) => {
  let total = 0;
  let aces = 0;
  for (const c of h) { const r = c % 13; if (r === 0) { aces++; total += 11; } else total += Math.min(10, r + 1); }
  while (total > 21 && aces--) total -= 10;
  return total;
};
const deck = () => Array.from({ length: 52 }, (_, i) => i).sort(() => Math.random() - 0.5);

function table(g: Game, end: string | null) {
  const you = value(g.you);
  const shown = end ? g.dealer.map(face).join(' ') : `${face(g.dealer[0])} 🂠`;
  const dv = end ? ` (${value(g.dealer)})` : '';
  const e = card(`🃏 Blackjack · ${fmt(g.bet)}${g.doubled ? ' doubled' : ''}`,
    `**Dealer**${dv}\n${shown}\n\n**You** (${you})\n${g.you.map(face).join(' ')}${end ? `\n\n${end}` : ''}`,
    end ? (/won|blackjack/i.test(end) ? WIN : /push/i.test(end) ? PLAY : LOSE) : PLAY);
  const id = (a: string) => `bj|${a}|${g.user}`;
  const rows = end ? [] : [row(
    new ButtonBuilder().setCustomId(id('hit')).setLabel('Hit').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(id('stand')).setLabel('Stand').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(id('double')).setLabel('Double').setStyle(ButtonStyle.Secondary).setDisabled(g.you.length > 2),
  )];
  return { embeds: [e], components: rows };
}

// the dealer draws to 17, then the money moves once
function settle(store: Store, g: Game): string {
  games.delete(g.user);
  const you = value(g.you);
  if (you > 21) { store.pay(g.guild, g.user, -g.bet); return `Bust. **−${fmt(g.bet)}**`; }
  while (value(g.dealer) < 17) g.dealer.push(g.deck.pop()!);
  const d = value(g.dealer);
  const natural = you === 21 && g.you.length === 2;
  if (d > 21 || you > d) {
    const win = natural ? Math.floor(g.bet * 1.5) : g.bet;
    store.pay(g.guild, g.user, win);
    return `${natural ? 'Blackjack!' : 'You won.'} **+${fmt(win)}**`;
  }
  if (you === d) return 'Push, your bet comes back.';
  store.pay(g.guild, g.user, -g.bet);
  return `The house wins. **−${fmt(g.bet)}**`;
}

const blackjack: Command = {
  name: 'blackjack',
  cooldown: 5,
  data: new SlashCommandBuilder().setName('blackjack').setDescription('A hand of blackjack against the Lupin dealer')
    .addStringOption((o) => o.setName('bet').setDescription('How much, or half / all').setRequired(true)).toJSON(),
  text: { aliases: ['bj', '21'], args: ['bet'] },
  example: '500',
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Bets live in servers.');
    const old = games.get(ctx.userId);
    if (old && Date.now() - old.at < 120_000) return ctx.reply({ content: 'Finish the hand you\'ve got open first.', temp: true });
    const c = checkBet(store, ctx.guildId, ctx.userId, ctx.str('bet'));
    if ('error' in c) return ctx.reply({ content: c.error, temp: true });
    const d = deck();
    const g: Game = { guild: ctx.guildId, user: ctx.userId, bet: c.bet, deck: d, you: [d.pop()!, d.pop()!], dealer: [d.pop()!, d.pop()!], doubled: false, at: Date.now() };
    games.set(ctx.userId, g);
    // a natural 21 settles straight away
    if (value(g.you) === 21) return ctx.reply({ ...table(g, settle(store, g)), public: true });
    return ctx.reply({ ...table(g, null), public: true });
  },
};

export async function onCasino(store: Store, i: Interaction): Promise<boolean> {
  if (!i.isButton() || !i.customId.startsWith('bj|')) return false;
  const [, what, owner] = i.customId.split('|');
  if (i.user.id !== owner) { await i.reply({ content: 'Not your hand. Deal your own with `tz bj 100`.', flags: MessageFlags.Ephemeral }); return true; }
  const g = games.get(owner);
  if (!g) { await i.update({ components: [] }).catch(() => {}); return true; }
  g.at = Date.now();
  if (what === 'double') {
    if (store.wallet(g.guild, g.user).yen < g.bet * 2) { await i.reply({ content: 'Not enough yen to double.', flags: MessageFlags.Ephemeral }); return true; }
    g.bet *= 2;
    g.doubled = true;
    g.you.push(g.deck.pop()!);
    await i.update(table(g, settle(store, g)));
    return true;
  }
  if (what === 'hit') {
    g.you.push(g.deck.pop()!);
    if (value(g.you) >= 21) { await i.update(table(g, settle(store, g))); return true; }
    await i.update(table(g, null));
    return true;
  }
  await i.update(table(g, settle(store, g)));
  return true;
}

// ---------- the admin side: hand out or take yen ----------
export const money: Command = {
  name: 'money',
  admin: true,
  data: new SlashCommandBuilder().setName('money').setDescription('Give, take or set someone\'s yen (admins)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((c) => c.setName('give').setDescription('Add yen').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)).addIntegerOption((o) => o.setName('amount').setDescription('How much').setRequired(true).setMinValue(1).setMaxValue(10_000_000)))
    .addSubcommand((c) => c.setName('take').setDescription('Take yen away').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)).addIntegerOption((o) => o.setName('amount').setDescription('How much').setRequired(true).setMinValue(1).setMaxValue(10_000_000)))
    .addSubcommand((c) => c.setName('set').setDescription('Set an exact amount').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)).addIntegerOption((o) => o.setName('amount').setDescription('New balance').setRequired(true).setMinValue(0).setMaxValue(10_000_000)))
    .toJSON(),
  text: { aliases: ['yenadmin'], sub: true, subArgs: { give: ['user', 'amount'], take: ['user', 'amount'], set: ['user', 'amount'] } },
  example: 'give @someone 500',
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Yen lives in servers.');
    const sub = ctx.sub();
    const user = ctx.user('user');
    const amount = ctx.int('amount');
    if (!sub || !['give', 'take', 'set'].includes(sub) || !user || amount === null) return ctx.reply({ content: 'Like this: `tz money give @someone 500`, `tz money take @someone 200`, `tz money set @someone 1000`.', temp: true });
    const have = store.wallet(ctx.guildId, user).yen;
    const change = sub === 'give' ? amount : sub === 'take' ? -Math.min(amount, have) : amount - have;
    store.pay(ctx.guildId, user, change);
    const now = store.wallet(ctx.guildId, user).yen;
    return ctx.reply({ content: `💴 <@${user}> ${change >= 0 ? `+${fmt(change)}` : `−${fmt(-change)}`}, now ${fmt(now)}.`, temp: true });
  },
};

export const casinoCommands = [coinflip, slots, blackjack];
