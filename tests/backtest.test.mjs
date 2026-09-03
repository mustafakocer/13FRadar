import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignGroupSnapshots, runBacktest } from '../api/_lib/backtest.js';
import { priceAt } from '../api/_lib/performance.js';

test('alignGroupSnapshots: aum vs equal, missing quarter drops the member, re-normalised to 100', () => {
  const A = { cik: 'A', name: 'A', snaps: [{ reportDate: '2025-06-30', aum: 900, positions: [{ ticker: 'AAPL', weight: 50, value: 450 }, { ticker: 'KO', weight: 30, value: 270 }] }, { reportDate: '2025-09-30', aum: 900, positions: [{ ticker: 'AAPL', weight: 100, value: 900 }] }] };
  const B = { cik: 'B', name: 'B', snaps: [{ reportDate: '2025-06-30', aum: 100, positions: [{ ticker: 'NVDA', weight: 100, value: 100 }] }] };
  const aum = alignGroupSnapshots([A, B], 'aum');
  assert.equal(aum.length, 2);
  const q1 = Object.fromEntries(aum[0].positions.map((p) => [p.ticker, p.weight]));
  assert.ok(Math.abs(q1.AAPL - 0.9 * (50 / 80) * 100) < 1e-9);
  assert.ok(Math.abs(q1.NVDA - 10) < 1e-9);
  assert.ok(Math.abs(aum[0].positions.reduce((s, p) => s + p.weight, 0) - 100) < 1e-9);
  assert.deepEqual(aum[1].members, ['A']);
  const eq = alignGroupSnapshots([A, B], 'equal');
  assert.ok(Math.abs(Object.fromEntries(eq[0].positions.map((p) => [p.ticker, p.weight])).NVDA - 50) < 1e-9);
});

test('runBacktest: release-date rebalancing, stats, benchmark', () => {
  const S = (pairs) => pairs.map(([date, close]) => ({ date, close }));
  const px = (sym, date) => priceAt({
    AAPL: S([['2025-08-14', 100], ['2025-11-14', 120], ['2026-02-14', 90]]),
    SPY: S([['2025-08-14', 500], ['2025-11-14', 525], ['2026-02-14', 525]]),
  }[sym], date);
  const snaps = [{ reportDate: '2025-06-30', positions: [{ ticker: 'AAPL', weight: 100 }] }, { reportDate: '2025-09-30', positions: [{ ticker: 'AAPL', weight: 100 }] }];
  const r = runBacktest(snaps, px, { endDate: '2026-02-14' });
  assert.equal(r.start, '2025-08-14');
  assert.equal(r.end, '2026-02-14');
  assert.equal(r.quarters, 2);
  assert.ok(Math.abs(r.total - (1.2 * 0.75 - 1)) < 1e-12);
  assert.ok(Math.abs(r.maxDrawdown - (0.9 / 1.2 - 1)) < 1e-12);
  assert.ok(Math.abs(r.benchTotal - 0.05) < 1e-12);
  assert.equal(r.coverage, 1);
  assert.ok(r.cagr < 0);
  const empty = runBacktest([], px, { endDate: '2026-02-14' });
  assert.equal(empty.total, null);
});
