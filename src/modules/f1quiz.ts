import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Interaction, type MessageActionRowComponentBuilder } from 'discord.js';
import type { Store } from '../db.js';
import { card, say } from '../theme.js';
import { quiz, siteLink, type QuizQ } from '../feeds/f1.js';

const RED = 0xe10600;
const PAY: Record<string, number> = { easy: 20, medium: 35, hard: 60 };
const payFor = (q: QuizQ) => PAY[q.difficulty] ?? 30;
const row = (...b: ButtonBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...b);

export const quizButton = () => new ButtonBuilder().setCustomId('f1q|new').setLabel('Quiz me').setEmoji('🏁').setStyle(ButtonStyle.Secondary);

// one question per channel, the first right answer wins, a wrong answer sits you out for that question
const live = new Map<string, { q: QuizQ; ends: number; done: boolean; out: Set<string>; recent: string[] }>();
const recentOf = new Map<string, string[]>();

export async function quizRound(channelId: string, economy: boolean, difficulty?: string) {
  const cur = live.get(channelId);
  if (cur && !cur.done && cur.ends > Date.now()) return { busy: true as const };
  const all = (await quiz()).questions;
  const recent = recentOf.get(channelId) ?? [];
  const pool = all.filter((q) => !recent.includes(q.id) && (!difficulty || q.difficulty === difficulty));
  const q = (pool.length ? pool : all)[Math.floor(Math.random() * (pool.length || all.length))];
  recentOf.set(channelId, [...recent, q.id].slice(-60));
  live.set(channelId, { q, ends: Date.now() + 20_000, done: false, out: new Set(), recent });
  const dots: Record<string, string> = { easy: '🟢', medium: '🟡', hard: '🔴' };
  const e = card({
    kind: 'f1Quiz', title: q.q, emoji: '🏁', color: RED, gif: 'off',
    body: `${dots[q.difficulty] ?? '⚪'} ${q.difficulty} · ${q.category}\n20 seconds, one try each. First right answer${economy ? ` gets **¥${payFor(q)}**` : ' wins'}.`,
  });
  const letters = ['A', 'B', 'C', 'D'];
  const buttons = row(...q.options.slice(0, 4).map((o, i) => new ButtonBuilder().setCustomId(`f1q|${channelId}|${i}`).setLabel(`${letters[i]}. ${o}`.slice(0, 80)).setStyle(ButtonStyle.Secondary)));
  return { busy: false as const, embeds: [e], components: [buttons] };
}

function reveal(q: QuizQ, winner?: string, paid?: number) {
  return card({
    kind: 'f1Quiz', title: `Answer: ${q.options[q.answer]}`, emoji: winner ? '🏆' : '⏱️', color: RED, gif: 'off',
    body: `${winner ? `<@${winner}> got it${paid ? ` · +¥${paid}` : ''}. ${say('f1QuizWin')}` : 'Nobody got it this time.'}\n\n${q.explain.slice(0, 700)}`,
  });
}

const doneRow = (q: QuizQ) => row(quizButton().setLabel('Next question'), new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(siteLink(q.link)).setLabel('Parc Fermé'));

export async function onF1Quiz(store: Store, i: Interaction) {
  if (!i.isButton() || !i.customId.startsWith('f1q|')) return false;
  const parts = i.customId.split('|');
  const economy = !!i.guildId && store.rules(i.guildId, 'economy').enabled;
  if (parts[1] === 'new') {
    const r = await quizRound(i.channelId, economy).catch(() => null);
    if (!r) await i.reply({ content: 'Parc Fermé didn\'t answer, try again in a moment.', flags: 64 });
    else if (r.busy) await i.reply({ content: 'A question is already running here, answer that one first.', flags: 64 });
    else await i.reply({ embeds: r.embeds, components: r.components });
    return true;
  }
  const [, ch, pick] = parts;
  const r = live.get(ch);
  const lock = (win: number | null) => i.message.components.map((c) => {
    const j = c.toJSON() as { components: { disabled?: boolean; style?: number; custom_id?: string }[] };
    for (const b of j.components) { b.disabled = true; if (win !== null && b.custom_id === `f1q|${ch}|${win}`) b.style = ButtonStyle.Success; }
    return j;
  });
  if (!r || r.done || r.ends < Date.now()) {
    if (r && !r.done) {
      r.done = true;
      await i.update({ components: lock(r.q.answer) as never });
      await i.followUp({ embeds: [reveal(r.q)], components: [doneRow(r.q)] });
    } else await i.reply({ content: 'This question is over.', flags: 64 });
    return true;
  }
  if (r.out.has(i.user.id)) { await i.reply({ content: 'You already had your try on this one.', flags: 64 }); return true; }
  if (Number(pick) !== r.q.answer) { r.out.add(i.user.id); await i.reply({ content: '❌ Not that one. You\'re out for this question.', flags: 64 }); return true; }
  r.done = true;
  if (i.guildId) addWin(store, i.guildId, i.user.id);
  const amount = payFor(r.q);
  const paid = economy && store.pay(i.guildId!, i.user.id, amount) ? amount : 0;
  await i.update({ components: lock(r.q.answer) as never });
  await i.followUp({ embeds: [reveal(r.q, i.user.id, paid)], components: [doneRow(r.q)], allowedMentions: { users: [i.user.id] } });
  return true;
}

// nobody answered: close it out so the channel sees the answer
export function sweepQuiz(send: (channelId: string, payload: object) => Promise<unknown>) {
  setInterval(() => {
    for (const [ch, r] of live) {
      if (r.done || r.ends > Date.now() - 2_000) continue;
      r.done = true;
      void send(ch, { embeds: [reveal(r.q)], components: [doneRow(r.q)] }).catch(() => {});
    }
  }, 5_000).unref?.();
}

// right answers in the quiz and the guess game, shown on the fun dashboard
export function addWin(store: Store, guildId: string, userId: string) {
  const key = `wins:${guildId}:${userId}`;
  store.setKv(key, String(Number(store.getKv(key) ?? 0) + 1));
}
export const winsOf = (store: Store, guildId: string, userId: string) => Number(store.getKv(`wins:${guildId}:${userId}`) ?? 0);
