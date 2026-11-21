import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder, StringSelectMenuBuilder, type Interaction, type MessageActionRowComponentBuilder } from 'discord.js';
import { medalSheet, tierName, tierOf } from '../features/medals.js';
import type { Store } from '../db.js';
import type { Command } from '../core/module.js';
import { card } from '../theme.js';
import { fetchAvatar, medalCase } from '../features/rankcard.js';

// one place every feature reports to: a daily Agency mission for the whole server, and badges that stay on your profile

export type Event = 'quote' | 'quizwin' | 'guesswin' | 'catch' | 'catchRare' | 'catchShiny' | 'typesSeen' | 'daily' | 'dailyStreak' | 'predict' | 'predictWin' | 'perfectPodium'
  | 'quoteOfWeek' | 'fastGuess' | 'yen' | 'gave' | 'messages' | 'level' | 'watchparty' | 'nightOwl' | 'earlyBird' | 'missionStreak' | 'missionDone' | 'rareDone' | 'evidence' | 'married' | 'adopted' | 'counted' | 'countRecord' | `catchType:${string}`;

// quests: three dailies, two weeklies, and now and then a rare one that lasts three days
// cmd:<name> is counted whenever someone runs that command, so any command can be a quest
type QEvent = Event | `cmd:${string}`;
interface Quest { id: string; text: string; event: QEvent; need: number; pay: number }
const DAILY: Quest[] = [
  { id: 'quote', text: 'Make a quote out of someone\'s message', event: 'quote', need: 1, pay: 120 },
  { id: 'quiz2', text: 'Win 2 quiz or crest quiz questions', event: 'quizwin', need: 2, pay: 140 },
  { id: 'guess', text: 'Win a round of guess the anime', event: 'guesswin', need: 1, pay: 140 },
  { id: 'catch5', text: 'Catch 5 pokémon', event: 'catch', need: 5, pay: 150 },
  { id: 'water', text: 'Catch a Water type', event: 'catchType:Water', need: 1, pay: 110 },
  { id: 'fire', text: 'Catch a Fire type', event: 'catchType:Fire', need: 1, pay: 120 },
  { id: 'grass', text: 'Catch a Grass type', event: 'catchType:Grass', need: 1, pay: 110 },
  { id: 'psychic', text: 'Catch a Psychic type', event: 'catchType:Psychic', need: 1, pay: 140 },
  { id: 'electric', text: 'Catch an Electric type', event: 'catchType:Electric', need: 1, pay: 140 },
  { id: 'daily', text: 'Claim your daily yen', event: 'daily', need: 1, pay: 80 },
  { id: 'predict', text: 'Make a prediction for a race or a match', event: 'predict', need: 1, pay: 120 },
  { id: 'chat30', text: 'Send 30 messages', event: 'messages', need: 30, pay: 120 },
  { id: 'work2', text: 'Work 2 shifts with `tz work`', event: 'cmd:work', need: 2, pay: 120 },
  { id: 'fish3', text: 'Go fishing 3 times', event: 'cmd:fish', need: 3, pay: 120 },
  { id: 'scratch', text: 'Scratch a ticket', event: 'cmd:scratch', need: 1, pay: 100 },
  { id: 'slots3', text: 'Play the slots 3 times', event: 'cmd:slots', need: 3, pay: 120 },
  { id: 'bj2', text: 'Play 2 hands of blackjack', event: 'cmd:blackjack', need: 2, pay: 130 },
  { id: 'rps2', text: 'Play rock paper scissors twice', event: 'cmd:rps', need: 2, pay: 100 },
  { id: 'count10', text: 'Get 10 numbers right in the count', event: 'counted', need: 10, pay: 140 },
  { id: 'give', text: 'Give yen to someone', event: 'gave', need: 1, pay: 120 },
  { id: 'crime', text: 'Pull off a crime with `tz crime`', event: 'cmd:crime', need: 1, pay: 130 },
  { id: 'evidence', text: 'Post a picture, clip or link on the evidence board', event: 'evidence', need: 1, pay: 120 },
  { id: 'act2', text: 'Hug, pat or bonk someone twice', event: 'cmd:act', need: 2, pay: 90 },
];
const WEEKLY: Quest[] = [
  { id: 'catch50', text: 'Catch 50 pokémon', event: 'catch', need: 50, pay: 1200 },
  { id: 'quiz15', text: 'Win 15 quiz questions', event: 'quizwin', need: 15, pay: 1200 },
  { id: 'guess8', text: 'Win 8 rounds of guess the anime', event: 'guesswin', need: 8, pay: 1100 },
  { id: 'chat400', text: 'Send 400 messages', event: 'messages', need: 400, pay: 1000 },
  { id: 'count75', text: 'Get 75 numbers right in the count', event: 'counted', need: 75, pay: 1100 },
  { id: 'work15', text: 'Work 15 shifts', event: 'cmd:work', need: 15, pay: 1000 },
  { id: 'heist2', text: 'Join 2 heists', event: 'cmd:heist', need: 2, pay: 1300 },
  { id: 'fish20', text: 'Go fishing 20 times', event: 'cmd:fish', need: 20, pay: 1000 },
  { id: 'predict3', text: 'Make 3 predictions', event: 'predict', need: 3, pay: 900 },
  { id: 'quote5', text: 'Make 5 quotes', event: 'quote', need: 5, pay: 1000 },
  { id: 'dragon', text: 'Catch a Dragon type', event: 'catchType:Dragon', need: 1, pay: 1400 },
  { id: 'ghost2', text: 'Catch 2 Ghost types', event: 'catchType:Ghost', need: 2, pay: 1300 },
  { id: 'evidence8', text: 'Post 8 pieces of evidence on the evidence board', event: 'evidence', need: 8, pay: 1000 },
  { id: 'daily5', text: 'Claim your daily on 5 days', event: 'daily', need: 5, pay: 1000 },
];
const RARE: Quest[] = [
  { id: 'shiny', text: 'Catch a shiny', event: 'catchShiny', need: 1, pay: 6000 },
  { id: 'legend', text: 'Catch a legendary, mythical or ultra beast', event: 'catchRare', need: 1, pay: 4000 },
  { id: 'fast', text: 'Guess the anime in under 5 seconds', event: 'fastGuess', need: 1, pay: 3500 },
  { id: 'oracle', text: 'Get 2 predictions right', event: 'predictWin', need: 2, pay: 4000 },
  { id: 'record', text: 'Push the count past its record', event: 'countRecord', need: 1, pay: 3500 },
  { id: 'catch150', text: 'Catch 150 pokémon', event: 'catch', need: 150, pay: 4500 },
  { id: 'quiz30', text: 'Win 30 quiz questions', event: 'quizwin', need: 30, pay: 4000 },
  { id: 'heist5', text: 'Join 5 heists', event: 'cmd:heist', need: 5, pay: 4000 },
];
const SET_BONUS = { daily: 200, weekly: 750 };
const RARE_DAYS = 3;
const RARE_CHANCE = 22; // out of 100, rolled once a day while no rare quest is open

const hashOf = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };
// a few different picks from a pool, the same for that person all day or week
function pickFrom(pool: Quest[], seed: string, n: number) {
  return [...pool].map((q) => [hashOf(`${seed}:${q.id}`), q] as const).sort((x, y) => x[0] - y[0]).slice(0, n).map(([, q]) => q);
}
const weekOf = (d = new Date()) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day);
  return t.toISOString().slice(0, 10); // the Monday
};
interface Rare { id: string; until: number; done?: boolean }
// the rare quest someone has open, rolling for a new one once a day when there's none
export function rareOf(store: Store, g: string, u: string): Rare | null {
  const key = `qrare:${g}:${u}`;
  const cur = JSON.parse(store.getKv(key) ?? 'null') as Rare | null;
  if (cur && cur.until > Date.now() && !cur.done) return cur;
  const rolled = `qrareroll:${g}:${u}`;
  if (store.getKv(rolled) === today()) return cur && cur.until > Date.now() ? cur : null;
  store.setKv(rolled, today());
  if (hashOf(`${g}:${u}:${today()}:rare`) % 100 >= RARE_CHANCE) return cur && cur.until > Date.now() ? cur : null;
  const q = RARE[hashOf(`${g}:${u}:${today()}:which`) % RARE.length];
  const fresh: Rare = { id: q.id, until: Date.now() + RARE_DAYS * 86_400_000 };
  store.setKv(key, JSON.stringify(fresh));
  store.setKv(`q:${g}:${u}:rare:${fresh.until}`, '0');
  return fresh;
}
export const dailiesOf = (g: string, u: string, day = today()) => pickFrom(DAILY, `${g}:${u}:${day}`, 3);
export const weekliesOf = (g: string, u: string, wk = weekOf()) => pickFrom(WEEKLY, `${g}:${u}:${wk}`, 2);
const progKey = (g: string, u: string, period: string, id: string) => `q:${g}:${u}:${period}:${id}`;
const got = (store: Store, k: string) => Number(store.getKv(k) ?? 0);
interface Streak { last: string; n: number; best?: number }
const streakOf = (store: Store, key: string) => JSON.parse(store.getKv(key) ?? '{"last":"","n":0}') as Streak;

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
  { id: 'snap25', emoji: '📸', name: 'Evidence clerk', how: 'Post 25 pieces of evidence on the evidence board', group: 'Server life', event: 'evidence', need: 25 },
  { id: 'snap100', emoji: '🗃️', name: 'Chief of evidence', how: 'Post 100 pieces of evidence on the evidence board', group: 'Server life', event: 'evidence', need: 100 },
  { id: 'wed', emoji: '💒', name: 'Tied the knot', how: 'Get married', group: 'Server life', event: 'married', need: 1 },
  { id: 'parent', emoji: '🍼', name: 'Head of the family', how: 'Adopt someone', group: 'Server life', event: 'adopted', need: 1 },
  { id: 'counter1k', emoji: '📒', name: 'The ledger', how: 'Get 1,000 numbers right in the count', group: 'Server life', event: 'counted', need: 1000 },
  { id: 'recorder', emoji: '🏆', name: 'Record keeper', how: 'Push the count past its old record', group: 'Server life', event: 'countRecord', need: 1 },
  { id: 'mission7', emoji: '🕵️', name: 'On the case', how: 'Clear all three daily quests 7 days in a row', group: 'Quests', event: 'missionStreak', need: 7, best: true },
  { id: 'mission30', emoji: '🗂️', name: 'Case closed', how: 'Finish 30 quests', group: 'Quests', event: 'missionDone', need: 30 },
  { id: 'quest250', emoji: '📚', name: 'Archivist', how: 'Finish 250 quests', group: 'Quests', event: 'missionDone', need: 250 },
  { id: 'rare1', emoji: '💠', name: 'Off the books', how: 'Crack a rare quest', group: 'Quests', event: 'rareDone', need: 1 },
  { id: 'rare10', emoji: '🔱', name: 'Special division', how: 'Crack 10 rare quests', group: 'Quests', event: 'rareDone', need: 10 },
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
export const badgesOf = (store: Store, guild: string, user: string) => JSON.parse(store.getKv(`ach:${guild}:${user}`) ?? '[]') as string[];

function count(store: Store, key: string, by = 1) {
  const n = Number(store.getKv(key) ?? 0) + by;
  store.setKv(key, String(n));
  return n;
}

// a feature says something happened, back come the lines worth showing (a badge, a finished mission)
// for the "best" kind, by is the value reached, like a streak of 12 or a balance of 4,000
export function track(store: Store, guild: string | null, user: string, event: Event | `cmd:${string}`, by = 1): string[] {
  if (!guild) return [];
  const out: string[] = [];
  if (event.startsWith('cmd:')) {
    const have = badgesOf(store, guild, user);
    const at = earnedAt(store, guild, user);
    const medals: string[] = [];
    const out = questProgress(store, guild, user, event, by, have, (b) => { have.push(b.id); at[b.id] = Date.now(); medals.push(`${b.emoji} <@${user}> earned **${b.name}**! *${b.how.toLowerCase()}*`); });
    if (medals.length) { store.setKv(`ach:${guild}:${user}`, JSON.stringify(have)); store.setKv(`achat:${guild}:${user}`, JSON.stringify(at)); }
    return [...out, ...medals];
  }
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
  out.push(...questProgress(store, guild, user, event, by, have, earn));
  if (out.length) {
    store.setKv(`ach:${guild}:${user}`, JSON.stringify(have));
    store.setKv(`achat:${guild}:${user}`, JSON.stringify(at));
  }
  return out;
}

// moves every open quest that listens for this event, pays what finishes, and keeps the streaks
function questProgress(store: Store, g: string, u: string, event: QEvent, by: number, have: string[], earn: (b: Badge) => void): string[] {
  const out: string[] = [];
  const paid = store.rules(g, 'economy').enabled;
  const pay = (n: number) => { if (paid && n > 0) store.pay(g, u, n); };
  const day = today(), wk = weekOf();
  const finish = (q: Quest, period: string) => {
    const k = progKey(g, u, period, q.id);
    const was = got(store, k);
    if (was >= q.need) return false;
    const now = Math.min(q.need, was + by);
    store.setKv(k, String(now));
    if (now < q.need) return false;
    pay(q.pay);
    store.setKv(`cnt:${g}:${u}:missionDone`, String(got(store, `cnt:${g}:${u}:missionDone`) + 1));
    return true;
  };
  // dailies
  const daily = dailiesOf(g, u, day);
  for (const q of daily.filter((x) => x.event === event)) if (finish(q, day)) out.push(`📜 <@${u}> finished a daily quest: **${q.text}**${paid ? `, +¥${q.pay}` : ''}`);
  if (daily.some((q) => q.event === event) && daily.every((q) => got(store, progKey(g, u, day, q.id)) >= q.need) && store.getKv(`qset:${g}:${u}:${day}`) !== '1') {
    store.setKv(`qset:${g}:${u}:${day}`, '1');
    const s = streakOf(store, `mstreak:${g}:${u}`);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    s.n = s.last === yesterday ? s.n + 1 : 1;
    s.last = day;
    s.best = Math.max(s.best ?? 0, s.n);
    store.setKv(`mstreak:${g}:${u}`, JSON.stringify(s));
    // the streak adds to the bonus up to ten days, and every seventh day pays a little extra
    const bonus = SET_BONUS.daily + Math.min(10, s.n - 1) * 25 + (s.n % 7 === 0 ? 500 : 0);
    pay(bonus);
    out.push(`🗂️ <@${u}> cleared all three dailies${paid ? `, bonus **¥${bonus}**` : ''}${s.n > 1 ? ` · 🔥 **${s.n} day** streak` : ''}${s.n % 7 === 0 ? ' · a week straight!' : ''}`);
    const best = Math.max(s.n, got(store, `best:${g}:${u}:missionStreak`));
    store.setKv(`best:${g}:${u}:missionStreak`, String(best));
  }
  // weeklies
  const weekly = weekliesOf(g, u, wk);
  for (const q of weekly.filter((x) => x.event === event)) if (finish(q, `w${wk}`)) out.push(`📅 <@${u}> finished a weekly quest: **${q.text}**${paid ? `, +¥${q.pay.toLocaleString()}` : ''}`);
  if (weekly.some((q) => q.event === event) && weekly.every((q) => got(store, progKey(g, u, `w${wk}`, q.id)) >= q.need) && store.getKv(`qwset:${g}:${u}:${wk}`) !== '1') {
    store.setKv(`qwset:${g}:${u}:${wk}`, '1');
    const s = streakOf(store, `qwstreak:${g}:${u}`);
    const lastWeek = weekOf(new Date(Date.now() - 7 * 86_400_000));
    s.n = s.last === lastWeek ? s.n + 1 : 1;
    s.last = wk;
    store.setKv(`qwstreak:${g}:${u}`, JSON.stringify(s));
    const bonus = SET_BONUS.weekly + Math.min(4, s.n - 1) * 250;
    pay(bonus);
    out.push(`🗓️ <@${u}> cleared both weeklies${paid ? `, bonus **¥${bonus.toLocaleString()}**` : ''}${s.n > 1 ? ` · 🔥 **${s.n} weeks** running` : ''}`);
  }
  // the rare one
  const r = JSON.parse(store.getKv(`qrare:${g}:${u}`) ?? 'null') as Rare | null;
  const rq = r && !r.done && r.until > Date.now() ? RARE.find((q) => q.id === r.id) : null;
  if (rq && rq.event === event && finish(rq, `rare:${r!.until}`)) {
    store.setKv(`qrare:${g}:${u}`, JSON.stringify({ ...r, done: true }));
    const n = got(store, `cnt:${g}:${u}:rareDone`) + 1;
    store.setKv(`cnt:${g}:${u}:rareDone`, String(n));
    out.push(`💠 <@${u}> cracked a **rare quest**: **${rq.text}**${paid ? `, +¥${rq.pay.toLocaleString()}` : ''}!`);
    for (const b of BADGES) if (b.event === 'rareDone' && n >= b.need && !have.includes(b.id)) earn(b);
  }
  // quest medals
  const done = got(store, `cnt:${g}:${u}:missionDone`);
  const best = got(store, `best:${g}:${u}:missionStreak`);
  for (const b of BADGES) {
    if (have.includes(b.id)) continue;
    if ((b.event === 'missionStreak' && best >= b.need) || (b.event === 'missionDone' && done >= b.need)) earn(b);
  }
  return out;
}

// one quest as a line: the bar, the count and the pay
const bar = (n: number, need: number) => { const k = Math.round((Math.min(n, need) / need) * 8); return `${'▰'.repeat(k)}${'▱'.repeat(8 - k)}`; };
const line = (store: Store, k: string, q: Quest) => {
  const n = got(store, k);
  return n >= q.need ? `✅ ~~${q.text}~~ · ¥${q.pay.toLocaleString()}` : `▫️ **${q.text}**\n${bar(n, q.need)} ${n.toLocaleString()}/${q.need.toLocaleString()} · ¥${q.pay.toLocaleString()}`;
};

export function questPage(store: Store, g: string, u: string) {
  const day = today(), wk = weekOf();
  const daily = dailiesOf(g, u, day), weekly = weekliesOf(g, u, wk);
  const rare = rareOf(store, g, u);
  const rq = rare ? RARE.find((q) => q.id === rare.id) : null;
  const s = streakOf(store, `mstreak:${g}:${u}`);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const alive = s.last === day || s.last === yesterday ? s.n : 0;
  const ws = streakOf(store, `qwstreak:${g}:${u}`);
  const wAlive = ws.last === wk || ws.last === weekOf(new Date(Date.now() - 7 * 86_400_000)) ? ws.n : 0;
  const midnight = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) + 86_400;
  const monday = Math.floor(Date.parse(`${wk}T00:00:00Z`) / 1000) + 7 * 86_400;
  const dDone = store.getKv(`qset:${g}:${u}:${day}`) === '1';
  const wDone = store.getKv(`qwset:${g}:${u}:${wk}`) === '1';
  const nextBonus = SET_BONUS.daily + Math.min(10, (s.last === yesterday ? s.n : 0)) * 25;
  const fields = [
    { name: `📜 Daily · new <t:${midnight}:R>`, value: [...daily.map((q) => line(store, progKey(g, u, day, q.id), q)), dDone ? '🗂️ All three done today.' : `All three: **+¥${nextBonus}** bonus and the streak goes on`].join('\n'), inline: false },
    { name: `🗓️ Weekly · new <t:${monday}:R>`, value: [...weekly.map((q) => line(store, progKey(g, u, `w${wk}`, q.id), q)), wDone ? '🗓️ Both done this week.' : `Both: **+¥${(SET_BONUS.weekly + Math.min(4, wAlive) * 250).toLocaleString()}** bonus`].join('\n'), inline: false },
    rq && rare
      ? { name: `💠 Rare · ends <t:${Math.floor(rare.until / 1000)}:R>`, value: rare.done ? `✅ ~~${rq.text}~~ · cracked it` : line(store, progKey(g, u, `rare:${rare.until}`, rq.id), rq), inline: false }
      : { name: '💠 Rare', value: 'None open. Some days a rare, hard quest turns up and stays for three days, check back tomorrow.', inline: false },
  ];
  return {
    embeds: [card({ kind: 'help', title: 'Your quests', emoji: '📜', gif: 'off', line: '',
      body: `🔥 Daily streak **${alive}** day${alive === 1 ? '' : 's'} · 🗓️ weekly streak **${wAlive}** · ${got(store, `cnt:${g}:${u}:missionDone`).toLocaleString()} quests done${s.best ? ` · best streak ${s.best}` : ''}`,
      fields })],
  };
}

export function questGlance(store: Store, g: string, u: string) {
  const day = today();
  const daily = dailiesOf(g, u, day);
  const n = daily.filter((q) => got(store, progKey(g, u, day, q.id)) >= q.need).length;
  const rare = rareOf(store, g, u);
  return `📜 Quests **${n}/3** today${rare && !rare.done ? ' · 💠 a rare one is open' : ''}`;
}

export const quests: Command = {
  name: 'quests',
  group: 'you',
  data: new SlashCommandBuilder().setName('quests').setDescription('Your daily, weekly and rare quests, what they pay and your streak').toJSON(),
  text: { aliases: ['quest', 'q', 'mission', 'missions', 'dailies'] },
  run: (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Quests are per server.');
    return ctx.reply(questPage(store, ctx.guildId, ctx.userId));
  },
};

const shortDate = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

// every medal, how to earn it and how close you are, and the pick of which ones go on the profile card
// the medals someone has earned as one picture, opened from the Medals button under a profile card
export const medalcase: Command = {
  name: 'medalcase',
  group: 'you',
  hidden: true,
  data: new SlashCommandBuilder().setName('medalcase').setDescription('The medals someone has earned, as a picture')
    .addUserOption((o) => o.setName('user').setDescription('Whose, yours if empty')).toJSON(),
  text: { aliases: ['medalcard'], args: ['user'] },
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Medals are per server.');
    const id = ctx.user('user') ?? ctx.userId;
    const have = badgesOf(store, ctx.guildId, id);
    const at = earnedAt(store, ctx.guildId, id);
    const m = ctx.guild ? await ctx.guild.members.fetch(id).catch(() => null) : null;
    const order: Record<string, number> = { relic: 0, gold: 1, silver: 2, bronze: 3 };
    const medals = BADGES.filter((b) => have.includes(b.id)).sort((a, b) => order[tierOf(a.id)] - order[tierOf(b.id)])
      .map((b) => ({ id: b.id, name: b.name, when: at[b.id] ? shortDate(at[b.id]) : undefined }));
    const png = await medalCase({
      name: m?.displayName ?? 'Agent', handle: m?.user.username ?? id, accent: (await import('./profile.js')).picksOf(store, ctx.guildId, id).color ?? undefined,
      avatar: m ? await fetchAvatar(m.displayAvatarURL({ extension: 'png', forceStatic: true, size: 128 })) : null,
      medals, won: have.length, total: BADGES.length,
    });
    return ctx.reply({ files: [new AttachmentBuilder(png, { name: 'medals.png' })], embeds: [] });
  },
};

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
    // a couple of medal groups per page, the picture shows them all at once
    const pages: typeof fields[] = [[]];
    let size = 0;
    for (const f of fields) {
      if (size && size + f.value.length > 900) { pages.push([]); size = 0; }
      pages[pages.length - 1].push(f);
      size += f.value.length;
    }
    const n = Math.min(Math.max(0, ctx.int('page') ?? 0), pages.length - 1);
    const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
    const back = ctx.str('back') ? `,back=${ctx.str('back')}` : '';
    if (pages.length > 1) rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`nav|achievements|owner=${ctx.userId},user=${id},page=${n - 1}${back}`).setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(n === 0),
      new ButtonBuilder().setCustomId(`nav|achievements|owner=${ctx.userId},user=${id},page=${n + 1}${back}`).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(n >= pages.length - 1),
    ));
    const e = card({ kind: 'help', title: mine ? 'Your achievements' : `${member?.displayName ?? 'Their'} achievements`, emoji: '🎖️', gif: 'off', line: '',
      body: `**${have.length} of ${BADGES.length}** earned. Bronze, silver, gold, and purple relics for the rare ones.`, fields: pages[n] })
      .setImage('attachment://achievements.png');
    if (pages.length > 1) e.setFooter({ text: `Page ${n + 1} of ${pages.length}` });
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
