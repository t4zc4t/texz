import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/db.ts';
import { modules } from '../src/core/registry.ts';
import { picksOf, savePicks } from '../src/modules/profile.ts';
import { settleGuild } from '../src/core/settle.ts';

const guild = (id: string, name: string) => ({ id, name }) as never;

test('a profile belongs to one server, old files go to the first one that opens them', () => {
  const store = new Store(':memory:');
  store.setKv('picks:u1', JSON.stringify({ club: 'Inter Miami', show: ['club'] }));
  store.setProfile('u1', { bio: 'old bio', favourite: null });
  const home = picksOf(store, 'g1', 'u1');
  assert.equal(home.club, 'Inter Miami');
  assert.equal(home.bio, 'old bio');
  // claimed, so another server starts empty
  const other = picksOf(store, 'g2', 'u1');
  assert.equal(other.club, undefined);
  assert.equal(other.bio, undefined);
  savePicks(store, 'g2', 'u1', { ...other, club: 'Arsenal' });
  assert.equal(picksOf(store, 'g1', 'u1').club, 'Inter Miami');
  assert.equal(picksOf(store, 'g2', 'u1').club, 'Arsenal');
  assert.deepEqual(store.allPicks('g2').map((p) => p.club), ['Arsenal']);
});

test('new servers start with features off, the home server keeps what it has', () => {
  assert.ok(modules.length > 5);
  const store = new Store(':memory:');
  settleGuild(store, guild('g1', 'Some New Place'));
  settleGuild(store, guild('g2', 'Nyx Elysium'));
  for (const m of modules.filter((x) => !x.locked)) {
    assert.equal(store.rules('g1', m.name).enabled, false, m.name);
    assert.equal(store.rules('g2', m.name).enabled, m.name !== 'levels', m.name);
  }
  // only once, an admin's later choice stays
  const g = store.guild('g1');
  g.modules.owo = { ...g.modules.owo, enabled: true };
  store.saveGuild('g1', g);
  settleGuild(store, guild('g1', 'Some New Place'));
  assert.equal(store.rules('g1', 'owo').enabled, true);
});
