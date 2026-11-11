import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/db.ts';
import { onCount } from '../src/modules/community.ts';

const msg = (author: string, content: string, out: string[]) => ({
  guildId: 'g', channelId: 'c', content, author: { id: author, bot: false },
  react: async (e: string) => { out.push(e); },
  channel: { isSendable: () => true, send: async (p: { content: string }) => { out.push(p.content); } },
}) as never;

test('the count goes up, refuses doubles and resets on a wrong number', async () => {
  const store = new Store(':memory:');
  store.setKv('count:g', JSON.stringify({ channel: 'c', n: 0, last: null, best: 0 }));
  const out: string[] = [];
  await onCount(store, msg('a', '1', out));
  await onCount(store, msg('b', '2', out));
  await onCount(store, msg('b', 'hello there', out));
  assert.deepEqual(out, ['✅', '✅']);
  await onCount(store, msg('b', '3', out));
  assert.equal(out.at(-2), '❌');
  assert.match(out.at(-1)!, /twice in a row.*stopped at \*\*2\*\*/);
  const saved = JSON.parse(store.getKv('count:g')!);
  assert.equal(saved.n, 0);
  assert.equal(saved.best, 2);
});
