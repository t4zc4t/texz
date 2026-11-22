import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as R from '../src/owo/read.ts';
import { OwoState } from '../src/owo/state.ts';
import { apply } from '../src/owo/listen.ts';
import { battleStats, catchStats, collectibles, levelForecast } from '../src/owo/stats.ts';
import { wallCard } from '../src/owo/wallcard.ts';
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
  const f = levelForecast(st, 'u');
  assert.ok(f && f.xpPer > 0 && f.pets.length > 0);
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
  const png = await wallCard({ wallpaper: img.toBuffer('image/png'), avatar: null, name: 'Kunikida', title: 'your title', wallName: '205 Sakura Night', team: ['owl', 'deer'], lines: [['Zoo points', '1,234']] });
  assert.ok(png.length > 1000);
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
