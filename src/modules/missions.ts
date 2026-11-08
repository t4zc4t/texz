import { SlashCommandBuilder } from 'discord.js';
import type { Store } from '../db.js';
import type { Command } from '../core/module.js';
import { card } from '../theme.js';

// one place every feature reports to: a daily Agency mission for the whole server, and badges that stay on your profile

export type Event = 'quote' | 'quizwin' | 'guesswin' | 'catch' | 'catchRare' | 'daily' | 'predict' | 'perfectPodium' | 'quoteOfWeek' | `catchType:${string}`;

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

interface Badge { id: string; emoji: string; name: string; event: Event; need: number }
export const BADGES: Badge[] = [
  { id: 'catch1', emoji: '🎣', name: 'First catch', event: 'catch', need: 1 },
  { id: 'catch100', emoji: '📕', name: '100 catches', event: 'catch', need: 100 },
  { id: 'catch1000', emoji: '🏛️', name: '1,000 catches', event: 'catch', need: 1000 },
  { id: 'legend', emoji: '🌟', name: 'Caught a legend', event: 'catchRare', need: 1 },
  { id: 'quiz10', emoji: '🧠', name: '10 quiz wins', event: 'quizwin', need: 10 },
  { id: 'quiz100', emoji: '🎓', name: '100 quiz wins', event: 'quizwin', need: 100 },
  { id: 'guess25', emoji: '🔎', name: '25 anime guessed', event: 'guesswin', need: 25 },
  { id: 'quote1', emoji: '🖼️', name: 'First quote', event: 'quote', need: 1 },
  { id: 'qotw', emoji: '🏆', name: 'Quote of the week', event: 'quoteOfWeek', need: 1 },
  { id: 'podium', emoji: '🔮', name: 'Perfect podium', event: 'perfectPodium', need: 1 },
  { id: 'daily30', emoji: '📅', name: '30 dailies', event: 'daily', need: 30 },
  { id: 'mission7', emoji: '🕵️', name: '7 day mission streak', event: 'missionStreak' as Event, need: 7 },
];

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
export function track(store: Store, guild: string | null, user: string, event: Event, by = 1): string[] {
  if (!guild) return [];
  const out: string[] = [];
  const total = count(store, `cnt:${guild}:${user}:${event}`, by);
  // badges
  const have = badgesOf(store, guild, user);
  for (const b of BADGES) {
    if (b.event === event && total >= b.need && !have.includes(b.id)) {
      have.push(b.id);
      out.push(`${b.emoji} <@${user}> earned the **${b.name}** badge!`);
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
        if (s.n >= 7 && !have.includes('mission7')) { have.push('mission7'); out.push(`🕵️ <@${user}> earned the **7 day mission streak** badge!`); }
      }
    }
  }
  store.setKv(`ach:${guild}:${user}`, JSON.stringify(have));
  return out;
}

export const mission: Command = {
  name: 'mission',
  group: 'fun',
  data: new SlashCommandBuilder().setName('mission').setDescription('Today\'s Agency mission and your badges').toJSON(),
  text: { aliases: ['missions', 'badges'] },
  run: (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Missions are per server.');
    const m = missionOf(ctx.guildId);
    const done = Number(store.getKv(`mission:${ctx.guildId}:${today()}:${ctx.userId}`) ?? 0);
    const s = JSON.parse(store.getKv(`mstreak:${ctx.guildId}:${ctx.userId}`) ?? '{"last":"","n":0}') as { last: string; n: number };
    const have = badgesOf(store, ctx.guildId, ctx.userId);
    const midnight = Math.floor(Date.parse(`${today()}T00:00:00Z`) / 1000) + 86_400;
    const e = card({ kind: 'help', title: 'Today\'s mission', emoji: '🕵️', gif: 'off', line: '',
      body: `**${m.text}**\n${done >= m.need ? '✅ done' : `${Math.min(done, m.need)}/${m.need}`} · pays ¥${PRIZE} plus ¥20 a day for a streak · new mission <t:${midnight}:R>${s.n ? `\n🔥 ${s.n} day streak` : ''}`,
      fields: [{ name: `🏅 Badges · ${have.length}/${BADGES.length}`, value: BADGES.map((b) => (have.includes(b.id) ? `${b.emoji} **${b.name}**` : `▫️ ${b.name}`)).join('\n'), inline: false }] });
    return ctx.reply({ embeds: [e] });
  },
};
