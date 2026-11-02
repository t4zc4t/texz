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
  const pages = ['home', 'features', 'welcome', 'autorole', 'mod', 'levels', 'gifs', ...modules.filter((m) => !m.locked).map((m) => `f:${m.name}`)];
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
