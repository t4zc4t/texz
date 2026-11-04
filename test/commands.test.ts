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
  for (const d of definitions.filter((x) => (x as { type?: number }).type !== 3)) {
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
  const guild = { id: 'g1', roles: { cache: new Map() }, client: { application: { owner: { id: '123456789012345678' } } } } as never;
  const pages = ['home', 'features', 'welcome', 'autorole', 'mod', 'levels', 'rewards', 'lvxp', 'birthdays', 'quotes', 'tickets', 'cotd', 'bulletins', 'gifs', ...modules.filter((m) => !m.locked).map((m) => `f:${m.name}`)];
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

test('watchlist pages and status filters fit discord limits', async () => {
  const { Store } = await import('../src/db.ts');
  const { listPage } = await import('../src/modules/watchlist.ts');
  const store = new Store(':memory:');
  for (let i = 1; i <= 23; i++) store.watch({ user_id: 'u', media_id: i, title: `Show ${i} with a fairly long title to test`, kind: i % 3 ? 'ANIME' : 'MANGA', status: ['watching', 'planning', 'completed'][i % 3], progress: i, total: i % 2 ? 24 : null });
  const v = listPage(store, 'u', 'u', 'all', 2);
  assert.equal(v.components.length, 3);
  assert.match(v.embeds[0].toJSON().footer!.text, /Page 3\/3/);
  const only = listPage(store, 'u', 'u', 'completed', 0);
  assert.ok(only.embeds[0].toJSON().description!.includes('✅'));
  const theirs = listPage(store, 'x', 'u', 'all', 0);
  assert.ok(!JSON.stringify(theirs.components.map((r) => r.toJSON())).includes('wle|'));
  for (const r of v.components) for (const c of r.toJSON().components) if ('custom_id' in c) assert.ok(c.custom_id.length <= 100);
});

test('birthday dates, leap days and countdowns', async () => {
  const { parseDate, isBirthday, daysUntil, localDate } = await import('../src/modules/birthdays.ts');
  assert.deepEqual(parseDate('14 feb'), { month: 2, day: 14 });
  assert.deepEqual(parseDate('February 14th'), { month: 2, day: 14 });
  assert.deepEqual(parseDate('14/02'), { month: 2, day: 14 });
  assert.deepEqual(parseDate('2001-02-14'), { month: 2, day: 14 });
  assert.equal(parseDate('31 apr'), null);
  assert.equal(parseDate('hello'), null);
  assert.ok(isBirthday({ month: 2, day: 29 }, { year: 2027, month: 2, day: 28 }));
  assert.ok(!isBirthday({ month: 2, day: 29 }, { year: 2028, month: 2, day: 28 }));
  assert.equal(daysUntil({ month: 1, day: 1 }, { year: 2026, month: 12, day: 31 }), 1);
  assert.equal(daysUntil({ month: 11, day: 3 }, { year: 2026, month: 11, day: 3 }), 0);
  // 20:00 UTC on the 2nd is already the 3rd in India
  assert.deepEqual(localDate('Asia/Kolkata', new Date(Date.UTC(2026, 10, 2, 20))), { year: 2026, month: 11, day: 3 });
});

test('daily backup keeps a copy and trims old ones', async () => {
  const { Store } = await import('../src/db.ts');
  const { backup } = await import('../src/ops.ts');
  const { mkdtempSync, readdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(`${tmpdir()}/tzb-`);
  for (const d of ['2026-01-01', '2026-01-02', '2026-01-03']) writeFileSync(`${dir}/texz-${d}.db`, 'x');
  const store = new Store(`${dir}/live.db`);
  store.setKv('a', 'b');
  backup(store, `${dir}`, 2);
  const left = readdirSync(dir).filter((f) => f.startsWith('texz-'));
  assert.equal(left.length, 2);
  assert.equal(new Store(`${dir}/${left.sort().at(-1)}`).getKv('a'), 'b');
});

test('planned post times', async () => {
  const { parseWhen } = await import('../src/modules/server.ts');
  const now = Date.UTC(2026, 10, 3, 10, 0); // 15:30 in India
  assert.equal(parseWhen('in 2h', 'Asia/Kolkata', now), now + 2 * 3_600_000);
  assert.equal(parseWhen('18:30', 'Asia/Kolkata', now), Date.UTC(2026, 10, 3, 13, 0));
  assert.equal(parseWhen('09:00', 'Asia/Kolkata', now), Date.UTC(2026, 10, 4, 3, 30));
  assert.equal(parseWhen('tomorrow 18:30', 'Asia/Kolkata', now), Date.UTC(2026, 10, 4, 13, 0));
  assert.equal(parseWhen('<t:1793700000:f>', 'UTC', now), 1793700000000);
  assert.equal(parseWhen('soon', 'UTC', now), null);
  assert.equal(parseWhen('25:00', 'UTC', now), null);
});

test('daily yen grows with the streak and the wallet never goes negative', async () => {
  const { Store } = await import('../src/db.ts');
  const { claimDaily, DAILY_BASE, DAILY_STEP } = await import('../src/modules/economy.ts');
  const store = new Store(':memory:');
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  store.pay('g', 'u', 0, { daily_day: yesterday, streak: 3 });
  const r = claimDaily(store, 'g', 'u');
  assert.ok(r.ok && r.streak === 4 && r.got === DAILY_BASE + 3 * DAILY_STEP);
  assert.equal(claimDaily(store, 'g', 'u').ok, false);
  assert.equal(store.pay('g', 'u', -1_000_000), false);
  assert.ok(store.pay('g', 'u', -100));
  assert.equal(store.wallet('g', 'u').yen, DAILY_BASE + 3 * DAILY_STEP - 100);
});

test('which football matches get posted', async () => {
  const { interesting } = await import('../src/feeds/football.ts');
  const m = (league: string, a: string, b: string) => ({ id: '1', league, date: 0, state: 'pre', detail: '', venue: null, goals: [],
    home: { id: '1', name: a, short: '', score: '0', winner: false, home: true }, away: { id: '2', name: b, short: '', score: '0', winner: false, home: false } }) as never;
  assert.ok(interesting(m('eng.1', 'Liverpool', 'Arsenal'), [], true));
  assert.ok(!interesting(m('eng.1', 'Liverpool', 'Brentford'), [], true));
  assert.ok(interesting(m('uefa.champions', 'Liverpool', 'Brentford'), [], true));
  assert.ok(interesting(m('ind.1', 'Mohun Bagan', 'East Bengal'), ['mohun bagan'], false));
  assert.ok(interesting(m('fifa.world', 'Japan', 'Ghana'), [], true));
  assert.ok(!interesting(m('eng.1', 'Liverpool', 'Arsenal'), [], false));
  assert.ok(interesting(m('esp.1', 'Atlético Madrid', 'Real Madrid'), [], true));
});
