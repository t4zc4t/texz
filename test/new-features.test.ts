import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gemPlan, useOf } from '../src/owo/gems.ts';
import { chainLine, dexPage, huntCard, shinyChance, shinyWithin, spanOf } from '../src/p2/track.ts';
import { weekOf } from '../src/owo/state.ts';

test('gems: hunting + empowering last as OwO counts them, lucky alone burns faster', () => {
  const active = [{ gem: 'mgem1', left: 12, of: 75 }, { gem: 'lgem3', left: 384, of: 800 }, { gem: 'lgem4', left: 384, of: 800 }];
  // a mythic hunting gem adds 6: 7 animals, doubled to 14; empowering loses 7 a hunt, lucky 7 with both on
  assert.equal(useOf(active, 'mgem1'), 1);
  assert.equal(useOf(active, 'lgem3'), 7);
  assert.equal(useOf(active, 'lgem4'), 7);
  assert.equal(useOf([{ gem: 'lgem4', left: 50, of: 800 }], 'lgem4'), 1);
  const p = gemPlan(active, { '51': 13, '65': 9, '72': 6 });
  const h = p.lines.find((l) => l.type === 'Hunting')!;
  assert.equal(h.huntsLeft, 12);
  assert.equal(h.next?.id, 51);
  assert.equal(p.lines.find((l) => l.type === 'Empowering')!.huntsLeft, Math.ceil(384 / 7));
  assert.equal(p.luckyAlone, false);
  assert.equal(gemPlan([{ gem: 'cgem4', left: 20, of: 50 }], {}).luckyAlone, true);
});

test('Pokétwo shiny hunt: chain lines, the hunt card and the odds', () => {
  assert.deepEqual(chainLine({ content: 'Congratulations <@1>! You caught a Level 27 Dondozo (51.61%)!\n\n+1 Shiny chain! (**4**)', embeds: [] }), { reset: false, chain: 4 });
  assert.deepEqual(chainLine({ content: 'Congratulations <@1>! ✨ You caught a Level 9 Dondozo!\n\nShiny streak reset. (**312**)', embeds: [] }), { reset: true, chain: 312 });
  const card = huntCard({ content: '', embeds: [{ title: 'Shiny Hunt ✨', description: '', fields: [{ name: 'Currently Hunting', value: 'Dondozo' }, { name: 'Chain', value: '41' }], footer: 'You have a shiny charm active that expires in 2 days and 3 hours.' }] })!;
  assert.equal(card.species, 'Dondozo');
  assert.equal(card.chain, 41);
  assert.equal(spanOf(card.charm!), 2 * 86_400_000 + 3 * 3_600_000);
  assert.ok(Math.abs(shinyChance(0) - 1 / 4096) < 1e-12);
  assert.ok(Math.abs(shinyChance(49, true) - (1.2 * 2) / 4096) < 1e-12);
  assert.ok(shinyWithin(100, 500) > shinyWithin(0, 500));
});

test('Pokétwo dex page', () => {
  const d = dexPage({ content: '', embeds: [{ title: 'Your pokédex', description: "You've caught 412 out of 1,025 pokémon!\n### Pokédex Entry Milestones", fields: [{ name: 'Bulbasaur #1', value: '✅ 3 caught!' }, { name: 'Ivysaur #2', value: '❌ Not caught yet!' }, { name: '‎', value: '‎' }], footer: 'Showing 1–20 out of 1025.' }] })!;
  assert.deepEqual(d.total, { caught: 412, total: 1025 });
  assert.deepEqual(d.rows, [{ dex: 1, caught: 3 }, { dex: 2, caught: 0 }]);
});

test('weeks start on Monday', () => {
  assert.equal(weekOf(Date.parse('2026-11-23T10:00:00Z')), '2026-11-23');
  assert.equal(weekOf(Date.parse('2026-11-22T23:59:00Z')), '2026-11-16');
});
