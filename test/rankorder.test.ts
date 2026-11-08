import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixRankOrder } from '../src/modules/levels.ts';

// a pretend server: the bot at the top, rank roles scattered with the top rank at the bottom
function server() {
  const roles = new Map<string, { id: string; name: string; position: number; managed: boolean }>();
  const add = (id: string, position: number) => roles.set(id, { id, name: id, position, managed: false });
  add('g1', 0); add('member', 1); add('legend', 2); add('stray', 3); add('vip', 4); add('detective', 5); add('bot', 6);
  const guild = {
    id: 'g1',
    roles: {
      cache: Object.assign(roles, { find: () => null }),
      fetch: async () => roles,
      setPositions: async (list: { role: string; position: number }[]) => { for (const x of list) roles.get(x.role)!.position = x.position; },
    },
    members: { fetchMe: async () => ({ roles: { highest: roles.get('bot') } }) },
  };
  return { guild, roles };
}

test('rank roles end up in level order right under the bot', async () => {
  const { guild, roles } = server();
  const ok = await fixRankOrder(guild as never, { 1: 'stray', 20: 'detective', 100: 'legend' });
  assert.equal(ok, true);
  const p = (id: string) => roles.get(id)!.position;
  assert.ok(p('stray') < p('detective') && p('detective') < p('legend'));
  assert.equal(p('legend'), p('bot') - 1);
  assert.ok(p('member') < p('stray') && p('vip') < p('stray'));
});
