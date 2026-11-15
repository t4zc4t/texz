import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
  type Interaction, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Store } from '../db.js';
import type { Command } from '../core/module.js';
import { SLOT_SYMS, casinoEmoji as art, slotEmoji, type SlotSym } from '../features/slotart.js';

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

// not enough on you: say what is, and where the rest is if it's sitting in the vault
export function shortOf(store: Store, guild: string, user: string, bet: number, have: number) {
  const vault = (JSON.parse(store.getKv(`bank:${guild}:${user}`) ?? '{"yen":0}') as { yen: number }).yen;
  const need = bet - have;
  if (vault >= need) return `You've only got **${fmt(have)}** on you, the other **${fmt(vault)}** is in your vault. Bets come out of your wallet, take some out first with \`tz bank withdraw ${need <= 1000 ? Math.ceil(need / 100) * 100 : 'all'}\`.`;
  return `You've got **${fmt(have)}**${vault ? ` on you and **${fmt(vault)}** in the vault` : ''}. Kunikida doesn't do credit.`;
}

function checkBet(store: Store, guild: string, user: string, raw: string | null): { bet: number } | { error: string } {
  const have = store.wallet(guild, user).yen;
  const bet = betOf(raw, have);
  if (!bet) return { error: `How much? Like \`100\`, \`half\` or \`all\`, from ${fmt(MIN)} to ${fmt(MAX)}.` };
  if (bet < MIN) return { error: `The smallest bet at the table is ${fmt(MIN)}.` };
  if (bet > have) return { error: shortOf(store, guild, user, bet, have) };
  return { bet };
}

const card = (title: string, body: string, colour: number) => new EmbedBuilder().setColor(colour).setTitle(title).setDescription(body);
const pickLine = (a: string[]) => a[Math.floor(Math.random() * a.length)];
const COIN_LOST = ['and lost it all. Dazai caught it and kept it.', 'and lost it all. Kunikida notes it in the ledger.', 'and lost it all. The coin feels nothing.'];
const WIN = 0x3fa76a;
const LOSE = 0xc8283c;
const PLAY = 0xc8a97e;

// a game told in a few edits of one message, the money already settled before the first one
export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Editable = { edit: (v: unknown) => Promise<unknown> };
export const messageOf = (sent: unknown): Editable | null => {
  const m = (sent as { resource?: { message?: unknown } })?.resource?.message ?? sent;
  return m && typeof (m as { edit?: unknown }).edit === 'function' ? m as Editable : null;
};
export async function playOut(ctx: import('../core/ctx.js').Ctx, frames: string[], gaps: number[]) {
  const sent = await ctx.reply({ content: frames[0], public: true, temp: false });
  const msg = messageOf(sent);
  if (!msg) return;
  for (let k = 1; k < frames.length; k++) { await pause(gaps[k - 1] ?? 900); await msg.edit({ content: frames[k] }).catch(() => {}); }
}
export const nameOf = (ctx: import('../core/ctx.js').Ctx) => (ctx.member && 'displayName' in ctx.member ? ctx.member.displayName : null) ?? 'You';
export const banner = (t: string) => `**\`  ${t}  \`**`;

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
    const who = `**${nameOf(ctx)}** bet **${fmt(c.bet)}** on **${pick}**, ${pick === 'heads' ? 'the Agency' : 'the Port Mafia'}`;
    const top = banner('THE LUPIN COIN');
    const end = won ? `and won **${fmt(c.bet * 2)}**` : pickLine(COIN_LOST);
    await playOut(ctx, [
      `${top}\n${who}\n${art('coin_spin')} the coin is in the air...`,
      `${top}\n${who}\n${art(`coin_${landed}`)} it lands on **${landed}** ${end}`,
    ], [2200]);
  },
};

// No Longer Human: three reels that stop one by one, and only three alike pays, like the OwO machine
// the odds are set up front so the payback stays near 95%
const ODDS: [SlotSym, number, number][] = [ // symbol, chance in 1000, what three of them pay back
  ['cherry', 200, 1], ['lemon', 200, 2], ['bell', 50, 3], ['gem', 25, 4], ['seven', 10, 10],
];
const any = () => SLOT_SYMS[Math.floor(Math.random() * SLOT_SYMS.length)];
function pull(): { reels: SlotSym[]; mult: number } {
  let r = Math.random() * 1000;
  for (const [s, w, m] of ODDS) { if ((r -= w) < 0) return { reels: [s, s, s], mult: m }; }
  // a loss, a near miss now and then: the first two match and the last one breaks it
  const reels: SlotSym[] = Math.random() < 0.35 ? (() => { const s = any(); let t = any(); while (t === s) t = any(); return [s, s, t]; })() : [any(), any(), any()];
  while (reels[0] === reels[1] && reels[1] === reels[2]) reels[2] = any();
  return { reels, mult: 0 };
}
const LOST = [
  'and lost it all. *How wonderfully tragic,* says Dazai.',
  'and lost it all. Kunikida wrote it down in the ledger.',
  'and lost it all. Chuuya will be laughing about this for a week.',
  'and lost it all. Dazai says the house always wins, he would know.',
  'and lost it all. Ranpo saw it coming before you pulled.',
];
const machine = (name: string, bet: number, shown: (SlotSym | 'spin')[], result: string) => [
  '**`  NO LONGER HUMAN  `**',
  `\` \` ${shown.map(slotEmoji).join(' ')} \` \` **${name}** bet **${fmt(bet)}**`,
  `\`|         |\` ${result}`,
  '`|         |`',
].join('\n');
const slots: Command = {
  name: 'slots',
  cooldown: 5,
  data: new SlashCommandBuilder().setName('slots').setDescription('Pull No Longer Human, the slot machine, for yen')
    .addStringOption((o) => o.setName('bet').setDescription('How much, or half / all').setRequired(true)).toJSON(),
  text: { aliases: ['slot', 's'], args: ['bet'] },
  example: '200',
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Bets live in servers.');
    const c = checkBet(store, ctx.guildId, ctx.userId, ctx.str('bet'));
    if ('error' in c) return ctx.reply({ content: c.error, temp: true });
    // the money moves at the pull, the reels are only the show
    const { reels, mult } = pull();
    const back = c.bet * mult;
    store.pay(ctx.guildId, ctx.userId, back - c.bet);
    const name = nameOf(ctx);
    const result = mult === 0 ? LOST[Math.floor(Math.random() * LOST.length)]
      : mult === 1 ? `and got **${fmt(back)}** back, even.`
      : `and won **${fmt(back)}**${mult === 10 ? ' · **jackpot ×10**' : ` · ×${mult}`}`;
    await playOut(ctx, [
      machine(name, c.bet, ['spin', 'spin', 'spin'], ''),
      machine(name, c.bet, [reels[0], 'spin', 'spin'], ''),
      machine(name, c.bet, [reels[0], reels[1], 'spin'], ''),
      machine(name, c.bet, reels, result),
    ], [1000, 800, 900]);
  },
};

// ---------- blackjack, played on one message with buttons ----------
type Hand = number[];
interface Game { guild: string; user: string; bet: number; deck: number[]; you: Hand; dealer: Hand; doubled: boolean; at: number; reveal?: boolean }
const games = new Map<string, Game>();
const face = (c: number) => ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][c % 13] + ['♠', '♥', '♦', '♣'][Math.floor(c / 13) % 4];
const value = (h: Hand) => {
  let total = 0;
  let aces = 0;
  for (const c of h) { const r = c % 13; if (r === 0) { aces++; total += 11; } else total += Math.min(10, r + 1); }
  while (total > 21 && aces--) total -= 10;
  return total;
};
// a fair shuffle, every order equally likely
const deck = () => { const d = Array.from({ length: 52 }, (_, i) => i); for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } return d; };
const cards = (h: Hand) => h.map((c) => `\`${face(c)}\``).join(' ');

function table(g: Game, end: string | null) {
  const you = value(g.you);
  const open = end !== null || g.reveal;
  const shown = open ? cards(g.dealer) : `${cards([g.dealer[0]])} \`??\``;
  const dv = open ? ` · **${value(g.dealer)}**` : ` · **${value([g.dealer[0]])}** showing`;
  const e = card(`🃏 Blackjack · ${fmt(g.bet)}${g.doubled ? ' doubled' : ''}`,
    `Dealer${dv}\n${shown}\n\nYou · **${you}**${you === 21 && g.you.length === 2 ? ' blackjack' : ''}\n${cards(g.you)}${end ? `\n\n${end}` : g.reveal ? '\n\n-# the dealer draws...' : ''}`,
    end ? (/won|blackjack/i.test(end) ? WIN : /push/i.test(end) ? PLAY : LOSE) : PLAY);
  const id = (a: string) => `bj|${a}|${g.user}`;
  const rows = end || g.reveal ? [] : [row(
    new ButtonBuilder().setCustomId(id('hit')).setLabel('Hit').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(id('stand')).setLabel('Stand').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(id('double')).setLabel('Double').setStyle(ButtonStyle.Secondary).setDisabled(g.you.length > 2),
  )];
  return { embeds: [e], components: rows };
}

// the bet is taken at the deal, so walking away from a bad hand still costs it
// settling pays back what's owed: twice the bet for a win, 2.5× for a blackjack, the bet itself for a push
function settle(store: Store, g: Game): string {
  games.delete(g.user);
  const you = value(g.you);
  if (you > 21) return `Bust. **−${fmt(g.bet)}**`;
  const d = value(g.dealer);
  const natural = you === 21 && g.you.length === 2;
  const dealerNatural = d === 21 && g.dealer.length === 2;
  if (natural && !dealerNatural) { store.pay(g.guild, g.user, g.bet + Math.floor(g.bet * 1.5)); return `**Blackjack!** **+${fmt(Math.floor(g.bet * 1.5))}**`; }
  if (d > 21 || you > d) { store.pay(g.guild, g.user, g.bet * 2); return `${d > 21 ? 'The dealer busts.' : 'You win.'} **+${fmt(g.bet)}**`; }
  if (you === d) { store.pay(g.guild, g.user, g.bet); return 'Push, your bet comes back.'; }
  return `${pickLine(['The house wins.', 'Dazai deals himself the better hand.', 'The dealer smiles. The house wins.'])} **−${fmt(g.bet)}**`;
}
// the dealer turns the hidden card, then draws to 17 one card at a time on the same message
async function dealerPlays(store: Store, g: Game, edit: (v: ReturnType<typeof table>) => Promise<unknown>) {
  if (value(g.you) <= 21) {
    g.reveal = true;
    await edit(table(g, null)).catch(() => {});
    while (value(g.dealer) < 17) { await pause(800); g.dealer.push(g.deck.pop()!); await edit(table(g, null)).catch(() => {}); }
    await pause(700);
  }
  await edit(table(g, settle(store, g))).catch(() => {});
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
    store.pay(ctx.guildId, ctx.userId, -c.bet);
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
    if (store.wallet(g.guild, g.user).yen < g.bet) { await i.reply({ content: 'Not enough yen to double.', flags: MessageFlags.Ephemeral }); return true; }
    store.pay(g.guild, g.user, -g.bet);
    g.bet *= 2;
    g.doubled = true;
    g.you.push(g.deck.pop()!);
    await i.deferUpdate();
    await dealerPlays(store, g, (v) => i.editReply(v));
    return true;
  }
  if (what === 'hit') {
    g.you.push(g.deck.pop()!);
    if (value(g.you) > 21) { await i.update(table(g, settle(store, g))); return true; }
    if (value(g.you) === 21) { await i.deferUpdate(); await dealerPlays(store, g, (v) => i.editReply(v)); return true; }
    await i.update(table(g, null));
    return true;
  }
  if (g.reveal) { await i.deferUpdate().catch(() => {}); return true; }
  await i.deferUpdate();
  await dealerPlays(store, g, (v) => i.editReply(v));
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
