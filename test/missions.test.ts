import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/db.ts';
import { badgesOf, missionOf, track } from '../src/modules/missions.ts';

test('badges come once and the daily mission pays out once', () => {
  const store = new Store(':memory:');
  const first = track(store, 'g1', 'u1', 'catch');
  assert.ok(first.some((l) => l.includes('First catch')));
  assert.equal(track(store, 'g1', 'u1', 'catch').some((l) => l.includes('First catch')), false);
  assert.ok(badgesOf(store, 'g1', 'u1').includes('catch1'));
  const m = missionOf('g1');
  let done: string[] = [];
  for (let n = 0; n < m.need + 2; n++) done = done.concat(track(store, 'g1', 'u2', m.event));
  assert.equal(done.filter((l) => l.includes('mission')).length, 1);
});
