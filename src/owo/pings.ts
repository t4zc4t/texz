import type { Client, Message, PartialMessage } from 'discord.js';
import type { Store } from '../db.js';
import { sendNow, urgent } from '../reminders.js';
import { card } from '../theme.js';
import { OwoState } from './state.js';

// The OwO nudges: HuntBot is home, a new OwO day has started, and the captcha alarm.
// Each person picks what they want. Texz only ever tells you, it never runs anything for you.

export type PingKind = 'hunt' | 'pray' | 'hb' | 'day' | 'shop' | 'gems' | 'captcha';
export const PINGS: Record<PingKind, { label: string; emoji: string; about: string; on: boolean }> = {
  hunt: { label: 'Hunt ready', emoji: '🏹', about: 'hunt and battle are off cooldown, 15 seconds after your last one', on: false },
  pray: { label: 'Pray ready', emoji: '🙏', about: 'pray and curse are off cooldown, 5 minutes after the last one', on: false },
  hb: { label: 'HuntBot is back', emoji: '🤖', about: 'the moment your HuntBot run finishes', on: false },
  day: { label: 'New OwO day', emoji: '🌅', about: 'when daily, cookie and quests reset', on: false },
  shop: { label: 'Shop upgrade', emoji: '🛒', about: 'the weapon shop has a better copy of a weapon you use', on: false },
  gems: { label: 'Gem running out', emoji: '💎', about: 'a gem has 3 hunts or less left', on: false },
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

// hunt, battle, pray and curse: cooldowns too short for the reminder queue, so a timer each,
// pushed back every time the command is used again so the ping only comes once you've stopped
const timers = new Map<string, NodeJS.Timeout>();
export const COOLDOWN = { hunt: 15_000, pray: 300_000 } as const;
export function cooldownPing(client: Client, store: Store, userId: string, kind: 'hunt' | 'pray', at: number, channelId: string) {
  if (!pingsOf(new OwoState(store.db), userId)[kind]) return;
  const key = `${userId}:${kind}`;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    void sendNow(client, store, { id: 0, user_id: userId, kind: `owo:${kind}`, note: '', due_at: at, channel_id: channelId }).catch(() => {});
  }, Math.max(1000, at - Date.now())));
}

// the old reminder switches carry over once: whoever had hunt or pray reminders before keeps them
export function carryOldSwitches(store: Store) {
  if (store.getKv('owo:pings:carried')) return;
  const st = new OwoState(store.db);
  for (const r of store.db.prepare('SELECT id, settings FROM users').all() as { id: string; settings: string }[]) {
    const old = JSON.parse(r.settings || '{}') as { huntbattle?: boolean; pray?: boolean };
    if (!old.huntbattle && !old.pray) continue;
    st.setBit(r.id, 'pings', { ...pingsOf(st, r.id), hunt: !!old.huntbattle, pray: !!old.pray });
  }
  store.setKv('owo:pings:carried', String(Date.now()));
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

// the weapon shop is the same for everyone each day: whoever flips a page, everyone with that weapon type
// on a pet and a worse copy hears about it once
export function shopAlert(store: Store, w: { shopId: number | null; name: string; quality: number | null; wear: string | null; price: number | null }, channelId: string) {
  if (!w.shopId || w.quality === null) return;
  const st = new OwoState(store.db);
  const day = new Date(nextOwoDay() - 86_400_000).toISOString().slice(0, 10);
  const users = store.db.prepare("SELECT DISTINCT user_id FROM owo_weapons WHERE name = ? AND on_animal IS NOT NULL").all(w.name) as { user_id: string }[];
  for (const { user_id: u } of users) {
    if (!pingsOf(st, u).shop) continue;
    const best = Math.max(...st.weapons(u).filter((x) => x.name === w.name).map((x) => x.quality ?? 0));
    if (w.quality < best + 3) continue;
    const key = `shopalert:${u}:${day}:${w.shopId}`;
    if (store.getKv(key)) continue;
    store.setKv(key, '1');
    store.setReminder(u, `owo:shop:${w.shopId}`, new Date(), `**${w.name}** ${w.quality}%${w.wear && w.wear !== 'worn' ? ` ${w.wear}` : ''} in today's shop · yours ${best}% · shop ID \`${w.shopId}\`${w.price ? ` · ${w.price.toLocaleString()} shards` : ''}`, channelId);
  }
}

// a reply under the hunt when a gem is nearly gone, once per gem
export async function gemWarning(store: Store, m: Message | PartialMessage, userId: string, gems: { gem: string; left: number; of: number }[], perHuntOf: (gem: string) => number) {
  const st = new OwoState(store.db);
  if (!pingsOf(st, userId).gems || !m.channel?.isSendable()) return;
  const low = gems.filter((g) => g.left > 0 && g.left / Math.max(1, perHuntOf(g.gem)) <= 3);
  const gone = gems.filter((g) => g.left === 0);
  for (const g of [...low, ...gone]) {
    const key = `gemwarn:${userId}:${g.gem}:${new Date().toISOString().slice(0, 10)}:${g.left === 0 ? 'out' : 'low'}`;
    if (store.getKv(key)) continue;
    store.setKv(key, String(Date.now()));
    await m.channel.send({ content: `💎 <@${userId}> **${g.gem}** ${g.left === 0 ? 'ran out' : `is almost out (${g.left}/${g.of})`} · \`tz o gems\``, allowedMentions: { users: [userId] } }).catch(() => {});
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
    body: `Solve it within **10 minutes**.${strike ? ` Warning **${strike}/5**.` : ''}${where ? `\n[Jump to it](${where})` : ''}`,
  });
  await urgent(client, store, userId, m.channelId, body);
}
