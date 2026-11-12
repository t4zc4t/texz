import test from 'node:test';
import assert from 'node:assert';
import { PermissionFlagsBits as P } from 'discord.js';
import { GATED, unlocksUpTo, perkLine } from '../src/modules/levels.ts';

test('rank perks stack up the ranks', () => {
  assert.equal(unlocksUpTo(0), 0n);
  assert.ok(unlocksUpTo(3) & P.UseExternalEmojis);
  assert.equal(unlocksUpTo(3) & P.EmbedLinks, 0n);
  assert.ok(unlocksUpTo(6) & P.EmbedLinks);
  assert.ok(unlocksUpTo(12) & P.AttachFiles);
  assert.ok(unlocksUpTo(12) & P.UseExternalEmojis);
  assert.equal(unlocksUpTo(99), GATED);
  assert.equal(GATED & P.SendMessages, 0n);
  assert.match(perkLine('Errand Runner'), /gifs/);
});
