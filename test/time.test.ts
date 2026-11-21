import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterQuiet, fmtLeft, zonedTime } from '../src/time.ts';

test('wall clock time in a zone', () => {
  // midnight in los angeles during PST is 08:00 UTC
  assert.equal(zonedTime('America/Los_Angeles', 2026, 11, 2).toISOString(), '2026-11-02T08:00:00.000Z');
  assert.equal(zonedTime('America/Los_Angeles', 2026, 7, 11).toISOString(), '2026-07-11T07:00:00.000Z');
});

test('quiet hours push reminders to the end', () => {
  const at = new Date('2026-11-01T20:00:00Z'); // 01:30 IST
  const out = afterQuiet(at, 'Asia/Kolkata', '00:30-07:30');
  assert.equal(out.toISOString(), '2026-11-02T02:00:00.000Z');
  assert.equal(afterQuiet(at, 'Asia/Kolkata', null), at);
  assert.equal(fmtLeft(2 * 3600_000 + 33 * 60_000), '2h 33m');
});
