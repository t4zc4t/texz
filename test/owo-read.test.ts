import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../src/owo/read.ts';

// real OwO replies with names and ids swapped out
const raw = JSON.parse(readFileSync(new URL('./samples/owo/replies.json', import.meta.url), 'utf8')) as Record<string, { content: string; embeds: unknown[]; components: unknown[] }>;
const s = (k: string) => R.said(raw[k]);

test('team: pets, stats, weapons and streak', () => {
  const t = R.team(s('team'))!;
  assert.equal(t.owner, 'Kunikida');
  assert.equal(t.pets.length, 3);
  const [a] = t.pets;
  assert.equal(a.slot, 1);
  assert.equal(a.level, 28);
  assert.ok(a.xp > 0 && a.xpNeed > a.xp);
  // owo's own rule: xp to the next level is level^4 + 1000
  assert.equal(a.xpNeed, 28 ** 4 + 1000);
  assert.ok(a.hp > 500 && a.pr > 0 && a.pr <= 80);
  assert.match(a.weapon!.id, /^[A-Z0-9]{6}$/);
  assert.ok(a.weapon!.quality > 0);
  assert.equal(t.pages, 2);
  assert.equal(t.best, 13);
});

test('zoo: counts per animal, points and lifetime catches', () => {
  const z = R.zoo(s('zoo'))!;
  assert.equal(z.owner, 'Kunikida');
  assert.ok(z.animals.find((a) => a.animal === 'bee' && a.rank === 'common')!.count > 0);
  // an animal at zero stays listed, it still counts as unlocked
  assert.ok(z.animals.some((a) => a.count === 0));
  assert.ok(z.points! > 0);
  assert.ok(z.caught.C > z.caught.U);
});

test('weapon card: rolls, passive, wear and reroll counts', () => {
  const w = R.weapon(s('weapon'))!;
  assert.match(w.id!, /^[A-Z0-9]{6}$/);
  assert.ok(w.quality! > 0 && w.quality! <= 105);
  assert.equal(w.wear, 'worn');
  assert.ok(w.wpCost! > 0);
  assert.ok(w.rolls.length >= 1);
  assert.equal(w.passives.length, 1);
  assert.ok(w.passives[0].rolls.length >= 1);
  assert.ok(w.rerollAttempts !== null);
});

test('weapon shop pages read as weapon cards with a price', () => {
  const w = R.weapon(s('shop_weapon'))!;
  assert.ok(w.shopId! >= 100);
  assert.ok(w.price! > 0);
  assert.equal(w.id, null);
});

test('weapon list: ids, favourites, empowered and who holds what', () => {
  const l = R.weaponList(s('wlist'))!;
  assert.ok(l.weapons.length > 5);
  assert.ok(l.weapons.some((w) => w.favourite));
  assert.ok(l.weapons.some((w) => w.on));
  assert.ok(l.pages >= 1);
  for (const w of l.weapons) assert.ok(w.rarity && w.type && w.quality > 0, w.id);
});

test('huntbot: traits, essence, the max run and the current hunt', () => {
  const h = R.huntbot(s('huntbot'))!;
  for (const t of R.TRAITS) assert.ok(h.traits[t]!.level >= 0, t);
  assert.ok(h.maxRun!.animals > 0 && h.maxRun!.cost > 0);
  assert.ok(h.hunting!.backInMs > 0);
});

test('huntbot notes: sent, still hunting, back and password', () => {
  const sent = R.huntbotNote(s('hb_sent'));
  assert.equal(sent?.kind, 'sent');
  if (sent?.kind === 'sent') assert.ok(sent.backInMs > 0 && sent.spent > 0);
  assert.equal(R.huntbotNote(s('hb_hunting'))?.kind, 'hunting');
  const back = R.huntbotNote(s('hb_back'));
  assert.equal(back?.kind, 'back');
  if (back?.kind === 'back') assert.ok(back.byRank.common > 0);
  assert.equal(R.huntbotNote(s('hb_password'))?.kind, 'password');
});

test('battles: won, lost and tied', () => {
  const w = R.battle(s('battle_won'))!;
  assert.equal(w.result, 'won');
  assert.equal(w.levels.length, 3);
  assert.ok(w.streak! >= 1);
  const l = R.battle(s('battle_lost'))!;
  assert.equal(l.result, 'lost');
  assert.ok(l.streakEnded! > 0);
  assert.equal(R.battle(s('battle_tie'))!.result, 'tie');
});

test('hunts with gems and the one-animal kind', () => {
  const g = R.hunt(s('hunt_gems'))!;
  assert.ok(g.gems.length > 0 && g.found.length > 1 && g.xp! > 0);
  assert.equal(R.hunt(s('hunt_one'))!.found.length, 1);
});

test('captcha warnings are caught despite the hidden characters', () => {
  assert.ok(R.captcha(s('captcha')));
  assert.equal(R.captcha(s('team')), null);
  assert.equal(R.addressee(s('captcha')).id, '111111111111111111');
});

test('small replies', () => {
  const kinds = { shards: 'shards', cash: 'cash', cookie: 'cookies', daily_wait: 'wait', daily: 'daily', vote: 'vote', pray: 'pray', sacrifice: 'sacrifice', upgrade: 'upgrade', run: 'minigame', piku: 'minigame', alastor: 'pet', checklist: 'checklist', quests_done: 'checklist', crate: 'opened', slowdown: 'waitUntil' } as const;
  for (const [k, kind] of Object.entries(kinds)) assert.equal(R.note(s(k))?.kind, kind, k);
  const up = R.note(s('upgrade'));
  if (up?.kind === 'upgrade') assert.equal(up.trait, 'gain');
  // a team card must not look like a pet streak
  assert.equal(R.note(s('team')), null);
});

test('inventory items by id', () => {
  const inv = R.inventory(s('inv'))!;
  assert.ok(inv.size > 5);
  assert.ok([...inv.values()].every((n) => n > 0));
});

test('who OwO is talking to', () => {
  assert.equal(R.addressee(s('shards')).name, 'Kunikida');
  assert.equal(R.addressee(s('checklist')).id, '111111111111111111');
  assert.equal(R.addressee(s('battle_won')).name, 'Kunikida');
});
