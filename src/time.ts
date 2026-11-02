// OwO resets dailies, quests, cookies and the patreon minigames at midnight PST
export const OWO_TZ = 'America/Los_Angeles';

const MIN = 60_000;
export const HOUR = 60 * MIN;

function offsetMinutes(tz: string, at: Date): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!m) return 0;
  const mins = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === '-' ? -mins : mins;
}

function partsIn(tz: string, at: Date) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute') };
}

// UTC time of a wall-clock moment in a timezone
export function zonedTime(tz: string, y: number, mo: number, d: number, h = 0, mi = 0): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - offsetMinutes(tz, new Date(guess)) * MIN;
  // second pass handles the day DST flips
  t = guess - offsetMinutes(tz, new Date(t)) * MIN;
  return new Date(t);
}

export function nextReset(now = new Date()): Date {
  const { y, mo, d } = partsIn(OWO_TZ, now);
  return zonedTime(OWO_TZ, y, mo, d + 1);
}

export function lastReset(now = new Date()): Date {
  const { y, mo, d } = partsIn(OWO_TZ, now);
  return zonedTime(OWO_TZ, y, mo, d);
}

// key for "today" in OwO's calendar, used to tick off daily things
export function owoDay(now = new Date()): string {
  const { y, mo, d } = partsIn(OWO_TZ, now);
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// minutes since midnight in the user's own timezone
export function localMinutes(tz: string, at: Date): number {
  const { h, mi } = partsIn(tz, at);
  return h * 60 + mi;
}

// pushes a time out of quiet hours, quiet given as "HH:MM-HH:MM" in the user's timezone
export function afterQuiet(at: Date, tz: string, quiet: string | null): Date {
  if (!quiet) return at;
  const m = quiet.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!m) return at;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  const now = localMinutes(tz, at);
  const inside = start <= end ? now >= start && now < end : now >= start || now < end;
  if (!inside) return at;
  const wait = (end - now + 1440) % 1440;
  return new Date(at.getTime() + wait * MIN);
}

export function fmtLeft(ms: number): string {
  if (ms <= 0) return 'now';
  const total = Math.round(ms / MIN);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export const unix = (d: Date) => Math.floor(d.getTime() / 1000);
