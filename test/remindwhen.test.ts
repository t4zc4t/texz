import test from 'node:test';
import assert from 'node:assert';
import { whenOf } from '../src/modules/remind.ts';

test('reminders read plain words', () => {
  const near = (at: number, ms: number) => Math.abs(at - Date.now() - ms) < 5000;
  let w = whenOf('me in 2h to drink water', 'Asia/Kolkata')!;
  assert.ok(near(w.at, 7_200_000)); assert.equal(w.note, 'drink water');
  w = whenOf('30 restart huntbot', 'Asia/Kolkata')!;
  assert.ok(near(w.at, 1_800_000)); assert.equal(w.note, 'restart huntbot');
  w = whenOf('1h30m stretch', 'Asia/Kolkata')!;
  assert.ok(near(w.at, 5_400_000)); assert.equal(w.note, 'stretch');
  w = whenOf('at 9pm call mum', 'Asia/Kolkata')!;
  assert.equal(new Date(w.at).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }), '21:00'); assert.equal(w.note, 'call mum');
  w = whenOf('tomorrow 8am gym', 'Asia/Kolkata')!;
  assert.ok(w.at - Date.now() > 3_600_000); assert.equal(w.note, 'gym');
  assert.equal(whenOf('drink water', 'Asia/Kolkata'), null);
});
