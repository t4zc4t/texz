import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agency, contrast, isOut, mafia } from '../src/features/f1theme.ts';

// every text colour the F1 cards draw, on every surface it lands on
for (const t of [mafia, agency]) {
  test(`${t.name} text is readable`, () => {
    for (const bg of [t.bg, t.panel, t.panel2]) {
      for (const [name, fg] of Object.entries({ text: t.text, soft: t.soft, dim: t.dim, redText: t.redText, accent: t.accent, out: t.out })) {
        const r = contrast(fg, bg);
        assert.ok(r >= 4.5, `${t.name} ${name} ${fg} on ${bg} is ${r.toFixed(2)}`);
      }
    }
  });
}

test('retirements are spotted and never use the theme red', () => {
  assert.ok(isOut('DNF') && isOut('Retired') && isOut('DSQ'));
  assert.ok(!isOut('+12.410s') && !isOut('+1 lap'));
  assert.notEqual(mafia.out, mafia.red);
  assert.notEqual(agency.out, agency.red);
});
