import { test } from 'node:test';
import assert from 'node:assert/strict';
import { f1Card, matchCard } from '../src/features/matchcard.ts';

test('match and race cards draw without crests', async () => {
  const side = (name: string, score?: string) => ({ name, short: name.slice(0, 3), color: 'a50044', logo: null, score, winner: score === '2' });
  const a = await matchCard({ home: side('Barcelona'), away: side('Real Madrid'), league: 'LaLiga', status: 'Kick-off 21:00' });
  const b = await matchCard({ home: side('Barcelona', '2'), away: side('Real Madrid', '1'), league: 'LaLiga', status: 'FT', goals: [{ who: 'Yamal', clock: "9'", home: true }] });
  const c = await f1Card({ title: 'Test GP', subtitle: 'Race', rows: [{ pos: '1', driver: 'A', team: 'McLaren' }, { pos: '2', driver: 'B', team: 'Ferrari' }] });
  for (const x of [a, b, c]) assert.equal(x.subarray(1, 4).toString(), 'PNG');
});
