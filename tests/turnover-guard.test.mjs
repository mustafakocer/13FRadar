import test from 'node:test';
import assert from 'node:assert/strict';
import { turnover, turnoverOutliers, TURNOVER_OUTLIER } from '../api/_lib/turnover.js';

// #8 — one turnover definition, and a guard that names the quarters an
// amendment-as-a-quarter bug would produce.
test('an amendment read as a quarter shows up as a >60% outlier; a real rotation does not', () => {
  const book = (names) => ({ aum: names.length * 100, positions: names.map((n) => ({ cusip: n, shares: 10, value: 100 })) });
  const full = book(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
  const amendmentOnly = book(['K']);
  const bug = turnover(full, amendmentOnly).turnover; // the whole book "exited", one name "opened"
  assert.ok(bug > TURNOVER_OUTLIER, `${bug}% reads as the bug it is`);
  // a fifth of the book replaced in one quarter: 2 exits + 2 opens over the
  // average book is 40% — a big quarter for a discretionary fund, under the line
  const rotated = book(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'Y', 'Z']);
  const real = turnover(full, rotated).turnover;
  assert.equal(real, 40);
  assert.ok(real < TURNOVER_OUTLIER, `${real}% is a real rotation, under the line`);
  const quarters = [
    { reportDate: '2025-03-31', turnover: 199.98 },
    { reportDate: '2025-06-30', turnover: 197.72 },
    { reportDate: '2025-09-30', turnover: 1.73 },
    { reportDate: '2026-06-30', turnover: null },
  ];
  assert.deepEqual(turnoverOutliers(quarters), [
    { reportDate: '2025-03-31', turnover: 199.98 },
    { reportDate: '2025-06-30', turnover: 197.72 },
  ]);
  assert.deepEqual(turnoverOutliers([]), []);
});

test('any trade is a positive turnover, so the number can never sit next to "1 new · 1 exited" as 0%', () => {
  const prev = { aum: 1_000_000, positions: [{ cusip: 'A', shares: 1000, value: 999_000 }, { cusip: 'B', shares: 1, value: 1000 }] };
  const cur = { aum: 1_000_000, positions: [{ cusip: 'A', shares: 1000, value: 999_000 }, { cusip: 'C', shares: 1, value: 1000 }] };
  const t = turnover(prev, cur);
  assert.deepEqual([t.newCount, t.exitCount], [1, 1]);
  assert.ok(t.turnover > 0);
  assert.equal(t.traded, 2000);
});
