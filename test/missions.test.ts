import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/db.ts';
import { badgesOf, dailiesOf, weekliesOf, track, questPage } from '../src/modules/missions.ts';

test('badges come once and each daily quest pays out once', () => {
  const store = new Store(':memory:');
  const first = track(store, 'g1', 'u1', 'catch');
  assert.ok(first.some((l) => l.includes('First catch')));
  assert.equal(track(store, 'g1', 'u1', 'catch').some((l) => l.includes('First catch')), false);
  assert.ok(badgesOf(store, 'g1', 'u1').includes('catch1'));
  const [q] = dailiesOf('g1', 'u2');
  let done: string[] = [];
  for (let n = 0; n < q.need + 2; n++) done = done.concat(track(store, 'g1', 'u2', q.event as never));
  assert.equal(done.filter((l) => l.includes('finished a daily quest')).length, 1);
});

test('three different dailies and two weeklies, and clearing the dailies pays a bonus', () => {
  const store = new Store(':memory:');
  const d = dailiesOf('g', 'u');
  assert.equal(new Set(d.map((q) => q.id)).size, 3);
  assert.equal(weekliesOf('g', 'u').length, 2);
  let lines: string[] = [];
  for (const q of d) for (let n = 0; n < q.need; n++) lines = lines.concat(track(store, 'g', 'u', q.event as never));
  assert.equal(lines.filter((l) => l.includes('cleared all three dailies')).length, 1);
  assert.ok(questPage(store, 'g', 'u').embeds.length === 1);
});
