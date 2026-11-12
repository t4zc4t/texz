import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movie } from '../src/modules/movies.ts';

test('movie search, likes and the picker answer with TMDB data', async () => {
  const real = globalThis.fetch;
  process.env.TMDB_TOKEN = 'test';
  const film = { id: 27205, title: 'Inception', original_title: 'Inception', overview: 'A thief who steals secrets.', release_date: '2010-07-15', vote_average: 8.4, vote_count: 37000, poster_path: '/p.jpg', backdrop_path: '/b.jpg', genre_ids: [28, 878], original_language: 'en' };
  globalThis.fetch = (async (url: URL) => {
    const u = String(url);
    if (u.includes('/search/movie')) return new Response(JSON.stringify({ results: [film] }));
    if (u.includes('/recommendations')) return new Response(JSON.stringify({ results: [{ ...film, id: 157336, title: 'Interstellar' }] }));
    return new Response(JSON.stringify({ ...film, runtime: 148, tagline: 'Your mind is the scene of the crime.', genres: [{ id: 28, name: 'Action' }], credits: { cast: [{ name: 'Leonardo DiCaprio' }], crew: [{ name: 'Christopher Nolan', job: 'Director' }] }, videos: { results: [{ key: 'abc', site: 'YouTube', type: 'Trailer', official: true }] }, 'watch/providers': { results: { IN: { link: 'https://x', flatrate: [{ provider_name: 'Netflix' }] } } } }));
  }) as typeof fetch;
  try {
    const run = async (title: string | null) => {
      const said: { embeds?: { data: { title?: string; description?: string } }[]; components?: unknown[] }[] = [];
      await movie.run({ userId: 'u1', guildId: 'g', str: () => title, reply: async (r: never) => { said.push(r); } } as never, {} as never);
      return said[0];
    };
    const card = await run('inception');
    assert.match(card.embeds![0].data.title!, /Inception \(2010\)/);
    assert.match(card.embeds![0].data.description!, /Nolan/);
    assert.match(card.embeds![0].data.description!, /Netflix/);
    const like = await run('like inception');
    assert.match(like.embeds![0].data.description!, /Interstellar/);
    const pick = await run(null);
    assert.equal(pick.components!.length, 5);
  } finally {
    globalThis.fetch = real;
    delete process.env.TMDB_TOKEN;
  }
});
