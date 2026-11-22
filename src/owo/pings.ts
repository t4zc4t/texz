import type { Client, Message, PartialMessage } from 'discord.js';
import type { Store } from '../db.js';
import { urgent } from '../reminders.js';
import { card } from '../theme.js';
import { OwoState } from './state.js';

// The OwO nudges: HuntBot is home, a new OwO day has started, and the captcha alarm.
// Each person picks what they want. Texz only ever tells you, it never runs anything for you.

export type PingKind = 'hb' | 'day' | 'captcha';
export const PINGS: Record<PingKind, { label: string; emoji: string; about: string; on: boolean }> = {
  hb: { label: 'HuntBot is back', emoji: '🤖', about: 'the moment your HuntBot run finishes', on: false },
  day: { label: 'New OwO day', emoji: '🌅', about: 'when daily, cookie and quests reset', on: false },
  // on unless switched off: a missed captcha can get an OwO account banned
  captcha: { label: 'Captcha alarm', emoji: '🚨', about: 'right away when OwO asks you for a captcha', on: true },
};

export function pingsOf(st: OwoState, userId: string): Record<PingKind, boolean> {
  const saved = (st.bits(userId).get('pings')?.value ?? {}) as Partial<Record<PingKind, boolean>>;
  return Object.fromEntries(Object.entries(PINGS).map(([k, v]) => [k, saved[k as PingKind] ?? v.on])) as Record<PingKind, boolean>;
}

export function setPing(store: Store, userId: string, kind: PingKind, on: boolean) {
  const st = new OwoState(store.db);
  st.setBit(userId, 'pings', { ...pingsOf(st, userId), [kind]: on });
  if (!on) store.db.prepare('DELETE FROM reminders WHERE user_id = ? AND kind = ?').run(userId, `owo:${kind}`);
  else syncPings(store, userId, null);
}

// OwO's day turns over at midnight in Los Angeles, whatever the season
export function nextOwoDay(now = Date.now()) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  const p = Object.fromEntries(f.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const sinceMidnight = ((Number(p.hour) * 60 + Number(p.minute)) * 60 + Number(p.second)) * 1000;
  let at = now - sinceMidnight + 86_400_000;
  // a clock change in between moves midnight by an hour, step to the real one
  const hourThen = Number(Object.fromEntries(f.formatToParts(new Date(at)).map((x) => [x.type, x.value])).hour);
  if (hourThen === 23) at += 3_600_000;
  else if (hourThen === 1) at -= 3_600_000;
  return Math.floor(at / 1000) * 1000 + 60_000; // a minute late so OwO has really reset
}

// the collectibles someone keeps up, as the commands to type, for the new-day ping
function dailies(st: OwoState, userId: string) {
  const known = ['alastor', 'babyyoda', 'run', 'piku', 'puppy'];
  return [...st.bits(userId).keys()].map((k) => k.split(':')).filter(([kind, g]) => (kind === 'pet' || kind === 'game') && known.includes(g)).map(([, g]) => `\`w ${g}\``).join(' · ');
}

// keep the queued reminders in line with what Texz knows: HuntBot's return time and the next OwO day
export function syncPings(store: Store, userId: string, channelId: string | null, now = Date.now()) {
  const st = new OwoState(store.db);
  const want = pingsOf(st, userId);
  const hb = st.huntbot(userId);
  const queued = store.reminderOf(userId, 'owo:hb');
  if (want.hb && hb?.backAt && hb.backAt > now) {
    if (!queued || Math.abs(queued.due_at - hb.backAt) > 60_000) store.setReminder(userId, 'owo:hb', new Date(hb.backAt), '', channelId ?? queued?.channel_id ?? null);
  } else if (queued && !(hb?.backAt && hb.backAt > now)) store.deleteReminder(queued.id);
  if (want.day && !store.reminderOf(userId, 'owo:day')) store.setReminder(userId, 'owo:day', new Date(nextOwoDay(now)), dailies(st, userId), channelId ?? store.lastChannel(userId));
}

// every opted-in person gets their next OwO day queued again after the last one went out
export function rearmDays(store: Store) {
  const rows = store.db.prepare("SELECT user_id, value FROM owo_bits WHERE what = 'pings'").all() as { user_id: string; value: string }[];
  for (const r of rows) {
    const p = JSON.parse(r.value) as Partial<Record<PingKind, boolean>>;
    if (p.day && !store.reminderOf(r.user_id, 'owo:day')) store.setReminder(r.user_id, 'owo:day', new Date(nextOwoDay()), dailies(new OwoState(store.db), r.user_id), store.lastChannel(r.user_id));
  }
}

const alarmed = new Map<string, number>();

// OwO gives about ten minutes, so this skips quiet hours and goes by DM first
export async function captchaAlarm(client: Client, store: Store, m: Message | PartialMessage, userId: string, strike: number | null) {
  const st = new OwoState(store.db);
  if (!pingsOf(st, userId).captcha) return;
  if (Date.now() - (alarmed.get(userId) ?? 0) < 10 * 60_000) return;
  alarmed.set(userId, Date.now());
  const where = m.guildId ? `https://discord.com/channels/${m.guildId}/${m.channelId}/${m.id}` : '';
  const body = card({
    kind: 'custom', title: 'OwO wants a captcha', emoji: '🚨', gif: 'off', line: '',
    body: `Solve it within about **10 minutes** or OwO can ban your account.${strike ? `\nThis is warning **${strike}/5**.` : ''}${where ? `\n[Jump to it](${where})` : ''}\n-# I never touch captchas, it has to be you. \`tz o pings\` to change this.`,
  });
  await urgent(client, store, userId, m.channelId, body);
}
