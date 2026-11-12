import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movie } from '../src/modules/movies.ts';

test('movie search, likes and the picker answer with Trakt data', async () => {
  const real = globalThis.fetch;
  process.env.TRAKT_ID = 'test';
  const raw = { title: 'Inception', year: 2010, ids: { slug: 'inception-2010', trakt: 16662, imdb: 'tt1375666' }, overview: 'A thief who steals secrets.', tagline: 'Your mind is the scene of the crime.', rating: 8.76, votes: 71036, runtime: 148, genres: ['action', 'science-fiction'], trailer: 'https://youtube.com/watch?v=x', certification: 'PG-13', colors: { poster: ['#7594A7'] }, images: { poster: ['media.trakt.tv/p.webp'], fanart: ['media.trakt.tv/f.webp'] } };
  globalThis.fetch = (async (url: URL) => {
    const u = String(url);
    if (u.includes('/search/movie')) return new Response(JSON.stringify([{ movie: raw }]));
    if (u.includes('/related')) return new Response(JSON.stringify([{ ...raw, title: 'Looper', ids: { slug: 'looper-2012', trakt: 1 } }]));
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
  } finally {
    globalThis.fetch = real;
    delete process.env.TRAKT_ID;
  }
});
