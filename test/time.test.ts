import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextReset, lastReset, owoDay, afterQuiet, fmtLeft } from '../src/time.ts';
import { Store } from '../src/db.ts';
import { scheduleDailies } from '../src/reminders.ts';
import { dayStatus } from '../src/features/daily.ts';

test('reset is midnight in los angeles', () => {
  // 2 Nov 2026 07:40 IST, PST is in effect so midnight there is 08:00 UTC
  const now = new Date('2026-11-02T02:10:00Z');
  assert.equal(nextReset(now).toISOString(), '2026-11-02T08:00:00.000Z');
  assert.equal(lastReset(now).toISOString(), '2026-11-01T07:00:00.000Z');
  assert.equal(owoDay(now), '2026-11-01');
  // summer time, midnight PDT is 07:00 UTC
  assert.equal(nextReset(new Date('2026-07-10T12:00:00Z')).toISOString(), '2026-07-11T07:00:00.000Z');
});

test('quiet hours push reminders to the end', () => {
  const at = new Date('2026-11-01T20:00:00Z'); // 01:30 IST
  const out = afterQuiet(at, 'Asia/Kolkata', '00:30-07:30');
  assert.equal(out.toISOString(), '2026-11-02T02:00:00.000Z');
  assert.equal(afterQuiet(at, 'Asia/Kolkata', null), at);
  assert.equal(fmtLeft(2 * 3600_000 + 33 * 60_000), '2h 33m');
});

test('daily reminders get queued once', () => {
  const store = new Store(':memory:');
  store.touch('u1', 'c1');
  scheduleDailies(store, 'u1', new Date('2026-11-02T02:10:00Z'));
  scheduleDailies(store, 'u1', new Date('2026-11-02T02:10:00Z'));
  const kinds = store.userReminders('u1').map((r) => r.kind).sort();
  assert.deepEqual(kinds, ['lastcall', 'reset']);
  const day = owoDay();
  store.markDone('u1', day, 'daily');
  store.markDone('u1', day, 'piku');
  const st = dayStatus(store, 'u1');
  assert.ok(st.find((i) => i.what === 'daily')?.done);
  assert.ok(st.find((i) => i.what === 'piku'));
  assert.ok(!st.find((i) => i.what === 'run'));
});
