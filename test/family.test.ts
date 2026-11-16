import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/db.ts';
import { relation } from '../src/modules/family.ts';

const put = (store: Store, u: string, f: object) => store.setKv(`fam:g:${u}`, JSON.stringify({ parents: [], children: [], ...f }));

test('relations across a small family', () => {
  const store = new Store(':memory:');
  // gp → p1, p2 ; p1 → a ; p2 → b ; a married to s ; s's parent sp
  put(store, 'gp', { children: ['p1', 'p2'] });
  put(store, 'p1', { parents: ['gp'], children: ['a'] });
  put(store, 'p2', { parents: ['gp'], children: ['b'] });
  put(store, 'a', { parents: ['p1'], spouse: 's' });
  put(store, 'b', { parents: ['p2'] });
  put(store, 's', { spouse: 'a', parents: ['sp'] });
  put(store, 'sp', { children: ['s'] });
  assert.equal(relation(store, 'g', 'a', 'p1'), 'parent');
  assert.equal(relation(store, 'g', 'a', 'gp'), 'grandparent');
  assert.equal(relation(store, 'g', 'a', 'b'), 'first cousin');
  assert.equal(relation(store, 'g', 'a', 'p2'), 'aunt or uncle');
  assert.equal(relation(store, 'g', 'p2', 'a'), 'niece or nephew');
  assert.equal(relation(store, 'g', 'a', 's'), 'spouse');
  assert.equal(relation(store, 'g', 'a', 'sp'), 'parent-in-law');
  assert.equal(relation(store, 'g', 'p1', 's'), 'child-in-law');
  assert.equal(relation(store, 'g', 'a', 'nobody'), null);
});
