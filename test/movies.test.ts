import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movie, onMovie } from '../src/modules/movies.ts';
import { Store } from '../src/db.ts';

test('movie search, likes and the picker answer with Trakt data', async () => {
  const real = globalThis.fetch;
  process.env.TRAKT_ID = 'test';
  const raw = { title: 'Inception', year: 2010, ids: { slug: 'inception-2010', trakt: 16662, imdb: 'tt1375666' }, overview: 'A thief who steals secrets.', tagline: 'Your mind is the scene of the crime.', rating: 8.76, votes: 71036, runtime: 148, genres: ['action', 'science-fiction'], trailer: 'https://youtube.com/watch?v=x', certification: 'PG-13', colors: { poster: ['#7594A7'] }, images: { poster: ['media.trakt.tv/p.webp'], fanart: ['media.trakt.tv/f.webp'] } };
  globalThis.fetch = (async (url: URL) => {
    const u = String(url);
    if (u.includes('/search/movie')) return new Response(JSON.stringify([{ movie: raw }]));
    if (u.includes('/related')) return new Response(JSON.stringify([{ ...raw, title: 'Looper', ids: { slug: 'looper-2012', trakt: 1 } }]));
    if (u.includes('/movies/popular')) return new Response(JSON.stringify([raw]));
    if (u.includes('/people')) return new Response(JSON.stringify({ cast: [{ person: { name: 'Leonardo DiCaprio' } }], crew: { directing: [{ jobs: ['Director'], person: { name: 'Christopher Nolan' } }] } }));
    return new Response(JSON.stringify(raw));
  }) as typeof fetch;
  try {
    const run = async (title: string | null) => {
      const said: { embeds?: { data: { title?: string; description?: string; image?: { url: string } } }[]; components?: unknown[] }[] = [];
      await movie.run({ userId: 'u1', guildId: 'g', str: () => title, reply: async (r: never) => { said.push(r); } } as never, {} as never);
      return said[0];
    };
    const card = await run('inception');
    assert.match(card.embeds![0].data.title!, /Inception \(2010\)/);
    assert.match(card.embeds![0].data.description!, /Nolan/);
    assert.equal(card.embeds![0].data.image?.url, 'https://media.trakt.tv/f.webp');
    const like = await run('like inception');
    assert.match(like.embeds![0].data.description!, /Looper/);
    const pick = await run(null);
    assert.equal(pick.components!.length, 5);
    // buttons edit the message they're on, they never post a new one
    const calls: string[] = [];
    const press = (customId: string, values: string[] = []) => ({
      customId, values, user: { id: 'u1' }, message: { id: 'm1', components: [] },
      isButton: () => !values.length, isStringSelectMenu: () => !!values.length,
      deferUpdate: async () => { calls.push('deferUpdate'); }, editReply: async () => { calls.push('editReply'); },
      update: async () => { calls.push('update'); }, reply: async () => { calls.push('reply'); }, followUp: async () => { calls.push('followUp'); }, deferReply: async () => { calls.push('deferReply'); },
    }) as never;
    const store = new Store(':memory:');
    await onMovie(store, press('mvl|inception-2010'));
    await onMovie(store, press('mvo|mvl|inception-2010', ['looper-2012']));
    await onMovie(store, press('mvp|u1|roll|g=action;d=;s=0;l=;n=any'));
    assert.ok(!calls.includes('reply') && !calls.includes('deferReply') && !calls.includes('followUp'), calls.join(','));
  } finally {
    globalThis.fetch = real;
    delete process.env.TRAKT_ID;
  }
});
