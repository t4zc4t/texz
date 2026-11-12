import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actions } from '../src/modules/actions.ts';

test('every interaction answers, with a gif when nekos.best does', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ results: [{ url: 'https://nekos.best/api/v2/hug/x.gif', anime_name: 'Bungo Stray Dogs' }] }))) as typeof fetch;
  try {
    for (const c of actions.commands.filter((x) => !['act', 'bonds', 'emote'].includes(x.name))) {
      const said: unknown[] = [];
      const ctx = { userId: 'u1', guildId: null, guild: null, member: null, displayName: 'Dazai', user: () => null, str: () => null, reply: async (r: unknown) => { said.push(r); } };
      await c.run(ctx as never, {} as never);
      const r = said[0] as { content?: string; embeds?: { data: { description?: string; image?: { url: string } } }[] };
      // the ones that need someone ask who, the rest go ahead alone
      assert.ok(r.content?.includes('Who?') || r.embeds?.[0].data.description?.includes('Dazai'), c.name);
      if (r.embeds) assert.equal(r.embeds[0].data.image?.url, 'https://nekos.best/api/v2/hug/x.gif');
    }
  } finally {
    globalThis.fetch = real;
  }
});
