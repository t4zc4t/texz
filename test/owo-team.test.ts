import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseOf, planFor, statsAt, winsToCatchUp, type Arm, type Candidate } from '../src/owo/team.ts';

const pet = (animal: string, level: number, base: Candidate['base']): Candidate => ({ animal, name: animal, level, xp: 0, base, exact: true });
const owl = pet('gowl', 31, { hp: 10, wp: 1, str: 1, mag: 2, pr: 3, mr: 3 });
const fox = pet('gfox', 31, { hp: 4, wp: 3, str: 9, mag: 1, pr: 1, mr: 2 });
const deer = pet('gdeer', 31, { hp: 3, wp: 3, str: 1, mag: 11, pr: 1, mr: 1 });
const sword: Arm = { id: 'SWORD1', type: 'Great Sword', quality: 84, wpCost: 117 };
const tithe: Arm = { id: 'TITHE1', type: 'Soul Tithe', quality: 89, wpCost: 53 };
const aegis: Arm = { id: 'AEGIS1', type: "Defender's Aegis", quality: 92, wpCost: 156 };

test('base stats come back out of a pet\'s own numbers', () => {
  const s = statsAt(owl.base, 31);
  const b = baseOf({ level: 31, hp: s.hp, wp: s.wp, str: s.str, mag: s.mag, pr: Math.round(s.pr * 100), mr: Math.round(s.mr * 100) });
  assert.equal(b.hp, 10);
  assert.equal(b.str, 1);
  assert.ok(Math.abs(b.pr - 3) < 0.3);
});

test('catch-up wins use OwO\'s boost and shrink as the gap closes', () => {
  assert.equal(winsToCatchUp(31, 0, 31), 0);
  const near = winsToCatchUp(28, 0, 31);
  const far = winsToCatchUp(1, 0, 31);
  assert.ok(near > 0 && far > near);
});

test('a team that is already right gets no advice', () => {
  const plan = planFor([{ animal: 'gowl', arm: aegis }, { animal: 'gfox', arm: sword }, { animal: 'gdeer', arm: tithe }], [owl, fox, deer], [aegis, sword, tithe], 75)!;
  assert.equal(plan.changes.length, 0);
});

test('weapons on the wrong pets get swapped, not the pets judged on level', () => {
  // the magic weapon on the strength pet and the other way round
  const plan = planFor([{ animal: 'gowl', arm: aegis }, { animal: 'gfox', arm: tithe }, { animal: 'gdeer', arm: sword }], [owl, fox, deer], [aegis, sword, tithe], 75)!;
  assert.ok(plan.changes.length >= 2);
  assert.ok(plan.changes.every((c) => c.kind === 'swap'));
  assert.ok(plan.changes.some((c) => c.cmds.includes('w w TITHE1 gdeer')));
});

test('a low level pet that is better at equal level is offered with its catch-up cost', () => {
  const panther = pet('gpanther', 30, { hp: 4, wp: 3, str: 16, mag: 1, pr: 1, mr: 2 });
  const plan = planFor([{ animal: 'gowl', arm: aegis }, { animal: 'gfox', arm: sword }, { animal: 'gdeer', arm: tithe }], [owl, fox, deer, panther], [aegis, sword, tithe], 75)!;
  const change = plan.changes.find((c) => c.kind === 'pet');
  assert.ok(change && /gpanther/.test(change.text) && /wins/.test(change.text));
});

test('a pet too far behind is only an idea for later', () => {
  const baby = pet('gpanther', 2, { hp: 4, wp: 3, str: 30, mag: 1, pr: 1, mr: 2 });
  const plan = planFor([{ animal: 'gowl', arm: aegis }, { animal: 'gfox', arm: sword }, { animal: 'gdeer', arm: tithe }], [owl, fox, deer, baby], [aegis, sword, tithe], 20)!;
  assert.ok(!plan.changes.some((c) => /gpanther/.test(c.text)));
  assert.ok(plan.later.some((l) => l.c.animal === 'gpanther'));
});

test('a better copy of the same weapon is pointed out', () => {
  const better: Arm = { ...sword, id: 'SWORD2', quality: 95 };
  const plan = planFor([{ animal: 'gowl', arm: aegis }, { animal: 'gfox', arm: sword }, { animal: 'gdeer', arm: tithe }], [owl, fox, deer], [aegis, sword, better, tithe], 75)!;
  assert.ok(plan.changes.some((c) => c.cmds.includes('w w SWORD2 gfox')));
});
