import { track } from './missions.js';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder, StringSelectMenuBuilder,
  type Interaction, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Store } from '../db.js';
import type { Command } from '../core/module.js';
import { card } from '../theme.js';
import { home, nextRound as pickNext, flagOf, schedule, teamDot } from '../feeds/f1.js';

const nextRound = async () => pickNext((await schedule()).rounds);
import { clubDot, leagues, matches, interesting, type Match } from '../feeds/football.js';
import { asEmoji } from '../features/logos.js';

// guess the podium before a race and the winner of the day's big matches, yen for every right call

const PODIUM = { exact: 50, onPodium: 15 };
const MATCH_PAY = 30;
const row = (...c: (ButtonBuilder | StringSelectMenuBuilder)[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);
const unix = (ms: number) => Math.floor(ms / 1000);

const f1Key = (round: number, guild: string, user: string) => `pred:f1:${round}:${guild}:${user}`;
const fbKey = (match: string, guild: string, user: string) => `pred:fb:${match}:${guild}:${user}`;
const points = (store: Store, guild: string, user: string) => Number(store.getKv(`predpts:${guild}:${user}`) ?? 0);
const addPoints = (store: Store, guild: string, user: string, n: number) => store.setKv(`predpts:${guild}:${user}`, String(points(store, guild, user) + n));

async function todaysBig(store: Store, guild: string): Promise<Match[]> {
  const g = store.guild(guild).bulletins.football;
  const out: Match[] = [];
  for (const l of Object.keys(leagues)) {
    const list = await matches(l, new Date()).catch(() => [] as Match[]);
    out.push(...list.filter((m) => m.state === 'pre' && interesting(m, g.favs, true)));
  }
  return out.sort((a, b) => a.date - b.date).slice(0, 4);
}

async function page(store: Store, guild: string, user: string) {
  const r = await nextRound().catch(() => null);
  const h = await home().catch(() => null);
  const drivers = (h?.standings ?? []).slice(0, 25).map((d) => d.driver);
  const teamOf = new Map((h?.standings ?? []).map((d) => [d.driver, d.team]));
  const raceStart = r ? Date.parse(r.sessions.find((s) => s.type === 'R')?.start ?? '') : NaN;
  const open = r && raceStart > Date.now();
  const mine = r ? (JSON.parse(store.getKv(f1Key(r.round, guild, user)) ?? '[]') as string[]) : [];
  const big = await todaysBig(store, guild);
  const lines: string[] = [];
  if (r) lines.push(`🏎️ **${flagOf[r.circuit.country] ?? ''} ${r.name}** · ${open ? `picks close <t:${unix(raceStart)}:R>` : 'picks are closed'}\n${mine.length ? mine.map((d, n) => `${['🥇', '🥈', '🥉'][n]} ${teamOf.has(d) ? `${teamDot(teamOf.get(d)!)} ` : ''}${d}`).join(' · ') : '*no podium picked yet*'}`);
  for (const m of big) {
    const pick = store.getKv(fbKey(m.id, guild, user));
    lines.push(`${clubDot(m.home)} **${m.home.name}** vs **${m.away.name}** ${clubDot(m.away)} · <t:${unix(m.date)}:t>${pick ? ` · you said **${pick === 'draw' ? 'draw' : pick === 'home' ? m.home.name : m.away.name}**` : ''}`);
  }
  if (!lines.length) lines.push('Nothing to call right now. Come back on race week or a big matchday.');
  const e = card({
    kind: 'help', title: 'Predictions', emoji: '🔮', gif: 'off', line: '',
    body: `${lines.join('\n\n')}\n\n-# ¥${PODIUM.exact} for each driver in the right spot, ¥${PODIUM.onPodium} on the podium but wrong spot, ¥${MATCH_PAY} for a right result · you have **${points(store, guild, user)}** points this season`,
  });
  const rows = [];
  if (open && drivers.length) {
    for (let n = 0; n < 3; n++) {
      rows.push(row(new StringSelectMenuBuilder().setCustomId(`prd|f1|${r!.round}|${n}`).setPlaceholder(`${['🥇 Winner', '🥈 Second', '🥉 Third'][n]}${mine[n] ? `: ${mine[n]}` : ''}`)
        .addOptions(drivers.map((d) => ({ label: d, value: d, default: mine[n] === d, emoji: asEmoji(teamOf.has(d) ? teamDot(teamOf.get(d)!) : null) })))));
    }
  }
  for (const m of big.slice(0, 5 - rows.length)) {
    rows.push(row(
      new ButtonBuilder().setCustomId(`prd|fb|${m.id}|home`).setLabel(m.home.name.slice(0, 40)).setEmoji(asEmoji(clubDot(m.home))!).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`prd|fb|${m.id}|draw`).setLabel('Draw').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`prd|fb|${m.id}|away`).setLabel(m.away.name.slice(0, 40)).setEmoji(asEmoji(clubDot(m.away))!).setStyle(ButtonStyle.Secondary),
    ));
  }
  return { embeds: [e], components: rows.slice(0, 5) };
}

export const predict: Command = {
  name: 'predict',
  group: 'sports',
  data: new SlashCommandBuilder().setName('predict').setDescription('Call the podium and the big matches, right calls pay yen').toJSON(),
  text: { aliases: ['predictions', 'call'] },
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Predictions live in servers.');
    return ctx.reply(await page(store, ctx.guildId, ctx.userId));
  },
};

export const predictTop: Command = {
  name: 'predtop',
  group: 'sports',
  data: new SlashCommandBuilder().setName('predtop').setDescription('The season\'s best predictors').toJSON(),
  call: 'predict top',
  text: { aliases: ['predict top', 'predboard', 'oracles'] },
  run: (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Predictions live in servers.');
    const rows = store.kvByPrefix(`predpts:${ctx.guildId}:`).map(({ key, value }) => ({ user: key.split(':')[2], n: Number(value) })).sort((a, b) => b.n - a.n).slice(0, 10);
    const medal = ['🥇', '🥈', '🥉'];
    return ctx.reply({ embeds: [card({ kind: 'help', title: 'Best predictors', emoji: '🔮', gif: 'off', line: '',
      body: rows.length ? rows.map((r, n) => `${medal[n] ?? `\`${n + 1}.\``} <@${r.user}> · **${r.n}** points`).join('\n') : 'Nobody has called anything yet. `tz predict` to start.' })] });
  },
};

export async function onPredict(store: Store, i: Interaction) {
  if (!(i.isButton() || i.isStringSelectMenu()) || !i.customId.startsWith('prd|') || !i.guildId) return false;
  const [, kind, id, slot] = i.customId.split('|');
  if (kind === 'f1' && i.isStringSelectMenu()) {
    const r = await nextRound().catch(() => null);
    const start = r ? Date.parse(r.sessions.find((s) => s.type === 'R')?.start ?? '') : NaN;
    if (!r || String(r.round) !== id || !(start > Date.now())) { await i.reply({ content: 'Picks for that race are closed.', flags: MessageFlags.Ephemeral }); return true; }
    const key = f1Key(r.round, i.guildId, i.user.id);
    const mine = JSON.parse(store.getKv(key) ?? '[]') as string[];
    const pick = i.values[0];
    // one driver can't be in two spots, picking them again moves them
    for (let n = 0; n < 3; n++) if (mine[n] === pick) mine[n] = '';
    mine[Number(slot)] = pick;
    store.setKv(key, JSON.stringify(mine));
  } else if (kind === 'fb') {
    store.setKv(fbKey(id, i.guildId, i.user.id), slot);
  }
  track(store, i.guildId, i.user.id, 'predict');
  const p = await page(store, i.guildId, i.user.id);
  const theirs = i.message.interactionMetadata?.user.id === i.user.id || i.message.mentions.repliedUser?.id === i.user.id || i.message.flags.has(MessageFlags.Ephemeral);
  if (theirs) await i.update(p);
  else await i.reply({ ...p, flags: MessageFlags.Ephemeral });
  return true;
}

// after the race: everyone who called it gets paid, returns the lines for the results post
export function scoreRace(store: Store, guild: string, round: number, podium: string[]): string[] {
  const out: { user: string; won: number; hits: number }[] = [];
  for (const { key, value } of store.kvByPrefix(`pred:f1:${round}:${guild}:`)) {
    if (key.endsWith(':paid') || store.getKv(`${key}:paid`)) continue;
    const user = key.split(':').at(-1)!;
    const picks = JSON.parse(value) as string[];
    let won = 0, hits = 0;
    picks.forEach((d, n) => {
      if (!d) return;
      if (podium[n] === d) { won += PODIUM.exact; hits++; } else if (podium.includes(d)) won += PODIUM.onPodium;
    });
    store.setKv(`${key}:paid`, '1');
    if (hits === 3) track(store, guild, user, 'perfectPodium');
    if (hits) track(store, guild, user, 'predictWin');
    if (won) {
      if (store.rules(guild, 'economy').enabled) store.pay(guild, user, won);
      addPoints(store, guild, user, won);
      out.push({ user, won, hits });
    }
  }
  return out.sort((a, b) => b.won - a.won).slice(0, 5).map((x) => `🔮 <@${x.user}> +¥${x.won}${x.hits === 3 ? ' · perfect podium!' : ''}`);
}

// after a match: right calls get paid
export function scoreMatch(store: Store, guild: string, m: Match): string[] {
  const result = m.home.winner ? 'home' : m.away.winner ? 'away' : 'draw';
  const right: string[] = [];
  for (const { key, value } of store.kvByPrefix(`pred:fb:${m.id}:${guild}:`)) {
    if (key.endsWith(':paid') || store.getKv(`${key}:paid`)) continue;
    store.setKv(`${key}:paid`, '1');
    if (value !== result) continue;
    const user = key.split(':').at(-1)!;
    if (store.rules(guild, 'economy').enabled) store.pay(guild, user, MATCH_PAY);
    addPoints(store, guild, user, MATCH_PAY);
    track(store, guild, user, 'predictWin');
    right.push(user);
  }
  return right.length ? [`🔮 Called it: ${right.slice(0, 10).map((u) => `<@${u}>`).join(' ')} +¥${MATCH_PAY}`] : [];
}
