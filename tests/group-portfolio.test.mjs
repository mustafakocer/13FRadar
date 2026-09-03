import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combinePortfolio } from '../api/_lib/groupPortfolio.js';
import { periodForFiling, dominantPeriod, rotateSnapshot, withDeltas } from '../api/_lib/stocksSnapshot.js';

const P = (cusip, weight, value, shares = 100, extra = {}) => ({ cusip, issuer: cusip, weight, value, shares, ...extra });
const F = (cik, aum, positions, prev = null) => ({ cik, name: cik, reportDate: '2026-06-30', aum, positions, prev });

test('combinePortfolio: aum vs equal weighting', () => {
  const big = F('BIG', 900, [P('AAPL', 100, 900)]);
  const small = F('SMALL', 100, [P('KO', 100, 100)]);
  const aum = combinePortfolio([big, small], 'aum');
  assert.equal(aum.totalAum, 1000);
  assert.deepEqual(aum.positions.map((p) => [p.cusip, Math.round(p.weight)]), [['AAPL', 90], ['KO', 10]]);
  assert.equal(aum.positions[0].value, 900);
  const eq = combinePortfolio([big, small], 'equal');
  assert.deepEqual(eq.positions.map((p) => [p.cusip, p.weight]), [['AAPL', 50], ['KO', 50]]);
  assert.equal(eq.positions[0].value, 500, 'equal mode re-scales dollars to totalAum / n');
  assert.equal(eq.funds[1].share, 0.5);
});

test('combinePortfolio: shared holdings merge holders, puts ignored, trades aggregated', () => {
  const a = F('A', 100, [P('AAPL', 60, 60, 60), P('KO', 40, 40, 40), P('AAPL', 5, 5, 5, { putCall: 'Put' })], [P('AAPL', 50, 50, 50), P('KO', 50, 50, 50)]);
  const b = F('B', 100, [P('AAPL', 100, 100, 100)], [P('AAPL', 80, 80, 80), P('XOM', 20, 20, 20)]);
  const c = combinePortfolio([a, b], 'aum');
  assert.equal(c.positions[0].cusip, 'AAPL');
  assert.equal(c.positions[0].holderCount, 2);
  assert.equal(c.positions[0].weight, 80);
  assert.equal(c.positions[0].holders[0].cik, 'B', 'holders sorted by weight');
  assert.deepEqual(c.trades.ADD.map((t) => [t.cusip, t.funds.map((f) => f.cik)]), [['AAPL', ['A', 'B']]]);
  assert.deepEqual(c.trades.REDUCE.map((t) => t.cusip), ['KO']);
  assert.deepEqual(c.trades.EXIT.map((t) => t.cusip), ['XOM']);
  assert.equal(combinePortfolio([], 'aum').positions.length, 0);
});

test('stocks snapshot helpers', () => {
  assert.equal(periodForFiling('2026-08-14'), '2026-06-30');
  assert.equal(periodForFiling('2026-05-15'), '2026-03-31');
  assert.equal(periodForFiling('2026-02-14'), '2025-12-31');
  assert.equal(dominantPeriod(['2026-08-14', '2026-08-13', '2026-05-15']), '2026-06-30');
  assert.deepEqual(rotateSnapshot({ period: '2026-03-31', rows: [] }, null, '2026-06-30'), { prev: { period: '2026-03-31', rows: [] }, rotated: true });
  const keep = rotateSnapshot({ period: '2026-06-30' }, { period: '2026-03-31' }, '2026-06-30');
  assert.equal(keep.rotated, false);
  assert.equal(keep.prev.period, '2026-03-31');
  assert.equal(rotateSnapshot(null, null, '2026-06-30').prev, null);
  const rows = withDeltas([{ cusip: 'A', funds: 10, value: 100 }, { cusip: 'B', funds: 3, value: 30 }], { rows: [{ cusip: 'A', funds: 8, value: 120 }] });
  assert.deepEqual(rows.map((r) => [r.dFunds, r.dValue]), [[2, -20], [null, null]]);
});
