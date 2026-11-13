import test from 'node:test';
import assert from 'node:assert';
import { addExtra, canonical } from '../src/features/pokedex.ts';

test('one spelling per pokémon name', () => {
  assert.equal(canonical('alolan vulpix'), 'Alolan Vulpix');
  assert.equal(canonical('PIKACHU'), 'Pikachu');
  addExtra(['Blue-Striped Basculin']);
  addExtra(['Blue-striped Basculin']);
  assert.equal(canonical('blue-striped basculin'), 'Blue-Striped Basculin');
  assert.equal(canonical('Some New Form'), 'Some New Form');
});
