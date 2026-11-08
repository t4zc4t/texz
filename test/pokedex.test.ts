import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hintOf, solve } from '../src/features/pokedex.ts';

test('pokétwo hints get solved', () => {
  assert.equal(hintOf('The pokémon is \\_i\\_\\_\\_\\_u.'), '_i____u');
  assert.deepEqual(solve('P_k_ch_').map((x) => x.name), ['Pikachu']);
  assert.ok(solve('_i____u').some((x) => x.name === 'Pikachu'));
  assert.ok(solve('Alolan V_lp_x').some((x) => x.name === 'Alolan Vulpix'));
  assert.equal(solve('pika')[0].name, 'Pikachu');
  assert.equal(hintOf('Congratulations!'), null);
});
