import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as R from '../src/owo/read.ts';
import { OwoState } from '../src/owo/state.ts';
import { apply, owoCommand } from '../src/owo/listen.ts';

const raw = JSON.parse(readFileSync(new URL('./samples/owo/replies.json', import.meta.url), 'utf8')) as Record<string, { content: string; embeds: unknown[]; components: unknown[] }>;
const s = (k: string) => R.said(raw[k]);
const fresh = () => new OwoState(new DatabaseSync(':memory:'));

test('OwO commands with owo or w, any case, with or without a space', () => {
  assert.deepEqual(owoCommand('w hb'), { name: 'huntbot', args: '' });
  assert.deepEqual(owoCommand('whb'), { name: 'huntbot', args: '' });
  assert.deepEqual(owoCommand('W TEAM'), { name: 'team', args: '' });
  assert.deepEqual(owoCommand('owo w G3JG6F'), { name: 'weapon', args: 'G3JG6F' });
  assert.deepEqual(owoCommand('wh'), { name: 'hunt', args: '' });
  assert.equal(owoCommand('wow that was close'), null);
  assert.equal(owoCommand('why'), null);
  assert.equal(owoCommand('tz w'), null);
});

test('a team card saves pets, the team and the weapons they hold', () => {
  const st = fresh();
  assert.deepEqual(apply(st, 'u1', s('team')), ['team']);
  assert.equal(st.pets('u1').length, 3);
  assert.equal(st.teams('u1')[0].animals.length, 3);
  const held = st.weapons('u1').filter((w) => w.on);
  assert.equal(held.length, 3);
});

test('a weapon card fills in the numbers, a list row never wipes them', () => {
  const st = fresh();
  apply(st, 'u1', s('weapon'));
  const id = R.weapon(s('weapon'))!.id!;
  const before = st.weapons('u1').find((w) => w.id === id)!;
  assert.ok(before.detailed && before.rolls!.length);
  apply(st, 'u1', s('wlist'));
  const after = st.weapons('u1').find((w) => w.id === id);
  if (after) assert.deepEqual(after.rolls, before.rolls);
  assert.ok(st.weapons('u1').length > 5);
});

test('a full sweep of the weapon list drops weapons that are gone', () => {
  const st = fresh();
  const list = R.weaponList(s('wlist'))!;
  st.saveWeaponRows('u1', [{ ...list.weapons[0], id: 'GONE01' }], 1000);
  // a one-page unfiltered list counts as a full sweep
  const onePage = { ...raw.wlist, components: JSON.parse(JSON.stringify(raw.wlist.components).replace(/"label":"\d+\/\d+"/, '"label":"1/1"')) };
  apply(st, 'u1', R.said(onePage), 5000);
  assert.ok(!st.weapons('u1').some((w) => w.id === 'GONE01'));
});

test('huntbot status, a send off and the return', () => {
  const st = fresh();
  apply(st, 'u1', s('huntbot'), 1000);
  const h = st.huntbot('u1')!;
  assert.ok(h.traits.gain!.level > 0);
  assert.ok(h.backAt! > 1000);
  apply(st, 'u1', s('hb_sent'), 2000);
  assert.ok(st.huntbot('u1')!.backAt! > 2000);
  apply(st, 'u1', s('hb_back'), 3000);
  assert.equal(st.huntbot('u1')!.backAt, null);
  apply(st, 'u1', s('upgrade'), 4000);
  assert.ok(st.huntbot('u1')!.traits.gain!.level > 0);
});

test('zoo, battles, shards and the rest', () => {
  const st = fresh();
  apply(st, 'u1', s('zoo'));
  assert.ok(st.zoo('u1')!.animals.length > 10);
  apply(st, 'u1', s('battle_won'));
  apply(st, 'u1', s('battle_lost'));
  assert.equal(st.battles('u1').length, 2);
  apply(st, 'u1', s('shards'));
  assert.ok((st.bits('u1').get('shards')!.value as number) > 0);
});

test('forget wipes everything for that person only', () => {
  const st = fresh();
  apply(st, 'u1', s('team'));
  apply(st, 'u2', s('team'));
  st.forget('u1');
  assert.equal(st.pets('u1').length, 0);
  assert.equal(st.pets('u2').length, 3);
});
