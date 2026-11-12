import { verdictCard, type VerdictRow } from '../features/predcard.js';
import { track } from './missions.js';
import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder, StringSelectMenuBuilder,
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
    const ko = Number(store.getKv(`predko:${id}`) ?? 0);
    if (ko && Date.now() > ko) { await i.reply({ content: 'That one has kicked off, calls are closed.', flags: MessageFlags.Ephemeral }); return true; }
    store.setKv(fbKey(id, i.guildId, i.user.id), slot);
  }
  // on the desk channel a quiet confirmation is enough
  if (i.channelId === store.getKv(`deskch:${i.guildId}`)) {
    track(store, i.guildId, i.user.id, 'predict');
    const said = kind === 'f1' ? `${['🥇', '🥈', '🥉'][Number(slot)]} ${(i as import('discord.js').StringSelectMenuInteraction).values[0]}` : slot === 'draw' ? 'a draw' : (i.component as { label?: string | null }).label ?? slot;
    await i.reply({ content: `🔮 Noted: **${said}**. \`tz predict\` shows all your calls.`, flags: MessageFlags.Ephemeral });
    return true;
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

// ---------- the desk: a channel where the day's calls are posted for everyone ----------

// yesterday's desk matches, how they ended and who called them, drawn like the F1 results
async function postVerdict(store: Store, guild: import('discord.js').Guild, ch: import('discord.js').SendableChannels, day: string) {
  const list = JSON.parse(store.getKv(`desk:list:${day}:${guild.id}`) ?? '[]') as { id: string; league: string; date: number }[];
  if (!list.length) return;
  const rows: VerdictRow[] = [];
  const tally = new Map<string, number>();
  for (const x of list) {
    const m = (await matches(x.league, new Date(x.date), 0).catch(() => [] as Match[])).find((y) => y.id === x.id);
    if (!m || m.state !== 'post') continue;
    // the feed may have missed it, scoring twice is safe
    scoreMatch(store, guild.id, m);
    const result = m.home.winner ? 'home' : m.away.winner ? 'away' : 'draw';
    const calls = store.kvByPrefix(`pred:fb:${m.id}:${guild.id}:`).filter(({ key }) => !key.endsWith(':paid'));
    const right = calls.filter(({ value }) => value === result);
    for (const { key } of right) { const u = key.split(':').at(-1)!; tally.set(u, (tally.get(u) ?? 0) + 1); }
    rows.push({ home: m.home.name, away: m.away.name, score: `${m.home.score ?? 0} – ${m.away.score ?? 0}`, result, right: right.length, total: calls.length });
  }
  if (!rows.length) return;
  const best = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const top = await Promise.all(best.map(async ([u, n]) => ({ name: (await guild.members.fetch(u).catch(() => null))?.displayName ?? 'someone', right: n, yen: n * MATCH_PAY })));
  const png = await verdictCard({ title: 'The verdict', subtitle: `${new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · ${rows.length} match${rows.length === 1 ? '' : 'es'}`, rows, top }, store.getKv(`f1theme:${guild.id}`));
  await ch.send({ content: best.length ? `🔮 Yesterday's calls are settled. Sharpest: ${best.slice(0, 3).map(([u]) => `<@${u}>`).join(' ')}` : '🔮 Yesterday\'s calls are settled.', files: [new AttachmentBuilder(png, { name: 'verdict.png' })], allowedMentions: { users: best.slice(0, 3).map(([u]) => u) } }).catch(() => {});
}

export const DESK = { name: '🔮┃ranpos-deductions', topic: 'Call the day\'s big matches and the next podium before they start. Right calls pay yen, the best get a spot on tz predict top.' };

// the early morning football post, and an F1 one once per race week
export function startDesk(client: import('discord.js').Client, store: Store) {
  const tick = async () => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    for (const guild of client.guilds.cache.values()) {
      const id = store.getKv(`deskch:${guild.id}`);
      if (!id || !store.rules(guild.id, 'bulletins').enabled) continue;
      const ch = await guild.channels.fetch(id).catch(() => null);
      if (!ch?.isSendable()) continue;
      // around 6 in the morning in India: first yesterday's verdict as a picture, then today's calls
      if (now.getUTCHours() * 60 + now.getUTCMinutes() >= 30 && store.firstTime(guild.id, `desk:fb:${day}`)) {
        await postVerdict(store, guild, ch, new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10)).catch((e) => console.error('verdict', e));
        const big = (await todaysBig(store, guild.id).catch(() => [] as Match[])).slice(0, 4);
        if (big.length) {
          for (const m of big) store.setKv(`predko:${m.id}`, String(m.date));
          store.setKv(`desk:list:${day}:${guild.id}`, JSON.stringify(big.map((m) => ({ id: m.id, league: m.league, date: m.date }))));
          const ping = store.getKv(`predrole:${guild.id}`);
          await ch.send({
            content: ping && guild.roles.cache.has(ping) ? `<@&${ping}> today's calls are open` : undefined,
            allowedMentions: { roles: ping ? [ping] : [] },
            embeds: [card({ kind: 'help', title: `Today's matches · ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`, emoji: '⚽', gif: 'off', line: '',
              body: `${big.map((m) => `${clubDot(m.home)} **${m.home.name}** vs **${m.away.name}** ${clubDot(m.away)}\n-# ${leagues[m.league]?.name ?? ''} · kick-off <t:${unix(m.date)}:t>, calls close then`).join('\n\n')}\n\n-# A right call pays ¥${MATCH_PAY}. Press again to change your mind before kick-off.` })],
            components: big.map((m) => row(
              new ButtonBuilder().setCustomId(`prd|fb|${m.id}|home`).setLabel(m.home.name.slice(0, 40)).setEmoji(asEmoji(clubDot(m.home))!).setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId(`prd|fb|${m.id}|draw`).setLabel('Draw').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId(`prd|fb|${m.id}|away`).setLabel(m.away.name.slice(0, 40)).setEmoji(asEmoji(clubDot(m.away))!).setStyle(ButtonStyle.Secondary),
            )),
          }).catch(() => {});
        }
      }
      // F1: once a race week, four days before the race
      const r = await nextRound().catch(() => null);
      const start = r ? Date.parse(r.sessions.find((s) => s.type === 'R')?.start ?? '') : NaN;
      if (r && start > now.getTime() && start - now.getTime() < 4 * 86_400_000 && store.firstTime(guild.id, `desk:f1:${r.round}`)) {
        const h = await home().catch(() => null);
        const drivers = (h?.standings ?? []).slice(0, 25);
        if (drivers.length) {
          const ping = store.getKv(`predrole:${guild.id}`);
          await ch.send({
            content: ping && guild.roles.cache.has(ping) ? `<@&${ping}> the podium calls are open` : undefined,
            allowedMentions: { roles: ping ? [ping] : [] },
            embeds: [card({ kind: 'help', title: `${flagOf[r.circuit.country] ?? '🏁'} ${r.name} · call the podium`, emoji: '', gif: 'off', line: '',
              body: `Pick the top three before lights out <t:${unix(start)}:R>.\n\n-# ¥${PODIUM.exact} for each driver in the right spot, ¥${PODIUM.onPodium} on the podium but the wrong spot. Picking again changes it.` })],
            components: [0, 1, 2].map((n) => row(new StringSelectMenuBuilder().setCustomId(`prd|f1|${r.round}|${n}`).setPlaceholder(['🥇 Winner', '🥈 Second', '🥉 Third'][n])
              .addOptions(drivers.map((d) => ({ label: d.driver, value: d.driver, emoji: asEmoji(teamDot(d.team)) }))))),
          }).catch(() => {});
        }
      }
    }
  };
  setTimeout(() => void tick(), 90_000);
  setInterval(() => void tick(), 10 * 60_000);
}
