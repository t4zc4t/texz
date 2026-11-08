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

test('names are found in catch messages and rare ones are marked', async () => {
  const { nameIn, rarityOf } = await import('../src/features/pokedex.ts');
  assert.equal(nameIn('Congratulations <@1>! You caught a level 12 Alolan Vulpix (♀)!'.split('caught a level 12 ')[1]), 'Alolan Vulpix');
  assert.equal(nameIn('Wiglett 【💧】'), 'Wiglett');
  assert.equal(rarityOf('Mewtwo'), 'legendary');
  assert.equal(rarityOf('Mew'), 'mythical');
  assert.equal(rarityOf('Pikachu'), null);
});

test('a learned picture is recognised again', async () => {
  const { Store } = await import('../src/db.ts');
  const { learn, recognise, distance } = await import('../src/features/pokeid.ts');
  const store = new Store(':memory:');
  const a = 'f'.repeat(64);
  const near = `e${'f'.repeat(63)}`;
  assert.equal(distance(a, near), 1);
  assert.equal(recognise(store, a), null);
  learn(store, a, 'Wiglett');
  assert.equal(recognise(store, near)?.name, 'Wiglett');
  assert.equal(recognise(store, '0'.repeat(64)), null);
});

test('types come with every pokémon, regional forms too', async () => {
  const { typesOf } = await import('../src/features/pokedex.ts');
  assert.deepEqual(typesOf('Charizard'), ['Fire', 'Flying']);
  assert.deepEqual(typesOf('Alolan Vulpix'), ['Ice']);
  assert.deepEqual(typesOf('Wiglett'), ['Water']);
});

test('full names keep their variant', async () => {
  const { fullNameFrom } = await import('../src/modules/spawns.ts');
  assert.equal(fullNameFrom('Drednaw 🐢【🇩🇪 Kamalm】【💧】'), 'Drednaw');
  assert.equal(fullNameFrom('# Alolan Vulpix 🦊'), 'Alolan Vulpix');
  assert.equal(fullNameFrom('**Mr. Mime**'), 'Mr. Mime');
  assert.equal(fullNameFrom('Click to see attachment'), null);
});
