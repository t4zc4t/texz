import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definitions } from '../src/core/registry.ts';

type Opt = { name: string; description: string; required?: boolean; type: number; options?: Opt[]; choices?: unknown[] };

// discord refuses the whole batch if any one command breaks these rules
function check(where: string, opts: Opt[] = []) {
  assert.ok(opts.length <= 25, `${where}: more than 25 options`);
  let optionalSeen = false;
  for (const o of opts) {
    assert.match(o.name, /^[\p{Ll}\p{N}_-]{1,32}$/u, `${where}: bad option name ${o.name}`);
    assert.ok(o.description.length >= 1 && o.description.length <= 100, `${where}.${o.name}: description length`);
    if (o.type === 1 || o.type === 2) { check(`${where} ${o.name}`, o.options); continue; }
    if (o.required) assert.ok(!optionalSeen, `${where}: required option ${o.name} comes after an optional one`);
    else optionalSeen = true;
    if (o.choices) assert.ok(o.choices.length <= 25, `${where}.${o.name}: too many choices`);
  }
}

test('every slash command is valid for discord', () => {
  assert.ok(definitions.length <= 100);
  for (const d of definitions) {
    assert.match(d.name, /^[\p{Ll}\p{N}_-]{1,32}$/u, `bad command name ${d.name}`);
    assert.ok(d.description.length >= 1 && d.description.length <= 100, `${d.name}: description length ${d.description.length}`);
    check(d.name, d.options as Opt[]);
  }
});

test('every setup page fits discord limits', async () => {
  const { Store } = await import('../src/db.ts');
  const { setupPanel } = await import('../src/features/setup.ts');
  const { modules } = await import('../src/core/registry.ts');
  const store = new Store(':memory:');
  const g = store.guild('g1');
  g.levels.rewards = { '5': '111111111111111111' };
  store.saveGuild('g1', g);
  const guild = { id: 'g1', roles: { cache: new Map() } } as never;
  const pages = ['home', 'features', 'welcome', 'autorole', 'mod', 'levels', 'rewards', 'lvxp', 'gifs', ...modules.filter((m) => !m.locked).map((m) => `f:${m.name}`)];
  for (const p of pages) {
    const v = setupPanel(store, guild, '123456789012345678', p);
    assert.ok(v.components.length >= 1 && v.components.length <= 5, `${p}: rows`);
    const ids: string[] = [];
    for (const r of v.components) {
      const c = r.toJSON().components;
      assert.ok(c.length <= 5, `${p}: too many in a row`);
      for (const x of c) if ('custom_id' in x) ids.push(x.custom_id);
    }
    assert.equal(new Set(ids).size, ids.length, `${p}: duplicate ids`);
    assert.ok(ids.every((x) => x.length <= 100), `${p}: id too long`);
    assert.ok(JSON.stringify(v.embeds[0].toJSON()).length < 6000, `${p}: embed too big`);
  }
});

test('xp boosts multiply, best role only, capped at 10x', async () => {
  const { boostsFor } = await import('../src/modules/levels.ts');
  const { defaultLevels } = await import('../src/db.ts');
  const l = defaultLevels();
  const now = Date.UTC(2026, 10, 7, 12); // a Saturday
  assert.equal(boostsFor(l, null, 'c1', null, now).total, 1);
  l.weekend = 2;
  l.boost = { x: 2, from: now - 1000, until: now + 1000, name: 'Party' };
  l.roleBoosts = { r1: 1.5, r2: 3 };
  l.channelBoosts = { parent: 2 };
  const { Collection } = await import('discord.js');
  const member = { roles: { cache: new Collection([['r1', { id: 'r1' }], ['r2', { id: 'r2' }]]) } } as never;
  const b = boostsFor(l, member, 'thread', 'parent', now);
  assert.deepEqual(b.parts.map((p) => p.x), [2, 2, 3, 2]);
  assert.equal(b.total, 10);
  l.boost.from = now + 5000;
  assert.equal(boostsFor(l, null, null, null, now).total, 2);
});

test('cases: old warnings move over, numbering and search work', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { Store } = await import('../src/db.ts');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = `${mkdtempSync(`${tmpdir()}/tz-`)}/t.db`;
  const old = new DatabaseSync(path);
  old.exec('CREATE TABLE warnings (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, user_id TEXT, mod_id TEXT, reason TEXT, at INTEGER)');
  old.exec("INSERT INTO warnings (guild_id, user_id, mod_id, reason, at) VALUES ('g', 'u1', 'm', 'spam 100%', 1), ('g', 'u2', 'm', 'rude', 2), ('h', 'u1', 'm', 'x', 3)");
  old.close();
  const store = new Store(path);
  assert.equal(store.getCase('g', 2)?.reason, 'rude');
  assert.equal(store.getCase('h', 1)?.reason, 'x');
  const n = store.addCase({ guild_id: 'g', type: 'tempban', user_id: 'u1', mod_id: 'm', reason: 'raid', until: 10, open: true });
  assert.equal(n, 3);
  assert.equal(store.findCases('g', { user: 'u1' }).total, 2);
  assert.equal(store.findCases('g', { text: '100%' }).total, 1);
  assert.equal(store.findCases('g', { text: '_' }).total, 0);
  assert.equal(store.dueCases(20).length, 1);
  store.closeCases('g', 'u1', 'tempban');
  assert.equal(store.dueCases(20).length, 0);
  const again = new Store(path);
  assert.equal(again.findCases('g', {}).total, 3);
});

test('giveaway draw is weighted and never repeats a winner', async () => {
  const { draw } = await import('../src/modules/giveaways.ts');
  const pool = [{ who: 'a', weight: 1 }, { who: 'b', weight: 1 }, { who: 'c', weight: 8 }];
  const won = draw(pool, 3);
  assert.equal(new Set(won).size, 3);
  assert.deepEqual(draw(pool, 5).sort(), ['a', 'b', 'c']);
  // rolling just under the end of the pool lands on the heavy ticket
  assert.deepEqual(draw(pool, 1, () => 0.95), ['c']);
  let c = 0;
  for (let i = 0; i < 2000; i++) if (draw(pool, 1)[0] === 'c') c++;
  assert.ok(c > 1400 && c < 1800, `heavy ticket won ${c} of 2000`);
});
