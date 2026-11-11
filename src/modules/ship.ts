import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder, type Interaction, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Command } from '../core/module.js';
import { card } from '../theme.js';

const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);

// the case file questions, each answer has a small "near miss" partner that still counts for half
interface Q { topic: string; emoji: string; ask: string; options: string[]; near?: [number, number][] }
const QUESTIONS: Q[] = [
  { topic: 'Mornings', emoji: '🌙', ask: 'It\'s 2am. Where are you?', options: ['Asleep, obviously', 'Gaming', 'Deep in a show', 'Overthinking life'], near: [[1, 2]] },
  { topic: 'Food', emoji: '🍜', ask: 'Pick a late night meal', options: ['Ramen', 'Pizza', 'Biryani', 'Whatever is in the fridge'], near: [[0, 2]] },
  { topic: 'Weekends', emoji: '🗺️', ask: 'Perfect free day?', options: ['Bed all day', 'Out with friends', 'A trip somewhere new', 'Gaming marathon'], near: [[0, 3], [1, 2]] },
  { topic: 'Arguments', emoji: '⚔️', ask: 'Mid argument, you...', options: ['Go quiet', 'Talk it out right now', 'Make a joke', 'Need to win'], near: [[1, 2]] },
  { topic: 'Texting', emoji: '💬', ask: 'How fast do you reply?', options: ['Instantly', 'Within the hour', 'Whenever I see it', 'Leave it on read'], near: [[0, 1], [2, 3]] },
  { topic: 'Money', emoji: '💸', ask: 'Unexpected 5000 rupees. You...', options: ['Save it', 'Treat everyone', 'Buy that thing I wanted', 'Spend it on food'], near: [[1, 3]] },
  { topic: 'Movies', emoji: '🎬', ask: 'Movie night pick?', options: ['Anime', 'Horror', 'Comedy', 'Something that makes me cry'], near: [[0, 3]] },
  { topic: 'Trouble', emoji: '🕵️', ask: 'Your friend is in trouble. You...', options: ['Show up instantly', 'Send a long message', 'Make a plan', 'Call someone smarter'], near: [[0, 2]] },
];

interface Session { id: string; a: string; b: string; answers: Record<string, number[]>; channel: string; message?: string; at: number }
const sessions = new Map<string, Session>();

// the same pair always gets the same little nudge, so nobody can reroll fate
export function shipScore(a: string, b: string) {
  const [x, y] = [a, b].sort();
  let h = 7;
  for (const ch of `${x}:${y}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 101;
}

// how alike two sets of answers are, 0 to 100
export function compare(qa: number[], qb: number[]) {
  const per = QUESTIONS.map((q, i) => {
    if (qa[i] === qb[i]) return 1;
    return (q.near ?? []).some(([x, y]) => (qa[i] === x && qb[i] === y) || (qa[i] === y && qb[i] === x)) ? 0.5 : 0;
  });
  return { per, score: Math.round((per.reduce((s: number, v) => s + v, 0) / QUESTIONS.length) * 100) };
}

const titles: Record<string, string> = {
  Mornings: 'The 2am Club', Food: 'The Midnight Snack Duo', Weekends: 'Partners in Free Time', Arguments: 'The Peace Treaty',
  Texting: 'Always on Read Receipts', Money: 'The Joint Account', Movies: 'Movie Night Royalty', Trouble: 'The Rescue Squad',
};

function verdict(n: number) {
  if (n >= 90) return ['Soulmates on paper', 'The Agency has closed this case. You two are an open and shut match, it\'s almost suspicious.'];
  if (n >= 75) return ['A dangerous duo', 'Different enough to stay interesting, alike enough to finish each other\'s snacks. I approve.'];
  if (n >= 55) return ['Promising suspects', 'There\'s something here. A few clashes, but the good kind, the kind that makes a story.'];
  if (n >= 35) return ['Chaotic but fun', 'Like Chuuya and me. Loud, stubborn, and somehow it still works when it matters.'];
  return ['An unsolved mystery', 'Even I can\'t deduce how this works. Which is exactly why you should find out.'];
}

const id = (s: Session, action: string, arg = '') => `shp|${s.id}|${action}|${arg}`;

function lobby(s: Session) {
  const done = (u: string) => (s.answers[u]?.length === QUESTIONS.length ? '✅ answered' : s.answers[u]?.length ? `✍️ ${s.answers[u].length}/${QUESTIONS.length}` : '⏳ waiting');
  const e = card({
    kind: 'ship', title: 'Compatibility case file', emoji: '💞', gif: 'off',
    body: `<@${s.a}> × <@${s.b}>\n\n${QUESTIONS.length} questions each, answered in private. Nobody sees anything until both are done.\n\n<@${s.a}> · ${done(s.a)}\n<@${s.b}> · ${done(s.b)}`,
  });
  return { embeds: [e], components: [row(new ButtonBuilder().setCustomId(id(s, 'start')).setLabel('Answer my questions').setEmoji('📝').setStyle(ButtonStyle.Primary))] };
}

function question(s: Session, user: string) {
  const n = s.answers[user]?.length ?? 0;
  const q = QUESTIONS[n];
  const e = card({ kind: 'ship', title: `${q.emoji} ${q.ask}`, emoji: '', gif: 'off', body: `Question ${n + 1} of ${QUESTIONS.length} · ${q.topic}` });
  return { embeds: [e], components: [row(...q.options.map((o, i) => new ButtonBuilder().setCustomId(id(s, 'pick', String(i))).setLabel(o.slice(0, 80)).setStyle(ButtonStyle.Secondary)))] };
}

function result(s: Session) {
  const qa = s.answers[s.a];
  const qb = s.answers[s.b];
  const { per, score } = compare(qa, qb);
  // mostly the answers, a pinch of fate
  const n = Math.min(100, Math.round(score * 0.85 + shipScore(s.a, s.b) * 0.15));
  const [label, line] = verdict(n);
  const best = QUESTIONS.filter((_, i) => per[i] === 1);
  const title = best.length ? titles[best[Math.floor(shipScore(s.a, s.b) / 101 * best.length)].topic] : 'Opposites, Attracting';
  const filled = Math.round(n / 10);
  const lines = QUESTIONS.map((q, i) => `${per[i] === 1 ? '💚' : per[i] === 0.5 ? '💛' : '💔'} ${q.emoji} **${q.topic}** · ${q.options[qa[i]]} / ${q.options[qb[i]]}`);
  const matched = per.filter((v) => v === 1).length;
  const e = card({
    kind: 'ship', title: `${label} · ${n}%`, emoji: '💞', gif: 'off',
    body: `<@${s.a}> × <@${s.b}>\n${'❤️'.repeat(filled)}${'🖤'.repeat(10 - filled)}\n\n> *${line}*\n\n${lines.join('\n')}`,
    fields: [
      { name: '🏷️ Couple name', value: title, inline: true },
      { name: '🎯 Same answers', value: `${matched} of ${QUESTIONS.length}`, inline: true },
      { name: '🔎 Closest on', value: best.slice(0, 3).map((q) => q.topic).join(', ') || 'nothing yet, plenty to discover', inline: true },
    ],
  });
  return { embeds: [e], components: [row(new ButtonBuilder().setCustomId(id(s, 'again')).setLabel('Retake together').setEmoji('🔁').setStyle(ButtonStyle.Secondary))] };
}

export async function onShip(i: Interaction): Promise<boolean> {
  if (!i.isButton() || !i.customId.startsWith('shp|')) return false;
  const [, sid, action, arg] = i.customId.split('|');
  const s = sessions.get(sid);
  if (!s) { await i.reply({ content: 'This case file expired. Start a new one with `tz ship @someone`.', flags: MessageFlags.Ephemeral }); return true; }
  const me = i.user.id;
  if (me !== s.a && me !== s.b) { await i.reply({ content: 'Only the two people in this file can answer. Start your own with `tz ship @someone`.', flags: MessageFlags.Ephemeral }); return true; }
  if (action === 'again') {
    s.answers = {};
    s.at = Date.now();
    await i.update(lobby(s));
    return true;
  }
  if (action === 'start') {
    if (s.answers[me]?.length === QUESTIONS.length) { await i.reply({ content: 'You\'re done, waiting on the other one. No peeking.', flags: MessageFlags.Ephemeral }); return true; }
    await i.reply({ ...question(s, me), flags: MessageFlags.Ephemeral });
    return true;
  }
  if (action === 'pick') {
    const list = (s.answers[me] ??= []);
    if (list.length >= QUESTIONS.length) { await i.update({ content: 'All answered.', embeds: [], components: [] }); return true; }
    list.push(Number(arg));
    if (list.length < QUESTIONS.length) { await i.update(question(s, me)); return true; }
    const bothDone = s.answers[s.a]?.length === QUESTIONS.length && s.answers[s.b]?.length === QUESTIONS.length;
    await i.update({ content: bothDone ? '🗂️ Both files are in. The verdict is posted.' : '🗂️ Your answers are sealed. Waiting on the other one.', embeds: [], components: [] });
    // the public message flips to the verdict once both are in
    const ch = i.channel;
    const msg = s.message && ch && 'messages' in ch ? await ch.messages.fetch(s.message).catch(() => null) : null;
    if (msg) await msg.edit(bothDone ? result(s) : lobby(s)).catch(() => {});
    return true;
  }
  return true;
}

export const ship: Command = {
  name: 'ship',
  group: 'games',
  data: new SlashCommandBuilder().setName('ship').setDescription('A compatibility case file: both answer questions, then the verdict')
    .addUserOption((o) => o.setName('user').setDescription('Who to test with').setRequired(true))
    .addUserOption((o) => o.setName('other').setDescription('Test two other people instead of you')).toJSON(),
  text: { aliases: ['match', 'compat'], args: ['user', 'other'] },
  run: async (ctx) => {
    const a = ctx.user('other') ? ctx.user('user') : ctx.userId;
    const b = ctx.user('other') ?? ctx.user('user');
    if (!a || !b) return ctx.reply('Who? `tz ship @someone`');
    if (a === b) return ctx.reply({ content: '💞 Loving yourself, 100%. Healthy. Case closed.', temp: true });
    // old files tidy themselves away after an hour
    for (const [k, v] of sessions) if (Date.now() - v.at > 3_600_000) sessions.delete(k);
    const s: Session = { id: Math.random().toString(36).slice(2, 10), a, b, answers: {}, channel: ctx.channelId, at: Date.now() };
    sessions.set(s.id, s);
    const sent = await ctx.reply({ ...lobby(s), content: `<@${a}> <@${b}>`, ping: [a, b], public: true }) as { id?: string; resource?: { message?: { id: string } } } | undefined;
    s.message = sent?.resource?.message?.id ?? sent?.id;
  },
};
