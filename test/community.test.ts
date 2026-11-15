import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/db.ts';
import { onCount } from '../src/modules/community.ts';

const msg = (author: string, content: string, out: string[]) => ({
  guildId: 'g', channelId: 'c', content, author: { id: author, bot: false }, member: null,
  react: async (e: string) => { out.push(e); },
  delete: async () => { out.push(`deleted:${content}`); },
  channel: { isSendable: () => true, send: async (p: { content: string }) => { out.push(p.content); return null; } },
}) as never;

test('the count goes up, clears chatter and doubles, and resets on a wrong number', async () => {
  const store = new Store(':memory:');
  store.setKv('count:g', JSON.stringify({ channel: 'c', n: 0, last: null, best: 0 }));
  const out: string[] = [];
  await onCount(store, msg('a', '1', out));
  await onCount(store, msg('b', '2', out));
  assert.deepEqual(out, ['✅', '✅']);
  await onCount(store, msg('b', 'hello there', out));
  assert.equal(out[2], 'deleted:hello there');
  await onCount(store, msg('b', '3', out));
  assert.ok(out.includes('deleted:3'));
  assert.equal(JSON.parse(store.getKv('count:g')!).n, 2);
  await onCount(store, msg('a', '7', out));
  assert.ok(out.includes('❌'));
  assert.match(out.at(-1)!, /said \*\*7\*\*.*stopped at \*\*2\*\*/);
  const saved = JSON.parse(store.getKv('count:g')!);
  assert.equal(saved.n, 0);
  assert.equal(saved.best, 2);
  assert.equal(JSON.parse(store.getKv('countme:g:a')!).ruins, 1);
});

test('a pardon keeps the count going', async () => {
  const store = new Store(':memory:');
  store.setKv('count:g', JSON.stringify({ channel: 'c', n: 5, last: 'b', best: 5 }));
  store.setKv('countme:g:a', JSON.stringify({ n: 3, ruins: 0, saves: 1, tier: 0 }));
  const out: string[] = [];
  await onCount(store, msg('a', '9', out));
  assert.equal(out[0], '🛡️');
  assert.equal(JSON.parse(store.getKv('count:g')!).n, 5);
  assert.equal(JSON.parse(store.getKv('countme:g:a')!).saves, 0);
});
