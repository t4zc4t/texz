import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POKETWO_ID, SHOOB_ID, spawnOf } from '../src/modules/spawns.ts';

const msg = (id: string, title: string, description = '') => ({ author: { id }, embeds: [{ title, description, footer: null }] });

test('spawns are read from the embed', () => {
  assert.deepEqual(spawnOf(msg(POKETWO_ID, 'A wild pokémon has appeared!')), { kind: 'p2', tier: null });
  assert.equal(spawnOf(msg(POKETWO_ID, 'Congratulations! You caught a level 12 Eevee')), null);
  assert.deepEqual(spawnOf(msg(SHOOB_ID, 'Gojo Satoru', 'Tier: 5')), { kind: 'shoob', tier: 5 });
  assert.deepEqual(spawnOf(msg(SHOOB_ID, 'Tier S card')), { kind: 'shoob', tier: 7 });
  assert.equal(spawnOf(msg(SHOOB_ID, 'Your inventory')), null);
  assert.equal(spawnOf(msg('123', 'A wild pokémon has appeared!')), null);
});
