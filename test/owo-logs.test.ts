import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as R from '../src/owo/read.ts';
import { OwoState } from '../src/owo/state.ts';
import { apply } from '../src/owo/listen.ts';
import { battleStats, catchStats, collectibles, forecast, paceOf, teamNow } from '../src/owo/stats.ts';
import { wallCard } from '../src/owo/wallcard.ts';
import { wallPrice, wallUrl } from '../src/owo/catalog.ts';
import { createCanvas } from '@napi-rs/canvas';

const raw = JSON.parse(readFileSync(new URL('./samples/owo/replies.json', import.meta.url), 'utf8')) as Record<string, { content: string; embeds: unknown[]; components: unknown[] }>;
const s = (k: string) => R.said(raw[k]);
const fresh = () => new OwoState(new DatabaseSync(':memory:'));

test('hunts and HuntBot returns fill the catch log, an edited hunt counts once', () => {
  const st = fresh();
  apply(st, 'u', s('hunt_gems'));
  apply(st, 'u', s('hunt_gems'), Date.now(), true);
  apply(st, 'u', s('hb_back'));
  const c = catchStats(st, 'u');
  assert.equal(c.hunts, 1);
  assert.ok(c.hunt.some(([r, n]) => r === 'common' && n > 0));
  assert.ok(c.bot.some(([r]) => r === 'epic'));
  assert.ok(c.luckBot.some((x) => x.rank === 'epic' && x.got === 6));
});

test('a mythic catch lands in the rare log', () => {
  const st = fresh();
  const hunt = R.said({ content: '**🌱 | Kunikida**, hunt is empowered by!\n**<:blank:427371936482328596> |** You found:  :bee: :dragon: :sheep:\n<:blank:1> **|** gained **99xp**!' });
  apply(st, 'u', hunt);
  const log = st.catches('u');
  assert.equal(log.length, 1);
  assert.equal(log[0].animal, 'dragon');
  assert.equal(log[0].rank, 'mythic');
});

test('battle stats and the level forecast', () => {
  const st = fresh();
  apply(st, 'u', s('team'));
  for (let i = 0; i < 10; i++) apply(st, 'u', s(i % 3 ? 'battle_won' : 'battle_lost'), Date.now() - i * 3_600_000);
  const b = battleStats(st, 'u');
  assert.equal(b.windows[0].n, 10);
  assert.equal(b.windows[0].won, 6);
  const pace = paceOf(st, 'u');
  assert.ok(pace && pace.xpPer > 0);
  const tn = teamNow(st, 'u');
  assert.ok(tn.length > 0 && forecast(tn, pace!, tn[0].animal, tn[0].level + 1));
});

test('collectibles know what is done today', () => {
  const st = fresh();
  apply(st, 'u', s('alastor'));
  apply(st, 'u', s('piku'));
  const list = collectibles(st, 'u');
  assert.deepEqual(list.map((x) => x.key).sort(), ['alastor', 'piku']);
  assert.ok(list.find((x) => x.key === 'alastor')!.done);
  // seen yesterday: not done today
  const later = collectibles(st, 'u', Date.now() + 2 * 86_400_000);
  assert.ok(later.every((x) => !x.done));
});

test('wallpapers from the shop are kept, owned ones per person', async () => {
  const st = fresh();
  const page = (author: string, d: string) => R.said({ embeds: [{ author: { name: author }, description: d, image: { url: 'https://example.com/background/5.png' } }] });
  apply(st, 'u', page('OwO Shop: Wallpapers', '`205` **`Sakura Night`**`------------- 100K` <:cowoncy:416043450337853441>'));
  apply(st, 'u', page("Kunikida's wallpapers", '`203` **Starry Sky**   *Currently Equipped*'));
  const all = st.wallpapers('u');
  assert.deepEqual(all.map((w) => [w.id, w.price, !!w.owned, !!w.equipped]), [[203, null, true, true], [205, 100000, false, false]]);
  const img = createCanvas(800, 450);
  const g = img.getContext('2d');
  g.fillStyle = '#336';
  g.fillRect(0, 0, 800, 450);
  const png = await wallCard({ wallpaper: img.toBuffer('image/png'), avatar: null, name: 'Kunikida', title: 'Detective', accent: '#3fa7ff', level: 14, rank: null, xp: [10, 20], cookies: 3, teamName: 'Agency', pets: [{ image: null, label: 'owl', level: 3 }], about: 'Ideals first.', partner: 'Ranpo' });
  assert.ok(png.length > 1000);
  assert.equal(wallUrl(248), 'https://owobotcdn.com/background/48.png');
  assert.equal(wallPrice(201), 35_000);
  assert.equal(wallPrice(220), 'gone');
});

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/db.ts';
import { backfillHistory } from '../src/owo/listen.ts';

test('older battles and hunts come in from the saved log once, without doubles', () => {
  const dir = mkdtempSync(join(tmpdir(), 'owolog-'));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const store = new Store(':memory:');
    store.setKv('owo:huntsLive', String(Date.parse('2026-11-20T00:00:00Z')));
    const st = new OwoState(store.db);
    const battle = raw.battle_won as unknown as { embeds: { author: { name: string } }[] };
    const owner = R.battle(s('battle_won'))!.owner;
    const lines = [
      { at: '2026-11-10T10:00:00Z', ...battle, embeds: battle.embeds.map((e) => ({ ...e, id: 'b1' })) },
      { at: '2026-11-10T10:00:01Z', ...battle, embeds: battle.embeds.map((e) => ({ ...e, id: 'b1' })) },
      { at: '2026-11-10T10:05:00Z', ...battle, embeds: battle.embeds.map((e) => ({ ...e, id: 'b2' })) },
      { at: '2026-11-11T10:00:00Z', content: `**🌱 | ${owner}**, hunt!\n**<:blank:1> |** You found:  :bee: :dragon:\n`, embeds: [] },
      { at: '2026-11-11T10:00:00Z', content: `**🌱 | ${owner}**, hunt!\n**<:blank:1> |** You found:  :bee: :dragon:\n`, embeds: [] },
      { at: '2026-11-21T10:00:00Z', content: `**🌱 | ${owner}**, hunt!\n**<:blank:1> |** You found:  :bee:\n`, embeds: [] },
    ];
    writeFileSync('owo-debug.log', lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    st.setBit('u', 'owoName', owner);
    backfillHistory(store);
    backfillHistory(store);
    assert.equal(st.battles('u').length, 2);
    const c = catchStats(st, 'u');
    assert.equal(c.hunts, 1);
    assert.equal(st.catches('u')[0].animal, 'dragon');
  } finally { process.chdir(prev); }
});

import { pageFor } from '../src/owo/menu.ts';

test('forecast pays lower pets OwO\'s catch-up multiplier', () => {
  const pace = { xpPer: 700, perDay: 60, hbPerDay: 0 };
  const team = [{ animal: 'a', name: 'a', level: 31, xp: 0 }, { animal: 'b', name: 'b', level: 23, xp: 0 }];
  const behind = forecast(team, pace, 'b', 24)!;
  const alone = forecast([{ animal: 'b', name: 'b', level: 23, xp: 0 }], pace, 'b', 24)!;
  // 23→24 needs 280,841 xp: alone 700 a battle, behind 2.8× that
  assert.equal(alone.battles, Math.ceil(280841 / 700));
  assert.equal(behind.battles, Math.ceil(280841 / (700 * 2.8)));
  const withHb = forecast(team, { ...pace, hbPerDay: 6000 }, 'b', 24)!;
  assert.ok(withHb.battles < behind.battles);
});

test('the right click helper opens the page that fits the OwO message', () => {
  assert.equal(pageFor(s('team')).cmd, 'owoteam');
  assert.equal(pageFor(s('huntbot')).cmd, 'owohb');
  assert.equal(pageFor(s('hb_back')).cmd, 'owohb');
  assert.equal(pageFor(s('zoo')).cmd, 'owozoo');
  assert.equal(pageFor(s('battle_won')).cmd, 'owobattles');
  assert.equal(pageFor(s('hunt_gems')).cmd, 'owocatches');
  assert.equal(pageFor(s('dex')).cmd, 'owodex');
  assert.equal(pageFor(s('weapon')).cmd, 'owoweapon');
  assert.equal(pageFor(s('alastor')).cmd, 'owocollect');
  assert.equal(pageFor(s('cash')).cmd, 'owosync');
});

test('OwO cooldown pings: hunt, battle and pray start the clock, a slow down says when', async () => {
  const { readFileSync } = await import('node:fs');
  const { said } = await import('../src/owo/read.ts');
  const { cooldownOf } = await import('../src/owo/listen.ts');
  const r = JSON.parse(readFileSync('test/samples/owo/replies.json', 'utf8')) as Record<string, { content: string; embeds: unknown[]; components: unknown[] }>;
  const s = (k: string) => said({ content: r[k].content, embeds: r[k].embeds as never, components: r[k].components as never });
  const now = 1_000_000;
  assert.deepEqual(cooldownOf('hunt', s('hunt_gems'), now), { kind: 'hunt', at: now + 15_000 });
  assert.deepEqual(cooldownOf('battle', s('battle_won'), now), { kind: 'hunt', at: now + 15_000 });
  assert.deepEqual(cooldownOf(null, s('hunt_one'), now), { kind: 'hunt', at: now + 15_000 });
  assert.deepEqual(cooldownOf('pray', s('pray'), now), { kind: 'pray', at: now + 300_000 });
  assert.deepEqual(cooldownOf(null, s('pray'), now), { kind: 'pray', at: now + 300_000 });
  assert.deepEqual(cooldownOf('hunt', s('slowdown'), now), { kind: 'hunt', at: 1793606421 * 1000 });
  assert.equal(cooldownOf('zoo', s('hunt_one'), now), null);
  assert.equal(cooldownOf('pray', said({ content: '**🚫 | Kunikida**, Invalid arguments!!', embeds: [], components: [] }), now), null);
});
