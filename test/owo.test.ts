import { test } from 'node:test';
import assert from 'node:assert/strict';

test('pray on cooldown reminds when OwO says, not five minutes later', async () => {
  const { Store } = await import('../src/db.ts');
  const { onReplyForTest } = await import('../src/watch.ts');
  const store = new Store(':memory:');
  const before = Date.now();
  onReplyForTest(store, 'u1', 'pray', '⏱ | Nyx, You can pray again in 2m 10s');
  const at = store.reminderOf('u1', 'pray')!.due_at;
  assert.ok(at - before >= 129_000 && at - before <= 131_500, `due in ${at - before}ms`);
});
