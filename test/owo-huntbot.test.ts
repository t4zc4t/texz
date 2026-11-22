import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advise, huntHours, levelCost, sellPlan, statOf } from '../src/owo/huntbot.ts';

const H = 3_600_000;
const now = Date.parse('2026-11-22T00:00:00Z');
const every = (hours: number, n = 40) => Array.from({ length: n }, (_, i) => now - (n - 1 - i) * hours * H);
const lv = { efficiency: 55, duration: 65, cost: 4, gain: 44, experience: 34, radar: 8 };

test('level costs and stats match a real HuntBot card', () => {
  assert.equal(levelCost('efficiency', 55), 11371);
  assert.equal(levelCost('duration', 65), 12394);
  assert.equal(levelCost('cost', 4), 237956);
  assert.equal(levelCost('gain', 44), 9457);
  assert.equal(levelCost('experience', 34), 6016);
  assert.equal(statOf('efficiency', 55), 80);
  assert.ok(Math.abs(statOf('duration', 65) - 7) < 1e-9);
  assert.equal(statOf('cost', 4), 6);
  assert.equal(statOf('gain', 44), 1100);
});

test('a run longer than the gap between check-ins hunts less, not more', () => {
  const checks = every(6);
  assert.ok(huntHours(checks, 6.1)!.perDay < huntHours(checks, 6)!.perDay);
  const p = advise({ levels: { ...lv, duration: 55 }, essence: 50_000, cash: null, checks, now });
  assert.ok(!p.ranked.some((r) => r.trait === 'duration'));
  assert.match(p.skip.find((s) => s.trait === 'duration')!.why, /less/);
  assert.ok(!p.spend.some((s) => s.trait === 'duration'));
});

test('duration counts when check-ins are far apart, radar never does', () => {
  const p = advise({ levels: lv, essence: 0, cash: null, checks: every(12), now });
  assert.ok(p.ranked.some((r) => r.trait === 'duration'));
  assert.ok(p.skip.some((s) => s.trait === 'radar'));
  assert.ok(!p.ranked.some((r) => r.trait === 'radar'));
});

test('short on cowoncy: efficiency and duration are a trap', () => {
  const p = advise({ levels: lv, essence: 30_000, cash: 1000, checks: every(12), now });
  assert.ok(p.cashShort);
  assert.ok(!p.ranked.some((r) => r.trait === 'efficiency' || r.trait === 'duration'));
  assert.ok(!p.spend.some((s) => s.trait === 'efficiency' || s.trait === 'duration'));
});

test('essence goes to the best trait even when a worse one is cheaper', () => {
  const p = advise({ levels: lv, essence: 9000, cash: null, checks: every(8), now });
  assert.equal(p.spend.length, 1);
  assert.equal(p.spend[0].trait, p.ranked[0].trait);
  assert.equal(p.left, 0);
});

test('sell plan raises run money from the best cowoncy-per-essence ranks and keeps team pets', () => {
  const hold = [
    { rank: 'common', count: 300, animals: [{ animal: 'bee', count: 300 }] },
    { rank: 'rare', count: 40, animals: [{ animal: 'owl', count: 39 }, { animal: 'fox', count: 1 }] },
    { rank: 'mythic', count: 1, animals: [{ animal: 'dragon', count: 1 }] },
    { rank: 'gem', count: 3, animals: [{ animal: 'gemx', count: 3 }] },
  ];
  const p = sellPlan(hold, 0, 3360, new Set(['fox']));
  assert.deepEqual(p.sell.map((s) => s.rank), ['mythic']);
  assert.ok(p.sacrifice.every((s) => s.rank !== 'gem' && s.rank !== 'mythic'));
  const rare = p.sacrifice.find((s) => s.rank === 'rare')!;
  assert.equal(rare.count, 39);
  assert.deepEqual(rare.only, [{ animal: 'owl', count: 39 }]);
  assert.deepEqual(p.keep, ['fox']);
  assert.equal(sellPlan(hold, 1_000_000, 3360, new Set()).sell.length, 0);
});

import { nextOwoDay } from '../src/owo/pings.ts';

test('the OwO day turns over at midnight in Los Angeles, summer or winter', () => {
  // 22 Nov 2026 03:00 UTC is 21 Nov 19:00 in LA (PST, UTC-8): next midnight is 22 Nov 08:00 UTC
  assert.equal(nextOwoDay(Date.parse('2026-11-22T03:00:00Z')), Date.parse('2026-11-22T08:01:00Z'));
  // in July LA is UTC-7
  assert.equal(nextOwoDay(Date.parse('2026-07-10T12:00:00Z')), Date.parse('2026-07-11T07:01:00Z'));
  // the night the clocks go back (1 Nov 2026) still lands on midnight
  assert.equal(nextOwoDay(Date.parse('2026-10-31T20:00:00Z')), Date.parse('2026-11-01T07:01:00Z'));
  assert.equal(nextOwoDay(Date.parse('2026-11-01T12:00:00Z')), Date.parse('2026-11-02T08:01:00Z'));
});

import { Store } from '../src/db.ts';
import { OwoState } from '../src/owo/state.ts';
import { pingsOf, setPing, syncPings } from '../src/owo/pings.ts';

test('pings: captcha on by default, HuntBot back queued only when asked for', () => {
  const store = new Store(':memory:');
  const st = new OwoState(store.db);
  const t = Date.now();
  assert.deepEqual(pingsOf(st, 'u'), { hb: false, day: false, captcha: true });
  st.setHuntbotBack('u', t + 3 * H);
  syncPings(store, 'u', 'c1', t);
  assert.equal(store.reminderOf('u', 'owo:hb'), undefined);
  setPing(store, 'u', 'hb', true);
  syncPings(store, 'u', 'c1', t);
  assert.equal(store.reminderOf('u', 'owo:hb')?.due_at, t + 3 * H);
  st.setHuntbotBack('u', null);
  syncPings(store, 'u', 'c1', t);
  assert.equal(store.reminderOf('u', 'owo:hb'), undefined);
  setPing(store, 'u', 'day', true);
  assert.ok(store.reminderOf('u', 'owo:day'));
  setPing(store, 'u', 'day', false);
  assert.equal(store.reminderOf('u', 'owo:day'), undefined);
});

test('essence follows upgrades and exp is filed under experience', () => {
  const st = new OwoState(new Store(':memory:').db);
  st.saveHuntbot('u', { traits: { gain: { value: '1100 essence/H', level: 44, progress: 0, need: 9457 } }, essence: 10000, maxRun: null, hunting: null });
  st.addEssence('u', -9457);
  st.setTrait('u', 'exp', 35, 0, 6400);
  const h = st.huntbot('u')!;
  assert.equal(h.essence, 543);
  assert.equal(h.traits.experience?.level, 35);
});
