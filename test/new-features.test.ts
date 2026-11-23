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

test('Pokétwo quests: type and region quests from p!quests and the event page', async () => {
  const { questsOf } = await import('../src/p2/track.ts');
  const q = questsOf({ content: '', embeds: [{ title: 'Quests', description: 'Complete these quests to earn special rewards!', footer: null, fields: [
    { name: 'Catch 50 pokémon originally found in the Kanto region.', value: '<:a:1><:b:2> `12/50`\n**Reward:** 2,500 Pokécoins' },
    { name: 'Catch 10 pokémon originally found in the Galar region.', value: '`10/10`\n**Reward:** 500 Pokécoins' },
  ] }] })!;
  assert.equal(q.src, 'q');
  assert.deepEqual(q.list, [{ kind: 'region', key: 'Kanto', progress: 12, goal: 50 }, { kind: 'region', key: 'Galar', progress: 10, goal: 10 }]);
  const ev = questsOf({ content: '', embeds: [{ title: 'Christmas Event', footer: null, fields: [], description: 'Help make toys by completing various tasks!\n\n**A1.** Catch 5 <:Fire:9> Fire-type pokémon `2/5`\n**A2.** Evolve 3 pokémon `0/3`\n**A3.** Catch 8 pokémon from the Johto region `8/8`' }] })!;
  assert.equal(ev.src, 'ev');
  assert.deepEqual(ev.list.map((x) => `${x.key} ${x.progress}/${x.goal}`), ['Fire 2/5', 'Johto 8/8']);
});

test('Pokétwo quests: catches count up, done quests stop pinging', async () => {
  const { Store } = await import('../src/db.ts');
  const { P2State } = await import('../src/p2/track.ts');
  const st = new P2State(new Store(':memory:').db);
  st.saveQuests('a', 'q', [{ kind: 'type', key: 'Fire', progress: 4, goal: 5 }, { kind: 'region', key: 'Kanto', progress: 0, goal: 50 }]);
  assert.deepEqual(st.questers(['Fire', 'Flying'], null), ['a']);
  st.questCatch('a', ['Fire'], 'Kanto');
  assert.deepEqual(st.quests('a').map((x) => `${x.key} ${x.progress}`), ['Kanto 1']);
  assert.deepEqual(st.questers(['Fire'], 'Johto'), []);
  // event quests go stale two weeks after the last look
  st.saveQuests('b', 'ev', [{ kind: 'type', key: 'Water', progress: 0, goal: 5 }], Date.now() - 20 * 864e5);
  assert.deepEqual(st.questers(['Water'], null), []);
});

test('spawn stats: busy hours in the next slot, rare spawns, catchers', async () => {
  const { spawnStats } = await import('../src/modules/spawns.ts');
  const now = Date.UTC(2026, 10, 23, 12, 30);
  const at = (h: number) => Date.UTC(2026, 10, 22, h, 5);
  const s = spawnStats([
    { at: at(20), name: 'Pikachu', caught_by: '1' }, { at: at(20), name: 'Mewtwo', caught_by: null },
    { at: at(20), name: 'Eevee', caught_by: '2' }, { at: at(9), name: 'Eevee', caught_by: '1' },
  ], now);
  assert.equal(s.total, 4);
  assert.equal(s.caught, 3);
  assert.equal(s.busiest[0].n, 3);
  assert.equal(s.busiest[0].at, Date.UTC(2026, 10, 23, 20) / 1000);
  assert.equal(s.busiest[1].at, Date.UTC(2026, 10, 24, 9) / 1000);
  assert.deepEqual(s.rare.map((r) => r.name), ['Mewtwo']);
  assert.deepEqual(s.top[0], ['1', 2]);
});

test('football season table: August to May, most right calls first', async () => {
  const { Store } = await import('../src/db.ts');
  const { fbSeason, fbTable } = await import('../src/modules/predict.ts');
  assert.equal(fbSeason(new Date(Date.UTC(2026, 10, 1))), '2026-27');
  assert.equal(fbSeason(new Date(Date.UTC(2027, 4, 20))), '2026-27');
  assert.equal(fbSeason(new Date(Date.UTC(2027, 7, 1))), '2027-28');
  const store = new Store(':memory:');
  store.setKv('predfb:2026-27:g:a', JSON.stringify({ calls: 10, right: 6 }));
  store.setKv('predfb:2026-27:g:b', JSON.stringify({ calls: 7, right: 6 }));
  store.setKv('predfb:2026-27:g:c', JSON.stringify({ calls: 3, right: 2 }));
  assert.deepEqual(fbTable(store, 'g', '2026-27').map((r) => r.user), ['b', 'a', 'c']);
});

test('self-check: a broken reader is flagged, a quiet server is not', async () => {
  const { Store } = await import('../src/db.ts');
  const { P2State } = await import('../src/p2/track.ts');
  const { Links } = await import('../src/anime/linked.ts');
  const { findings } = await import('../src/checks.ts');
  const store = new Store(':memory:');
  const st = new P2State(store.db);
  new Links(store.db);
  const now = Date.now();
  // quiet: nothing flagged
  assert.ok(findings(store, ['g'], now).every((f) => !f.broken));
  // catches coming in, no spawn seen for a day
  store.setKv('spawnseen:g:p2', String(now - 24 * 3600_000));
  store.addCatch('g', 'u', 'Pikachu');
  assert.ok(findings(store, ['g'], now).find((f) => f.key === 'spawn:g')!.broken);
  // lots of spawns, no catch read
  for (let n = 0; n < 45; n++) st.spawned(`s${n}`, 'h', now - n * 60_000);
  assert.ok(findings(store, ['h'], now).find((f) => f.key === 'catch:h')!.broken);
  store.db.prepare("INSERT INTO anime_links (user_id, site, username, synced_at) VALUES ('u', 'anilist', 'x', ?)").run(now - 10 * 3600_000);
  assert.ok(findings(store, [], now).find((f) => f.key === 'sync:anilist')!.broken);
});
