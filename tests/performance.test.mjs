import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceAt, addDays, releaseDate, periodReturn, quarterlySeries, compound, equityCurve, maxDrawdown, cagr, percentile, scoreFund } from '../api/_lib/performance.js';

const series = (pairs) => pairs.map(([date, close]) => ({ date, close }));
const AAPL = series([['2025-06-30', 100], ['2025-09-30', 110], ['2025-12-31', 121], ['2026-03-31', 121], ['2026-06-30', 133.1]]);
const KO = series([['2025-06-30', 50], ['2025-09-30', 50], ['2025-12-31', 45], ['2026-03-31', 45], ['2026-06-30', 45]]);
const SPY = series([['2025-06-30', 500], ['2025-08-14', 510], ['2025-09-30', 525], ['2025-11-14', 530], ['2025-12-31', 550], ['2026-03-31', 550], ['2026-06-30', 560]]);
const px = (sym, date) => priceAt({ AAPL, KO, SPY }[sym], date);

test('priceAt: on/before date within gap, none before start', () => {
  assert.equal(priceAt(AAPL, '2025-09-30'), 110);
  assert.equal(priceAt(AAPL, '2025-10-03'), 110);
  assert.equal(priceAt(AAPL, '2025-11-30'), null, 'gap > 10 days');
  assert.equal(priceAt(AAPL, '2025-01-01'), null);
  assert.equal(priceAt([], '2025-01-01'), null);
  assert.equal(addDays('2025-06-30', 45), '2025-08-14');
  assert.equal(releaseDate('2025-12-31'), '2026-02-14');
});

test('periodReturn: weighted, re-normalised over covered weight', () => {
  const r = periodReturn([{ ticker: 'AAPL', weight: 60 }, { ticker: 'KO', weight: 20 }, { ticker: null, weight: 20 }], px, '2025-06-30', '2025-09-30');
  assert.ok(Math.abs(r.ret - (60 * 0.1 + 20 * 0) / 80) < 1e-12);
  assert.equal(r.coverage, 0.8);
  assert.equal(periodReturn([{ ticker: 'ZZZ', weight: 100 }], px, '2025-06-30', '2025-09-30').ret, null);
});

test('quarterlySeries: quarter-end vs release mode, benchmark, chaining, curve, drawdown, cagr', () => {
  const snaps = [
    { reportDate: '2025-06-30', positions: [{ ticker: 'AAPL', weight: 100 }] },
    { reportDate: '2025-09-30', positions: [{ ticker: 'KO', weight: 100 }] },
    { reportDate: '2025-12-31', positions: [{ ticker: 'AAPL', weight: 50 }, { ticker: 'KO', weight: 50 }] },
  ];
  const q = quarterlySeries(snaps, px, { benchmark: 'SPY', endDate: '2026-06-30' });
  assert.deepEqual(q.map((x) => [x.from, x.to]), [['2025-06-30', '2025-09-30'], ['2025-09-30', '2025-12-31'], ['2025-12-31', '2026-03-31']]);
  assert.ok(Math.abs(q[0].ret - 0.1) < 1e-12);
  assert.ok(Math.abs(q[1].ret - -0.1) < 1e-12);
  assert.ok(Math.abs(q[2].ret - 0) < 1e-12);
  assert.ok(Math.abs(q[0].bench - 0.05) < 1e-12);
  assert.ok(Math.abs(compound(q, 3) - (1.1 * 0.9 * 1.0 - 1)) < 1e-12);
  assert.ok(Math.abs(compound(q, 2) - (0.9 * 1.0 - 1)) < 1e-12, 'last n quarters');
  assert.equal(compound(q, 4), null, 'not enough quarters');
  const rel = quarterlySeries(snaps.slice(0, 2), px, { mode: 'release', benchmark: 'SPY' });
  assert.deepEqual([rel[0].from, rel[0].to], ['2025-08-14', '2025-11-14']);
  assert.ok(Math.abs(rel[0].bench - (530 / 510 - 1)) < 1e-12);
  const curve = equityCurve(q);
  assert.equal(curve.length, 3);
  assert.ok(Math.abs(curve[1].value - 0.99) < 1e-12);
  assert.ok(Math.abs(maxDrawdown(curve) - (0.99 / 1.1 - 1)) < 1e-12);
  assert.ok(Math.abs(cagr(0.21, 2) - 0.1) < 1e-12);
});

test('percentile / scoreFund', () => {
  assert.equal(percentile(3, [1, 2, 3, 4, 5]), 50);
  assert.equal(percentile(5, [1, 2, 3, 4, 5]), 90);
  const all = [{ ret1y: 0.1, ret3y: 0.3 }, { ret1y: 0.2, ret3y: null }, { ret1y: 0.3, ret3y: 0.1 }];
  assert.equal(scoreFund(all[1], all), 50);
  assert.equal(scoreFund({ ret1y: null, ret3y: null }, all), null);
});
