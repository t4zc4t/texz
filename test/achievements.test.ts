import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/db.ts';
import { BADGES, badgesOf, progressOf, shownOf, setShown, track } from '../src/modules/missions.ts';
import { medalOf, tierOf } from '../src/features/medals.ts';
import { closest, search } from '../src/core/fuzzy.ts';

test('every achievement has a medal look', () => {
  for (const b of BADGES) assert.ok(medalOf[b.id], `${b.id} has no medal`);
  assert.equal(new Set(BADGES.map((b) => b.id)).size, BADGES.length);
});

test('counted achievements unlock once at their number', () => {
  const store = new Store(':memory:');
  for (let n = 0; n < 9; n++) track(store, 'g', 'u', 'quote');
  assert.ok(badgesOf(store, 'g', 'u').includes('quote1'));
  assert.ok(!badgesOf(store, 'g', 'u').includes('quote10'));
  const lines = track(store, 'g', 'u', 'quote');
  assert.ok(lines.some((l) => l.includes('Collector of words')));
  assert.equal(track(store, 'g', 'u', 'quote').filter((l) => l.includes('earned')).length, 0);
});

test('best-value achievements keep the highest and ignore drops', () => {
  const store = new Store(':memory:');
  track(store, 'g', 'u', 'dailyStreak', 5);
  track(store, 'g', 'u', 'dailyStreak', 2);
  const streak7 = BADGES.find((b) => b.id === 'streak7')!;
  assert.equal(progressOf(store, 'g', 'u', streak7), 5);
  track(store, 'g', 'u', 'dailyStreak', 7);
  assert.ok(badgesOf(store, 'g', 'u').includes('streak7'));
  assert.ok(!badgesOf(store, 'g', 'u').includes('streak30'));
});

test('all 18 types unlock the every-type medal', () => {
  const store = new Store(':memory:');
  const types = ['Normal', 'Fire', 'Water', 'Grass', 'Electric', 'Ice', 'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy'];
  for (const t of types.slice(0, 17)) track(store, 'g', 'u', `catchType:${t}`);
  track(store, 'g', 'u', 'catchType:Fire');
  assert.ok(!badgesOf(store, 'g', 'u').includes('types18'));
  track(store, 'g', 'u', 'catchType:Fairy');
  assert.ok(badgesOf(store, 'g', 'u').includes('types18'));
});

test('profile shows picked medals, else the rarest', () => {
  const store = new Store(':memory:');
  track(store, 'g', 'u', 'quote');
  track(store, 'g', 'u', 'catchShiny');
  track(store, 'g', 'u', 'catch');
  assert.equal(shownOf(store, 'g', 'u', tierOf)[0], 'shiny');
  setShown(store, 'g', 'u', ['quote1', 'notmine']);
  assert.deepEqual(shownOf(store, 'g', 'u', tierOf), ['quote1']);
});

test('typos and plain words find commands', () => {
  assert.equal(closest('rnak', ['rank', 'ranks', 'remind']), 'rank');
  assert.equal(closest('hello', ['help']), null);
  const docs = [
    { id: 'wallet', names: ['wallet', 'bal'], text: 'Your yen, your daily and the richest people here' },
    { id: 'birthday', names: ['birthday', 'bday'], text: 'Birthdays' },
    { id: 'pings', names: ['pings', 'notify'], text: 'Every ping Texz can send you' },
  ];
  assert.equal(search('money', docs)[0].id, 'wallet');
  assert.equal(search('ping me', docs)[0].id, 'pings');
  assert.equal(search('when is my bday', docs)[0].id, 'birthday');
});
