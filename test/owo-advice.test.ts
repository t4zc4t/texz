import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as R from '../src/owo/read.ts';
import { fitRanges } from '../src/owo/ranges.ts';
import { chanceAbove, dismantleList, report, verdict } from '../src/owo/advice.ts';
import { OwoState } from '../src/owo/state.ts';
import { ordersFor } from '../src/owo/orders.ts';

const raw = JSON.parse(readFileSync(new URL('./samples/owo/replies.json', import.meta.url), 'utf8')) as Record<string, { content: string; embeds: unknown[]; components: unknown[] }>;
const s = (k: string) => R.said(raw[k]);

// a vampiric staff with OwO's own ranges today: damage 25-45, WP 190-90, strength 5-20
function vamp(roll: [number, number, number]) {
  const [d, c, p] = roll;
  const dmg = 25 + 0.2 * d;
  const cost = Math.round(190 - c);
  const str = 5 + 0.15 * p;
  return { weapon: 'Vampiric Staff', quality: Math.round(((d + c + p) / 3) * 10) / 10, wpCost: cost, rolls: [Math.round(dmg * 100) / 100], passives: [{ name: 'Strength', rolls: [Math.round(str * 100) / 100] }] };
}

test('odds of beating a roll follow the average of uniform rolls', () => {
  assert.ok(Math.abs(chanceAbove(1, 70) - 0.3) < 1e-9);
  assert.ok(Math.abs(chanceAbove(2, 50) - 0.5) < 1e-9);
  // three rolls averaging over 80 is rare, about 3.6%
  assert.ok(Math.abs(chanceAbove(3, 80) - 0.036) < 0.001);
  assert.equal(chanceAbove(3, 100), 0);
});

test('ranges are learnt back from samples alone', () => {
  const samples = [[10, 20, 30], [90, 40, 70], [50, 50, 50], [30, 80, 20], [70, 10, 90], [20, 60, 40]].map((r) => vamp(r as [number, number, number]));
  const r = fitRanges(samples);
  const dmg = r.slots.get('w:Vampiric Staff:0')!;
  const cost = r.slots.get('w:Vampiric Staff:cost')!;
  assert.ok(Math.abs(dmg.min - 25) < 1 && Math.abs(dmg.max - 45) < 1, `${dmg.min}-${dmg.max}`);
  // the WP cost has moved since OwO's code (200-100), the samples win
  assert.ok(Math.abs(cost.min - 190) < 2 && Math.abs(cost.max - 90) < 2, `${cost.min}-${cost.max}`);
});

test('reroll verdicts on real screens', () => {
  const samples = [[10, 20, 30], [90, 40, 70], [50, 50, 50], [30, 80, 20], [70, 10, 90], [20, 60, 40]].map((r) => vamp(r as [number, number, number]));
  const ranges = fitRanges(samples);
  const st = R.reroll(s('reroll_stat'))!;
  const v = verdict(ranges, st, st.shards);
  // 54.3 to 64.3 with a much better main effect
  assert.equal(v.pick, 'confirm');
  assert.ok(v.odds && /shards/.test(v.odds));
  const p = verdict(ranges, R.reroll(s('reroll_passive'))!, null);
  // a new passive depends on the pet, Texz doesn't pretend to know
  assert.equal(p.pick, 'your call');
});

test('a higher quality with a weaker main effect is not a confirm', () => {
  const samples = [[10, 20, 30], [90, 40, 70], [50, 50, 50], [30, 80, 20], [70, 10, 90], [20, 60, 40]].map((r) => vamp(r as [number, number, number]));
  const ranges = fitRanges(samples);
  const side = (x: ReturnType<typeof vamp>) => ({ rarity: 'epic', icon: null, quality: x.quality, wear: 'worn', wpCost: x.wpCost, rolls: x.rolls, passives: x.passives.map((p) => ({ emoji: 'ratt', ...p })) });
  const now = vamp([77, 60, 56]);
  const next = vamp([47, 90, 57]);
  assert.ok(next.quality > now.quality);
  const v = verdict(ranges, { id: 'AAAAAA', name: 'Vampiric Staff', current: side(now), next: side(next), kind: 'stat', changes: 0, attempts: 1, shards: 1000 }, 1000);
  assert.equal(v.pick, 'cancel');
});

test('legendary and empowered weapons are never sent to reroll', () => {
  const ranges = fitRanges([]);
  assert.equal(report(ranges, { name: 'Bow', quality: 96, wear: 'worn', empowered: false, wpCost: 120, rolls: [158], passives: [] }).advice.kind, 'keep');
  assert.equal(report(ranges, { name: 'Bow', quality: 40, wear: 'worn', empowered: true, wpCost: 200, rolls: [120], passives: [] }).advice.kind, 'locked');
});

test('dismantle list protects anything in use, favourites, the best of each kind and good wear', () => {
  const w = (id: string, name: string, rarity: string, quality: number, extra: Record<string, unknown> = {}) => ({ id, type: null, rarity, name, quality, wear: 'worn', empowered: false, favourite: false, kills: null, on: null, wpCost: null, rolls: null, passives: null, passiveIcons: [], rerollChanges: null, rerollAttempts: null, detailed: false, seenAt: 0, ...extra });
  const list = [
    w('A1', 'Bow', 'rare', 50), w('A2', 'Bow', 'rare', 45), w('A3', 'Bow', 'rare', 41), w('A4', 'Bow', 'uncommon', 30, { on: 'gfox' }),
    w('A5', 'Bow', 'uncommon', 25, { favourite: true }), w('A6', 'Bow', 'uncommon', 22, { wear: 'pristine' }), w('A7', 'Bow', 'common', 10),
    w('B1', 'Great Sword', 'mythic', 90), w('B2', 'Great Sword', 'mythic', 85), w('B3', 'Great Sword', 'mythic', 82),
    w('C1', 'Bow', 'legendary', 96),
  ];
  const { safe, think } = dismantleList(list as never);
  const ids = safe.map((x) => x.id);
  // the legendary bow counts as one of the best two bows, so only one rare one stays
  assert.deepEqual(ids.sort(), ['A2', 'A3', 'A7']);
  assert.deepEqual(think.map((x) => x.id), ['B3']);
});

test('daily orders stay short and ask for what is missing', () => {
  const st = new OwoState(new DatabaseSync(':memory:'));
  const R2 = R;
  for (const k of ['team', 'wlist']) {
    const x = R2.said(raw[k]);
    const t = R2.team(x); if (t) st.saveTeam('u1', t, 1000);
    const l = R2.weaponList(x); if (l) st.saveWeaponRows('u1', l.weapons, 1000);
  }
  const orders = ordersFor(st, 'u1', 1000 + 10 * 86_400_000);
  assert.ok(orders.length > 0 && orders.length <= 5);
  assert.ok(orders.some((o) => /shop weapon/.test(o.cmd)));
  assert.ok(orders.some((o) => /^w w [A-Z0-9]{6}$/.test(o.cmd)));
});
