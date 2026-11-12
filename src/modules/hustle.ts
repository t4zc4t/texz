import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder,
  type Interaction, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Store } from '../db.js';
import type { Command } from '../core/module.js';
import { levelOf, rankFor, ranks } from './levels.js';

// ways to earn and lose yen besides the daily: shifts at the Agency, Port Mafia jobs, the river, the vault,
// robbing each other, roulette, scratch cards, crew heists and rock paper scissors. Buttons edit their own message.

const fmt = (n: number) => `¥${n.toLocaleString()}`;
const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const between = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
const card = (title: string, body: string, colour: number) => new EmbedBuilder().setColor(colour).setTitle(title).setDescription(body);
const WIN = 0x3fa76a;
const LOSE = 0xc8283c;
const PLAY = 0xc8a97e;

// one cooldown per command per person per server, kept in the kv table so restarts don't reset it
function waitLeft(store: Store, what: string, guild: string, user: string, seconds: number): number {
  const at = Number(store.getKv(`cd:${what}:${guild}:${user}`) ?? 0);
  return Math.max(0, at + seconds * 1000 - Date.now());
}
const stamp = (store: Store, what: string, guild: string, user: string) => store.setKv(`cd:${what}:${guild}:${user}`, String(Date.now()));
const later = (ms: number) => `<t:${Math.floor((Date.now() + ms) / 1000)}:R>`;
const rankIndex = (store: Store, guild: string, user: string) => ranks.indexOf(rankFor(levelOf(store.xpOf(guild, user).xp).level));
const wallet = (store: Store, g: string, u: string) => store.wallet(g, u).yen;

// ---------- work, crime, beg ----------
const JOBS = [
  'filed Kunikida\'s reports in exactly the right order',
  'tailed a suspect through Chinatown for Ranpo',
  'fished Dazai out of the river. Again',
  'kept Kyouka company on a stakeout',
  'helped Yosano in the infirmary. You don\'t talk about it',
  'served drinks at Bar Lupin for the night',
  'delivered sweets to Ranpo before he sulked',
  'translated a coded letter from the Guild',
  'escorted a client across the harbour',
  'found the cat that every case seems to have',
];
const work: Command = {
  name: 'work',
  data: new SlashCommandBuilder().setName('work').setDescription('Take an Agency shift for yen, once an hour').toJSON(),
  text: { aliases: ['shift', 'job'] },
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Yen lives in servers.');
    const left = waitLeft(store, 'work', ctx.guildId, ctx.userId, 3600);
    if (left) return ctx.reply({ content: `⏳ Kunikida says your next shift starts ${later(left)}.`, temp: true });
    const got = between(120, 260) + rankIndex(store, ctx.guildId, ctx.userId) * 15;
    store.pay(ctx.guildId, ctx.userId, got);
    stamp(store, 'work', ctx.guildId, ctx.userId);
    return ctx.reply({ embeds: [card('💼 Agency shift', `You ${pick(JOBS)}.\n**+${fmt(got)}**\n-# higher ranks get paid more · wallet ${fmt(wallet(store, ctx.guildId, ctx.userId))}`, WIN)], public: true });
  },
};

const CRIMES_OK = [
  'ran a shipment past customs for the Port Mafia',
  'cracked a Guild safe while Fitzgerald was busy monologuing',
  'sold fake Ability User certificates',
  'won a rigged card game in the Lupin back room',
  'lifted a briefcase off a Black Lizard courier',
];
const CRIMES_BAD = [
  'got caught by Kunikida. He wrote your name in the notebook and fined you',
  'tripped over Chuuya\'s hat. Bad idea',
  'got outsmarted by Ranpo before you even started',
  'were spotted by the Hunting Dogs and paid to get away',
  'trusted Dazai\'s plan. It was a joke the whole time',
];
const crime: Command = {
  name: 'crime',
  data: new SlashCommandBuilder().setName('crime').setDescription('Do a Port Mafia job, big pay or a big fine, every two hours').toJSON(),
  text: { aliases: ['mafiajob'] },
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Yen lives in servers.');
    const left = waitLeft(store, 'crime', ctx.guildId, ctx.userId, 7200);
    if (left) return ctx.reply({ content: `⏳ The Port Mafia has nothing for you until ${later(left)}.`, temp: true });
    stamp(store, 'crime', ctx.guildId, ctx.userId);
    if (Math.random() < 0.55) {
      const got = between(250, 600);
      store.pay(ctx.guildId, ctx.userId, got);
      return ctx.reply({ embeds: [card('🖤 Port Mafia job', `You ${pick(CRIMES_OK)}.\n**+${fmt(got)}**\n-# wallet ${fmt(wallet(store, ctx.guildId, ctx.userId))}`, WIN)], public: true });
    }
    const fine = Math.min(between(150, 400), wallet(store, ctx.guildId, ctx.userId));
    store.pay(ctx.guildId, ctx.userId, -fine);
    return ctx.reply({ embeds: [card('🚨 Caught', `You ${pick(CRIMES_BAD)}.\n**−${fmt(fine)}**\n-# wallet ${fmt(wallet(store, ctx.guildId, ctx.userId))}`, LOSE)], public: true });
  },
};

const BEGS: [string, number, number][] = [
  ['Atsushi felt bad and handed you', 10, 60],
  ['Kenji gave you a bag of rice and', 15, 50],
  ['Dazai pretended to pay you back with', 0, 5],
  ['Kyouka quietly slid over', 20, 70],
  ['Tanizaki\'s sister pinched your cheek and gave you', 10, 40],
  ['Ranpo ate your snacks and left', 0, 15],
  ['Fukuzawa nodded once and handed you', 40, 90],
];
const beg: Command = {
  name: 'beg',
  data: new SlashCommandBuilder().setName('beg').setDescription('Ask the Agency for spare change, every ten minutes').toJSON(),
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Yen lives in servers.');
    const left = waitLeft(store, 'beg', ctx.guildId, ctx.userId, 600);
    if (left) return ctx.reply({ content: `⏳ Give them a minute. Try again ${later(left)}.`, temp: true });
    stamp(store, 'beg', ctx.guildId, ctx.userId);
    const [who, lo, hi] = pick(BEGS);
    const got = between(lo, hi);
    if (got) store.pay(ctx.guildId, ctx.userId, got);
    return ctx.reply({ content: `🥺 ${who} **${fmt(got)}**.`, temp: false, public: true });
  },
};

// ---------- the river ----------
const CATCH: [string, string, number, number][] = [
  ['🥾', 'an old boot', 0, 120],
  ['🐟', 'a mackerel', 30, 260],
  ['🦐', 'a handful of shrimp', 45, 180],
  ['🐠', 'a tropical fish, somehow', 60, 140],
  ['🪼', 'a jellyfish', 80, 80],
  ['🦀', 'a harbour crab', 90, 90],
  ['🐡', 'a pufferfish', 120, 60],
  ['🦑', 'a squid', 200, 40],
  ['🐙', 'an octopus', 250, 30],
  ['🦈', 'a small shark', 600, 10],
  ['🧥', 'Dazai. He was enjoying the float. He tipped you for the trouble', 1500, 4],
];
const fish: Command = {
  name: 'fish',
  data: new SlashCommandBuilder().setName('fish').setDescription('Cast a line in the Yokohama river, every twenty minutes').toJSON(),
  text: { aliases: ['cast'] },
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Yen lives in servers.');
    const left = waitLeft(store, 'fish', ctx.guildId, ctx.userId, 1200);
    if (left) return ctx.reply({ content: `⏳ The fish need a break. Cast again ${later(left)}.`, temp: true });
    stamp(store, 'fish', ctx.guildId, ctx.userId);
    let r = Math.random() * CATCH.reduce((s, c) => s + c[3], 0);
    const hit = CATCH.find((c) => (r -= c[3]) < 0) ?? CATCH[1];
    if (hit[2]) store.pay(ctx.guildId, ctx.userId, hit[2]);
    const rare = hit[2] >= 600;
    return ctx.reply({ embeds: [card(`🎣 ${rare ? 'What a catch' : 'Gone fishing'}`, `${hit[0]} You pulled up ${hit[1]}.\n${hit[2] ? `Sold for **+${fmt(hit[2])}**` : 'Worth nothing. Kunikida makes you bin it.'}\n-# wallet ${fmt(wallet(store, ctx.guildId, ctx.userId))}`, rare ? 0xe0901f : hit[2] ? WIN : PLAY)], public: true });
  },
};

// ---------- the vault: yen in it can't be robbed, and it grows a little every day ----------
const vaultOf = (store: Store, g: string, u: string) => {
  const raw = store.getKv(`bank:${g}:${u}`);
  const v = raw ? (JSON.parse(raw) as { yen: number; day: string }) : { yen: 0, day: new Date().toISOString().slice(0, 10) };
  // interest is added lazily, 1% a day up to ¥250 a day
  const today = new Date().toISOString().slice(0, 10);
  const days = Math.min(30, Math.max(0, Math.round((Date.parse(today) - Date.parse(v.day)) / 86_400_000)));
  for (let n = 0; n < days; n++) v.yen += Math.min(250, Math.floor(v.yen * 0.01));
  v.day = today;
  return v;
};
const saveVault = (store: Store, g: string, u: string, v: { yen: number; day: string }) => store.setKv(`bank:${g}:${u}`, JSON.stringify(v));
// bigger ranks get bigger vaults
export const vaultCap = (store: Store, g: string, u: string) => 5000 + Math.max(0, rankIndex(store, g, u)) * 5000;

const bank: Command = {
  name: 'bank',
  data: new SlashCommandBuilder().setName('bank').setDescription('Your Agency vault: safe from robbers, earns 1% a day')
    .addStringOption((o) => o.setName('action').setDescription('Put in or take out').addChoices({ name: 'deposit', value: 'deposit' }, { name: 'withdraw', value: 'withdraw' }))
    .addStringOption((o) => o.setName('amount').setDescription('How much, or half / all')).toJSON(),
  text: { aliases: ['vault', 'dep', 'with'], args: ['action', 'amount'] },
  example: 'deposit all',
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Yen lives in servers.');
    const g = ctx.guildId;
    const u = ctx.userId;
    const v = vaultOf(store, g, u);
    const cap = vaultCap(store, g, u);
    const act = (ctx.str('action') ?? '').toLowerCase();
    const have = wallet(store, g, u);
    const amountOf = (max: number) => {
      const s = (ctx.str('amount') ?? '').toLowerCase().replace(/[,¥]/g, '');
      const n = s === 'all' || s === 'max' ? max : s === 'half' ? Math.floor(max / 2) : Number.parseInt(s, 10);
      return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
    };
    let note = '';
    if (/^dep/.test(act)) {
      const n = amountOf(Math.min(have, cap - v.yen));
      if (!n) return ctx.reply({ content: v.yen >= cap ? `Your vault is full at ${fmt(cap)}. Rank up for a bigger one.` : 'How much? Like `tz bank deposit 500` or `tz bank deposit all`.', temp: true });
      store.pay(g, u, -n);
      v.yen += n;
      note = `📥 Put **${fmt(n)}** in the vault.`;
    } else if (/^with/.test(act)) {
      const n = amountOf(v.yen);
      if (!n) return ctx.reply({ content: v.yen ? 'How much? Like `tz bank withdraw 500` or `tz bank withdraw all`.' : 'The vault is empty.', temp: true });
      v.yen -= n;
      store.pay(g, u, n);
      note = `📤 Took **${fmt(n)}** out.`;
    }
    saveVault(store, g, u, v);
    const body = `${note ? `${note}\n\n` : ''}👛 Wallet **${fmt(wallet(store, g, u))}**\n🏦 Vault **${fmt(v.yen)}** / ${fmt(cap)}\n-# Vault yen can't be robbed and grows 1% a day. Ranks make it bigger. \`tz bank deposit all\` · \`tz bank withdraw 500\``;
    return ctx.reply({ embeds: [card('🏦 Agency vault', body, PLAY)], temp: !note });
  },
};

// ---------- robbing ----------
const rob: Command = {
  name: 'rob',
  data: new SlashCommandBuilder().setName('rob').setDescription('Try to pickpocket someone\'s wallet. Fail and you pay them')
    .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)).toJSON(),
  text: { aliases: ['steal'], args: ['user'] },
  example: '@someone',
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Yen lives in servers.');
    const g = ctx.guildId;
    const target = ctx.user('user');
    if (!target || target === ctx.userId) return ctx.reply({ content: 'Rob who? Like `tz rob @someone`.', temp: true });
    const t = await ctx.guild?.members.fetch(target).catch(() => null);
    if (!t || t.user.bot) return ctx.reply({ content: 'Bots keep their yen in the Black Lizard vault. Pick a person.', temp: true });
    const left = waitLeft(store, 'rob', g, ctx.userId, 7200);
    if (left) return ctx.reply({ content: `⏳ Lie low for a bit. You can try again ${later(left)}.`, temp: true });
    const mine = wallet(store, g, ctx.userId);
    const theirs = wallet(store, g, target);
    if (mine < 200) return ctx.reply({ content: `You need ${fmt(200)} in your wallet to cover the fine if it goes wrong.`, temp: true });
    if (theirs < 300) return ctx.reply({ content: `${t.displayName} has barely anything on them. Not worth it.`, temp: true });
    const shield = Number(store.getKv(`robbed:${g}:${target}`) ?? 0);
    if (Date.now() - shield < 1800_000) return ctx.reply({ content: `${t.displayName} was robbed recently and is watching their pockets. Try ${later(shield + 1800_000 - Date.now())}.`, temp: true });
    stamp(store, 'rob', g, ctx.userId);
    if (Math.random() < 0.4) {
      const took = Math.min(3000, Math.floor(theirs * (0.1 + Math.random() * 0.15)));
      store.pay(g, target, -took);
      store.pay(g, ctx.userId, took);
      store.setKv(`robbed:${g}:${target}`, String(Date.now()));
      return ctx.reply({ content: `🫳 <@${ctx.userId}> picked <@${target}>'s pocket for **${fmt(took)}**.\n-# Keep yen in \`tz bank\` and nobody can touch it.`, ping: [target], public: true });
    }
    const fine = Math.max(100, Math.floor(mine * 0.15));
    store.pay(g, ctx.userId, -fine);
    store.pay(g, target, fine);
    return ctx.reply({ content: `🚨 <@${target}> caught <@${ctx.userId}> with a hand in their pocket. **${fmt(fine)}** paid to them as an apology.`, ping: [target], public: true });
  },
};

// ---------- roulette ----------
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
function betOf(store: Store, g: string, u: string, raw: string | null): number | string {
  const have = wallet(store, g, u);
  const s = (raw ?? '').toLowerCase().replace(/[,¥]/g, '');
  const n = s === 'all' ? have : s === 'half' ? Math.floor(have / 2) : Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0) return 'How much? Like `100`, `half` or `all`.';
  const bet = Math.min(n, 10_000);
  if (bet < 10) return `The smallest bet is ${fmt(10)}.`;
  if (bet > have) return `You've got ${fmt(have)}. Kunikida doesn't do credit.`;
  return bet;
}
const roulette: Command = {
  name: 'roulette',
  cooldown: 5,
  data: new SlashCommandBuilder().setName('roulette').setDescription('Spin the Lupin wheel: red, black, odd, even, low, high or a number')
    .addStringOption((o) => o.setName('bet').setDescription('How much, or half / all').setRequired(true))
    .addStringOption((o) => o.setName('on').setDescription('red, black, odd, even, low, high, or 0 to 36').setRequired(true)).toJSON(),
  text: { aliases: ['wheel', 'rl'], args: ['bet', 'on'] },
  example: '200 red',
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Bets live in servers.');
    const bet = betOf(store, ctx.guildId, ctx.userId, ctx.str('bet'));
    if (typeof bet === 'string') return ctx.reply({ content: bet, temp: true });
    const on = (ctx.str('on') ?? '').toLowerCase().trim();
    const num = /^\d+$/.test(on) ? Number(on) : null;
    const kinds = ['red', 'black', 'odd', 'even', 'low', 'high'];
    if ((num === null || num > 36) && !kinds.includes(on)) return ctx.reply({ content: 'Bet on `red`, `black`, `odd`, `even`, `low` (1-18), `high` (19-36) or a number from 0 to 36. Like `tz roulette 200 red`.', temp: true });
    const ball = Math.floor(Math.random() * 37);
    const colour = ball === 0 ? '🟢' : REDS.has(ball) ? '🔴' : '⚫';
    const won = num !== null ? ball === num
      : ball !== 0 && ({ red: REDS.has(ball), black: !REDS.has(ball), odd: ball % 2 === 1, even: ball % 2 === 0, low: ball <= 18, high: ball >= 19 } as Record<string, boolean>)[on];
    const change = won ? bet * (num !== null ? 35 : 1) : -bet;
    store.pay(ctx.guildId, ctx.userId, change);
    return ctx.reply({ embeds: [card('🎡 Lupin roulette', `The ball lands on **${colour} ${ball}**.\nYou bet on ${num !== null ? `**${num}**` : `**${on}**`}. ${won ? `**+${fmt(change)}**` : `**−${fmt(bet)}**`}\n-# numbers pay 35×, everything else 1× · wallet ${fmt(wallet(store, ctx.guildId, ctx.userId))}`, won ? WIN : LOSE)], public: true });
  },
};

// ---------- scratch cards, the prize is hidden under spoilers ----------
const SCRATCH: [string, number, number][] = [['🍙', 30, 2], ['🦀', 22, 3], ['🔔', 14, 5], ['💎', 6, 20], ['🖤', 2, 100]];
const scratch: Command = {
  name: 'scratch',
  cooldown: 10,
  data: new SlashCommandBuilder().setName('scratch').setDescription('Buy a ¥100 scratch card, three alike wins').toJSON(),
    run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Yen lives in servers.');
    if (wallet(store, ctx.guildId, ctx.userId) < 100) return ctx.reply({ content: `A card costs ${fmt(100)}.`, temp: true });
    const total = SCRATCH.reduce((s, x) => s + x[1], 0) + 26;
    const draw = () => { let r = Math.random() * total; return SCRATCH.find((x) => (r -= x[1]) < 0)?.[0] ?? '🥢'; };
    const cells = [draw(), draw(), draw()];
    const three = cells[0] === cells[1] && cells[1] === cells[2] ? SCRATCH.find((x) => x[0] === cells[0]) : undefined;
    const prize = three ? 100 * three[2] : 0;
    store.pay(ctx.guildId, ctx.userId, prize - 100);
    const result = prize ? `||**Three ${cells[0]}! +${fmt(prize - 100)}**||` : '||No match this time. −¥100||';
    return ctx.reply({ embeds: [card('🎟️ Lupin scratch card', `Scratch it:\n# ||${cells[0]}|| ||${cells[1]}|| ||${cells[2]}||\n${result}\n-# 🍙2× 🦀3× 🔔5× 💎20× 🖤100× · wallet ${fmt(wallet(store, ctx.guildId, ctx.userId))}`, PLAY)], public: true });
  },
};

// ---------- crew heists: one message, join with a button, the leader calls it ----------
const ENTRY = 250;
const TARGETS = ['the Port Mafia\'s casino vault', 'the Guild\'s airship Moby Dick', 'the Decay of Angels\' safehouse', 'Mori\'s private wine cellar', 'the Hunting Dogs\' evidence locker', 'a Rats in the House of the Dead drop'];
interface Heist { guild: string; leader: string; crew: string[]; target: string; at: number; done: boolean }
const heists = new Map<string, Heist>();
const chanceOf = (n: number) => Math.min(0.8, 0.25 + 0.1 * n);
function heistView(h: Heist, end: string | null) {
  const id = (a: string) => `hs|${a}|${h.leader}`;
  const body = `**Target:** ${h.target}\n**Crew (${h.crew.length}):** ${h.crew.map((u) => `<@${u}>`).join(' ')}\n**Way in:** ${fmt(ENTRY)} each, paid when it starts · **odds** ${Math.round(chanceOf(h.crew.length) * 100)}%${end ? `\n\n${end}` : '\n-# More crew, better odds. The leader starts it once there are at least two.'}`;
  const e = card('🕶️ Heist', body, end ? (/made it|split/i.test(end) ? WIN : LOSE) : PLAY);
  const rows = end ? [] : [row(
    new ButtonBuilder().setCustomId(id('join')).setLabel('Join the crew').setEmoji('🤝').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(id('go')).setLabel('Pull it off').setEmoji('💥').setStyle(ButtonStyle.Danger).setDisabled(h.crew.length < 2),
    new ButtonBuilder().setCustomId(id('call')).setLabel('Call it off').setStyle(ButtonStyle.Secondary),
  )];
  return { embeds: [e], components: rows };
}
const heist: Command = {
  name: 'heist',
  data: new SlashCommandBuilder().setName('heist').setDescription('Start a crew heist, others join with a button').toJSON(),
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Heists live in servers.');
    const left = waitLeft(store, 'heist', ctx.guildId, ctx.userId, 3600);
    if (left) return ctx.reply({ content: `⏳ The heat is still on from your last job. Next one ${later(left)}.`, temp: true });
    if (wallet(store, ctx.guildId, ctx.userId) < ENTRY) return ctx.reply({ content: `You need ${fmt(ENTRY)} to bring to the job.`, temp: true });
    const h: Heist = { guild: ctx.guildId, leader: ctx.userId, crew: [ctx.userId], target: pick(TARGETS), at: Date.now(), done: false };
    heists.set(ctx.userId, h);
    return ctx.reply({ ...heistView(h, null), public: true });
  },
};

// ---------- rock paper scissors, against Texz or someone else, with an optional bet ----------
const HANDS: Record<string, string> = { rock: '✊', paper: '✋', scissors: '✌️' };
const beats: Record<string, string> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
interface Duel { guild: string; a: string; b: string; bet: number; picks: Record<string, string>; at: number }
const duels = new Map<string, Duel>();
function duelView(d: Duel, key: string, end: string | null) {
  const who = d.b === 'bot' ? `<@${d.a}> vs Texz` : `<@${d.a}> vs <@${d.b}>`;
  const status = d.b === 'bot' ? '' : `\n${[d.a, d.b].map((u) => `${d.picks[u] ? '✅' : '⏳'} <@${u}>`).join('  ')}`;
  const e = card('✊ Rock paper scissors', `${who}${d.bet ? ` · ${fmt(d.bet)} on it` : ''}${end ? `\n\n${end}` : `${status}\n-# Pick in secret, it shows when both are in.`}`, end ? PLAY : PLAY);
  const rows = end ? [] : [row(...Object.entries(HANDS).map(([k, v]) => new ButtonBuilder().setCustomId(`rps|${k}|${key}`).setEmoji(v).setLabel(k).setStyle(ButtonStyle.Secondary)))];
  return { embeds: [e], components: rows };
}
const rps: Command = {
  name: 'rps',
  cooldown: 5,
  data: new SlashCommandBuilder().setName('rps').setDescription('Rock paper scissors against Texz or someone, bet optional')
    .addUserOption((o) => o.setName('user').setDescription('Who to play, leave empty for Texz'))
    .addStringOption((o) => o.setName('bet').setDescription('Yen on it, optional')).toJSON(),
  text: { aliases: ['rockpaperscissors'], args: ['user', 'bet'] },
  example: '@someone 100',
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Play it in a server.');
    let other = ctx.user('user');
    if (other === ctx.userId) other = null;
    if (other) {
      const m = await ctx.guild?.members.fetch(other).catch(() => null);
      if (!m || m.user.bot) other = null;
    }
    let bet = 0;
    if (ctx.str('bet')) {
      const b = betOf(store, ctx.guildId, ctx.userId, ctx.str('bet'));
      if (typeof b === 'string') return ctx.reply({ content: b, temp: true });
      bet = b;
    }
    const key = `${ctx.userId}-${Date.now().toString(36)}`;
    const d: Duel = { guild: ctx.guildId, a: ctx.userId, b: other ?? 'bot', bet, picks: {}, at: Date.now() };
    duels.set(key, d);
    return ctx.reply({ ...duelView(d, key, null), ping: other ? [other] : [], public: true });
  },
};

export async function onHustle(store: Store, i: Interaction): Promise<boolean> {
  if (!i.isButton()) return false;
  if (i.customId.startsWith('hs|')) {
    const [, what, leader] = i.customId.split('|');
    const h = heists.get(leader);
    if (!h || h.done || Date.now() - h.at > 15 * 60_000) { heists.delete(leader); await i.update({ components: [] }).catch(() => {}); return true; }
    if (what === 'join') {
      if (h.crew.includes(i.user.id)) { await i.reply({ content: 'You\'re already in.', flags: MessageFlags.Ephemeral }); return true; }
      if (h.crew.length >= 8) { await i.reply({ content: 'The crew is full.', flags: MessageFlags.Ephemeral }); return true; }
      if (wallet(store, h.guild, i.user.id) < ENTRY) { await i.reply({ content: `You need ${fmt(ENTRY)} to join.`, flags: MessageFlags.Ephemeral }); return true; }
      h.crew.push(i.user.id);
      await i.update(heistView(h, null));
      return true;
    }
    if (i.user.id !== leader) { await i.reply({ content: 'Only the one who planned it can start or call it off.', flags: MessageFlags.Ephemeral }); return true; }
    h.done = true;
    heists.delete(leader);
    if (what === 'call') { await i.update(heistView(h, 'Called off. Nobody paid a thing.')); return true; }
    // whoever can't pay by now stays home
    h.crew = h.crew.filter((u) => wallet(store, h.guild, u) >= ENTRY);
    if (h.crew.length < 2) { await i.update(heistView(h, 'Not enough of the crew could pay their way in. Called off.')); return true; }
    for (const u of h.crew) store.pay(h.guild, u, -ENTRY);
    stamp(store, 'heist', h.guild, leader);
    if (Math.random() < chanceOf(h.crew.length)) {
      const each = ENTRY + between(250, 450) + 40 * h.crew.length;
      for (const u of h.crew) store.pay(h.guild, u, each);
      await i.update(heistView(h, `💰 You made it out. Everyone takes home **+${fmt(each - ENTRY)}** after the split.`));
    } else {
      await i.update(heistView(h, `🚨 ${pick(['Chuuya was waiting inside', 'Kunikida had the place staked out', 'Dazai sold you out for a laugh', 'Fyodor saw it coming'])}. Everyone loses their **${fmt(ENTRY)}**.`));
    }
    return true;
  }
  if (i.customId.startsWith('rps|')) {
    const [, hand, key] = i.customId.split('|');
    const d = duels.get(key);
    if (!d || Date.now() - d.at > 10 * 60_000) { duels.delete(key); await i.update({ components: [] }).catch(() => {}); return true; }
    if (i.user.id !== d.a && i.user.id !== d.b) { await i.reply({ content: 'Not your game. Start one with `tz rps`.', flags: MessageFlags.Ephemeral }); return true; }
    d.picks[i.user.id] = hand;
    if (d.b === 'bot') d.picks.bot = pick(Object.keys(HANDS));
    if (!d.picks[d.a] || !d.picks[d.b]) { await i.update(duelView(d, key, null)); return true; }
    duels.delete(key);
    const pa = d.picks[d.a];
    const pb = d.picks[d.b];
    const name = (u: string) => (u === 'bot' ? 'Texz' : `<@${u}>`);
    const winner = pa === pb ? null : beats[pa] === pb ? d.a : d.b;
    const loser = winner === d.a ? d.b : winner ? d.a : null;
    let money = '';
    if (d.bet && winner && loser) {
      // the bet only moves if the loser can still pay it, Texz always can
      if (loser === 'bot') { store.pay(d.guild, winner, d.bet); money = ` **+${fmt(d.bet)}**`; }
      else if (wallet(store, d.guild, loser) >= d.bet) { store.pay(d.guild, loser, -d.bet); if (winner !== 'bot') store.pay(d.guild, winner, d.bet); money = ` **${fmt(d.bet)}** changes hands.`; }
    }
    const end = `${name(d.a)} ${HANDS[pa]} vs ${HANDS[pb]} ${name(d.b)}\n${winner ? `**${name(winner)} wins.**${money}` : '**A draw.** Nobody pays.'}`;
    await i.update(duelView(d, key, end));
    return true;
  }
  return false;
}

export const hustleCommands = [work, crime, beg, fish, bank, rob, roulette, scratch, heist, rps];
