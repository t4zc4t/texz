import { test } from 'node:test';
import assert from 'node:assert/strict';

test('a typed club finds its crest, accents and FC or not', async () => {
  const teams: Record<string, { id: string; displayName: string; color: string }[]> = {
    'usa.1': [{ id: '20232', displayName: 'Inter Miami CF', color: 'f7b5cd' }],
    'esp.1': [{ id: '86', displayName: 'Real Madrid', color: 'ffffff' }, { id: '1068', displayName: 'Atlético Madrid', color: 'cb3524' }],
    'ind.1': [{ id: '9', displayName: 'Mohun Bagan Super Giant', color: '7a1f2b' }],
  };
  globalThis.fetch = (async (u: string) => {
    const code = /soccer\/([^/]+)\/teams/.exec(u)?.[1] ?? '';
    const list = (teams[code] ?? []).map((t) => ({ team: { ...t, logos: [{ href: `https://crest/${t.id}.png` }] } }));
    return { ok: true, json: async () => ({ sports: [{ leagues: [{ teams: list }] }] }) };
  }) as never;
  const { findClub } = await import('../src/feeds/football.ts');
  assert.equal((await findClub('inter miami'))?.id, '20232');
  assert.equal((await findClub('Atletico Madrid'))?.logo, 'https://crest/1068.png');
  assert.equal((await findClub('Real Madrid CF'))?.id, '86');
  assert.equal((await findClub('mohun bagan'))?.id, '9');
  assert.equal(await findClub('Nowhere United'), null);
});
