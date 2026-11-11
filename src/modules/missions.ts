import { ActionRowBuilder, AttachmentBuilder, MessageFlags, SlashCommandBuilder, StringSelectMenuBuilder, type Interaction, type MessageActionRowComponentBuilder } from 'discord.js';
import { medalSheet, tierName, tierOf } from '../features/medals.js';
import type { Store } from '../db.js';
import type { Command } from '../core/module.js';
import { card } from '../theme.js';

// one place every feature reports to: a daily Agency mission for the whole server, and badges that stay on your profile

export type Event = 'quote' | 'quizwin' | 'guesswin' | 'catch' | 'catchRare' | 'catchShiny' | 'typesSeen' | 'daily' | 'dailyStreak' | 'predict' | 'predictWin' | 'perfectPodium'
  | 'quoteOfWeek' | 'fastGuess' | 'yen' | 'gave' | 'messages' | 'level' | 'watchparty' | 'nightOwl' | 'earlyBird' | 'missionStreak' | 'missionDone' | 'counted' | `catchType:${string}`;

interface Mission { id: string; text: string; event: Event; need: number }
const MISSIONS: Mission[] = [
  { id: 'quote', text: 'Make a quote out of someone\'s message', event: 'quote', need: 1 },
  { id: 'quiz2', text: 'Win 2 quiz or crest quiz questions', event: 'quizwin', need: 2 },
  { id: 'guess', text: 'Win a round of guess the anime', event: 'guesswin', need: 1 },
  { id: 'catch5', text: 'Catch 5 pokémon', event: 'catch', need: 5 },
  { id: 'water', text: 'Catch a Water type', event: 'catchType:Water', need: 1 },
  { id: 'fire', text: 'Catch a Fire type', event: 'catchType:Fire', need: 1 },
  { id: 'grass', text: 'Catch a Grass type', event: 'catchType:Grass', need: 1 },
  { id: 'psychic', text: 'Catch a Psychic type', event: 'catchType:Psychic', need: 1 },
  { id: 'daily', text: 'Claim your daily yen', event: 'daily', need: 1 },
  { id: 'predict', text: 'Make a prediction for a race or a match', event: 'predict', need: 1 },
];
const PRIZE = 120;

// achievements: a count of something done, or the best value reached (a streak, a balance, a level)
export interface Badge { id: string; emoji: string; name: string; how: string; group: string; event: Event; need: number; best?: boolean }
export const BADGES: Badge[] = [
  { id: 'catch1', emoji: '🎣', name: 'First catch', how: 'Catch a pokémon', group: 'Pokétwo', event: 'catch', need: 1 },
  { id: 'catch100', emoji: '📕', name: 'Field researcher', how: 'Catch 100 pokémon', group: 'Pokétwo', event: 'catch', need: 100 },
  { id: 'catch1000', emoji: '🏛️', name: 'Living dex', how: 'Catch 1,000 pokémon', group: 'Pokétwo', event: 'catch', need: 1000 },
  { id: 'legend', emoji: '🌟', name: 'Caught a legend', how: 'Catch a legendary, mythical or ultra beast', group: 'Pokétwo', event: 'catchRare', need: 1 },
  { id: 'shiny', emoji: '✨', name: 'Unusual colours', how: 'Catch a shiny', group: 'Pokétwo', event: 'catchShiny', need: 1 },
  { id: 'types18', emoji: '🧬', name: 'Every type', how: 'Catch at least one of all 18 types', group: 'Pokétwo', event: 'typesSeen', need: 18, best: true },
  { id: 'quiz10', emoji: '🧠', name: 'Quiz regular', how: 'Win 10 quiz or crest quiz questions', group: 'Games', event: 'quizwin', need: 10 },
  { id: 'quiz100', emoji: '🎓', name: 'Professor', how: 'Win 100 quiz questions', group: 'Games', event: 'quizwin', need: 100 },
  { id: 'guess25', emoji: '🔎', name: 'Anime sleuth', how: 'Win 25 rounds of guess the anime', group: 'Games', event: 'guesswin', need: 25 },
  { id: 'fastguess', emoji: '⚡', name: 'Quick draw', how: 'Guess the anime in under 5 seconds', group: 'Games', event: 'fastGuess', need: 1 },
  { id: 'quote1', emoji: '🖼️', name: 'First quote', how: 'Make a quote out of a message', group: 'Quotes', event: 'quote', need: 1 },
  { id: 'quote10', emoji: '📜', name: 'Collector of words', how: 'Make 10 quotes', group: 'Quotes', event: 'quote', need: 10 },
  { id: 'qotw', emoji: '🏆', name: 'Quote of the week', how: 'Have your quote picked as quote of the week', group: 'Quotes', event: 'quoteOfWeek', need: 1 },
  { id: 'qotw3', emoji: '🥇', name: 'Hall of quotes', how: 'Quote of the week 3 times', group: 'Quotes', event: 'quoteOfWeek', need: 3 },
  { id: 'podium', emoji: '🔮', name: 'Perfect podium', how: 'Call an F1 podium exactly right', group: 'Sports', event: 'perfectPodium', need: 1 },
  { id: 'predict5', emoji: '🎯', name: 'Oracle', how: 'Get 5 predictions right', group: 'Sports', event: 'predictWin', need: 5 },
  { id: 'daily30', emoji: '📅', name: '30 dailies', how: 'Claim your daily 30 times', group: 'Yen', event: 'daily', need: 30 },
  { id: 'streak7', emoji: '🔥', name: 'A week straight', how: 'Claim your daily 7 days in a row', group: 'Yen', event: 'dailyStreak', need: 7, best: true },
  { id: 'streak30', emoji: '🌋', name: 'Unbroken', how: 'Claim your daily 30 days in a row', group: 'Yen', event: 'dailyStreak', need: 30, best: true },
  { id: 'rich', emoji: '💰', name: 'Deep pockets', how: 'Hold ¥10,000 at once', group: 'Yen', event: 'yen', need: 10_000, best: true },
  { id: 'giver', emoji: '🎁', name: 'Generous', how: 'Give ¥1,000 to other people', group: 'Yen', event: 'gave', need: 1000 },
  { id: 'chat500', emoji: '💬', name: 'Regular', how: 'Send 500 messages here', group: 'Server life', event: 'messages', need: 500, best: true },
  { id: 'senior', emoji: '🧥', name: 'Senior Detective', how: 'Reach level 20', group: 'Server life', event: 'level', need: 20, best: true },
  { id: 'host', emoji: '🍿', name: 'Host', how: 'Plan a watch party', group: 'Server life', event: 'watchparty', need: 1 },
  { id: 'nightowl', emoji: '🦉', name: 'Night owl', how: 'Chat between 3 and 4 in the morning, your time', group: 'Server life', event: 'nightOwl', need: 1 },
  { id: 'earlybird', emoji: '🌅', name: 'Early bird', how: 'Chat between 5 and 6 in the morning, your time', group: 'Server life', event: 'earlyBird', need: 1 },
  { id: 'counter', emoji: '🔢', name: 'Keeps count', how: 'Get 100 numbers right in the count', group: 'Server life', event: 'counted', need: 100 },
  { id: 'mission7', emoji: '🕵️', name: 'On the case', how: 'Finish the daily mission 7 days in a row', group: 'Missions', event: 'missionStreak', need: 7, best: true },
  { id: 'mission30', emoji: '🗂️', name: 'Case closed', how: 'Finish 30 daily missions', group: 'Missions', event: 'missionDone', need: 30 },
];

// how far someone is towards one: the count so far, or their best value
export const progressOf = (store: Store, guild: string, user: string, b: Badge) =>
  Number(store.getKv(`${b.best ? 'best' : 'cnt'}:${guild}:${user}:${b.event}`) ?? 0);
// when each one was earned
export const earnedAt = (store: Store, guild: string, user: string) => JSON.parse(store.getKv(`achat:${guild}:${user}`) ?? '{}') as Record<string, number>;
// up to six picked for the profile card, the rarest ones when nothing was picked
const tierRank: Record<string, number> = { relic: 4, gold: 3, silver: 2, bronze: 1 };
export function shownOf(store: Store, guild: string, user: string, tierOf: (id: string) => string): string[] {
  const have = badgesOf(store, guild, user);
  const picked = (JSON.parse(store.getKv(`achshow:${guild}:${user}`) ?? 'null') as string[] | null)?.filter((id) => have.includes(id));
  if (picked?.length) return picked.slice(0, 6);
  return [...have].sort((a, b) => (tierRank[tierOf(b)] ?? 0) - (tierRank[tierOf(a)] ?? 0)).slice(0, 6);
}
export const setShown = (store: Store, guild: string, user: string, ids: string[]) => store.setKv(`achshow:${guild}:${user}`, JSON.stringify(ids.slice(0, 6)));

const today = () => new Date().toISOString().slice(0, 10);
// the same mission for everyone in a server on a day, so people can do it together
export function missionOf(guild: string, day = today()) {
  let h = 0;
  for (const c of `${guild}:${day}`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return MISSIONS[h % MISSIONS.length];
}

export const badgesOf = (store: Store, guild: string, user: string) => JSON.parse(store.getKv(`ach:${guild}:${user}`) ?? '[]') as string[];

function count(store: Store, key: string, by = 1) {
  const n = Number(store.getKv(key) ?? 0) + by;
  store.setKv(key, String(n));
  return n;
}

// a feature says something happened, back come the lines worth showing (a badge, a finished mission)
// for the "best" kind, by is the value reached, like a streak of 12 or a balance of 4,000
export function track(store: Store, guild: string | null, user: string, event: Event, by = 1): string[] {
  if (!guild) return [];
  const out: string[] = [];
  const isBest = BADGES.some((b) => b.event === event && b.best);
  let total: number;
  if (isBest) {
    const key = `best:${guild}:${user}:${event}`;
    const was = Number(store.getKv(key) ?? 0);
    total = Math.max(was, by);
    // a value that isn't a new best changes nothing, and that's the common case for chat
    if (total === was && !BADGES.some((b) => b.event === event && total >= b.need && !badgesOf(store, guild, user).includes(b.id))) return [];
    if (total !== was) store.setKv(key, String(total));
  } else total = count(store, `cnt:${guild}:${user}:${event}`, by);
  const have = badgesOf(store, guild, user);
  const at = earnedAt(store, guild, user);
  const earn = (b: Badge) => {
    have.push(b.id);
    at[b.id] = Date.now();
    out.push(`${b.emoji} <@${user}> earned **${b.name}**! *${b.how.toLowerCase()}*`);
  };
  for (const b of BADGES) if (b.event === event && total >= b.need && !have.includes(b.id)) earn(b);
  // the types caught so far, for the every-type medal
  if (event.startsWith('catchType:')) {
    const key = `types:${guild}:${user}`;
    const seen = new Set(JSON.parse(store.getKv(key) ?? '[]') as string[]);
    const before = seen.size;
    seen.add(event.slice(10));
    if (seen.size !== before) {
      store.setKv(key, JSON.stringify([...seen]));
      store.setKv(`best:${guild}:${user}:typesSeen`, String(seen.size));
      for (const b of BADGES) if (b.event === 'typesSeen' && seen.size >= b.need && !have.includes(b.id)) earn(b);
    }
  }
  // today's mission
  const m = missionOf(guild);
  if (m.event === event) {
    const key = `mission:${guild}:${today()}:${user}`;
    const before = Number(store.getKv(key) ?? 0);
    if (before < m.need) {
      const now = count(store, key, by);
      if (now >= m.need) {
        const streakKey = `mstreak:${guild}:${user}`;
        const s = JSON.parse(store.getKv(streakKey) ?? '{"last":"","n":0}') as { last: string; n: number };
        const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
        s.n = s.last === yesterday ? s.n + 1 : 1;
        s.last = today();
        store.setKv(streakKey, JSON.stringify(s));
        const bonus = PRIZE + Math.min(6, s.n - 1) * 20;
        if (store.rules(guild, 'economy').enabled) store.pay(guild, user, bonus);
        out.push(`🕵️ <@${user}> finished today's mission${store.rules(guild, 'economy').enabled ? `, +¥${bonus}` : ''}${s.n > 1 ? ` · 🔥 ${s.n} day streak` : ''}`);
        const done = count(store, `cnt:${guild}:${user}:missionDone`);
        const best = Math.max(s.n, Number(store.getKv(`best:${guild}:${user}:missionStreak`) ?? 0));
        store.setKv(`best:${guild}:${user}:missionStreak`, String(best));
        for (const b of BADGES) {
          if (have.includes(b.id)) continue;
          if ((b.event === 'missionStreak' && best >= b.need) || (b.event === 'missionDone' && done >= b.need)) earn(b);
        }
      }
    }
  }
  if (out.length) {
    store.setKv(`ach:${guild}:${user}`, JSON.stringify(have));
    store.setKv(`achat:${guild}:${user}`, JSON.stringify(at));
  }
  return out;
}

export const mission: Command = {
  name: 'mission',
  group: 'you',
  data: new SlashCommandBuilder().setName('mission').setDescription('Today\'s Agency mission and your badges').toJSON(),
  text: { aliases: ['missions'] },
  run: (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Missions are per server.');
    const m = missionOf(ctx.guildId);
    const done = Number(store.getKv(`mission:${ctx.guildId}:${today()}:${ctx.userId}`) ?? 0);
    const s = JSON.parse(store.getKv(`mstreak:${ctx.guildId}:${ctx.userId}`) ?? '{"last":"","n":0}') as { last: string; n: number };
    const have = badgesOf(store, ctx.guildId, ctx.userId);
    const midnight = Math.floor(Date.parse(`${today()}T00:00:00Z`) / 1000) + 86_400;
    const e = card({ kind: 'help', title: 'Today\'s mission', emoji: '🕵️', gif: 'off', line: '',
      body: `**${m.text}**\n${done >= m.need ? '✅ done' : `${Math.min(done, m.need)}/${m.need}`} · pays ¥${PRIZE} plus ¥20 a day for a streak · new mission <t:${midnight}:R>${s.n ? `\n🔥 ${s.n} day streak` : ''}`,
      fields: [{ name: '🏅 Achievements', value: `${have.length} of ${BADGES.length} earned · \`tz achievements\` shows them all and what's left`, inline: false }] });
    return ctx.reply({ embeds: [e] });
  },
};

const shortDate = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

// every medal, how to earn it and how close you are, and the pick of which ones go on the profile card
export const achievements: Command = {
  name: 'achievements',
  group: 'you',
  data: new SlashCommandBuilder().setName('achievements').setDescription('Every medal, how to earn it, and which ones show on your profile')
    .addUserOption((o) => o.setName('user').setDescription('Whose, yours if empty')).toJSON(),
  text: { aliases: ['medals', 'badges', 'ach'], args: ['user'] },
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Achievements are per server.');
    const id = ctx.user('user') ?? ctx.userId;
    const mine = id === ctx.userId;
    const have = badgesOf(store, ctx.guildId, id);
    const at = earnedAt(store, ctx.guildId, id);
    const member = ctx.guild ? await ctx.guild.members.fetch(id).catch(() => null) : null;
    const png = medalSheet(`Achievements · ${member?.displayName ?? 'Agent'}`, BADGES.map((b) => {
      const got = have.includes(b.id);
      const p = Math.min(progressOf(store, ctx.guildId!, id, b), b.need);
      return { id: b.id, name: b.name, earned: got, progress: got ? (at[b.id] ? `earned ${shortDate(at[b.id])}` : 'earned') : `${p.toLocaleString()}/${b.need.toLocaleString()}` };
    }));
    const groups = [...new Set(BADGES.map((b) => b.group))];
    const fields = groups.map((g) => ({
      name: g,
      value: BADGES.filter((b) => b.group === g).map((b) => {
        const got = have.includes(b.id);
        const p = Math.min(progressOf(store, ctx.guildId!, id, b), b.need);
        return `${got ? b.emoji : '▫️'} ${got ? `**${b.name}**` : b.name} · ${b.how}${got ? '' : ` · ${p.toLocaleString()}/${b.need.toLocaleString()}`}`;
      }).join('\n').slice(0, 1024),
      inline: false,
    }));
    const shown = shownOf(store, ctx.guildId, id, tierOf);
    const rows = [];
    if (mine && have.length) rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(`achpick|${ctx.userId}`).setPlaceholder('🎖️ Pick up to 6 for your profile card').setMinValues(0).setMaxValues(Math.min(6, have.length))
        .addOptions(BADGES.filter((b) => have.includes(b.id)).slice(0, 25).map((b) => ({ label: b.name, value: b.id, emoji: b.emoji, description: `${tierName[tierOf(b.id)]} · ${b.how}`.slice(0, 100), default: shown.includes(b.id) }))),
    ));
    const e = card({ kind: 'help', title: mine ? 'Your achievements' : `${member?.displayName ?? 'Their'} achievements`, emoji: '🎖️', gif: 'off', line: '',
      body: `**${have.length} of ${BADGES.length}** earned. Bronze, silver, gold, and purple relics for the rare ones.${mine && have.length ? '\nPick which ones show on your profile card with the menu below.' : ''}`, fields })
      .setImage('attachment://achievements.png');
    return ctx.reply({ embeds: [e], files: [new AttachmentBuilder(png, { name: 'achievements.png' })], components: rows });
  },
};

export async function onAchPick(store: Store, i: Interaction) {
  if (!i.isStringSelectMenu() || !i.customId.startsWith('achpick|') || !i.guildId) return false;
  if (i.customId.split('|')[1] !== i.user.id) { await i.reply({ content: 'Those are someone else\'s medals. `tz achievements` opens yours.', flags: MessageFlags.Ephemeral }); return true; }
  const have = badgesOf(store, i.guildId, i.user.id);
  const pick = i.values.filter((v) => have.includes(v));
  setShown(store, i.guildId, i.user.id, pick);
  const names = pick.map((v) => BADGES.find((b) => b.id === v)?.name).filter(Boolean);
  await i.reply({ content: names.length ? `🎖️ Your profile card now shows **${names.join('**, **')}**. See it with \`tz profile\`.` : '🎖️ Nothing picked, your rarest medals show by default.', flags: MessageFlags.Ephemeral });
  return true;
}
