import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.mjs'; // points GURU_HISTORY_FILE at the fixture

const { ownershipTrend, trendRange, TREND_RANGES } = await import('../api/_lib/guruStockHistory.js');

// Ownership of one security over time, pivoted out of the per-fund history.

test('a security held by several funds reports a holder count per quarter', () => {
  const trend = ownershipTrend({ ticker: 'AMZN' });
  assert.ok(trend, 'AMZN is held in the fixture history');
  assert.ok(trend.quarters.length >= 1);
  for (const q of trend.quarters) {
    assert.match(q.reportDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(q.holders >= 1);
    assert.ok(q.value > 0);
    assert.ok(q.avgWeight > 0);
  }
  assert.ok(trend.funds >= 1, 'and says how many funds the history covers');
});

test('quarters come back oldest first, so a chart reads left to right', () => {
  const { quarters } = ownershipTrend({ ticker: 'AMZN' });
  const dates = quarters.map((q) => q.reportDate);
  assert.deepEqual(dates, [...dates].sort());
});

test('holder counts are per quarter, not carried forward', () => {
  // Chevron is a Berkshire-only position in the fixture; Amazon is held by
  // more than one fund, so the two must not report the same holder count.
  const cvx = ownershipTrend({ ticker: 'CVX' });
  const amzn = ownershipTrend({ ticker: 'AMZN' });
  assert.ok(cvx.quarters.every((q) => q.holders === 1));
  assert.ok(amzn.quarters.some((q) => q.holders > 1), 'a shared name has more than one holder');
});

test('a security can be found by CUSIP when no ticker was resolved', () => {
  const byTicker = ownershipTrend({ ticker: 'CVX' });
  const byCusip = ownershipTrend({ cusip: byTicker.cusip });
  assert.deepEqual(byCusip.quarters, byTicker.quarters);
});

test('a name the history has never seen has no trend, rather than an empty one', () => {
  assert.equal(ownershipTrend({ ticker: 'TSLA' }), null);
  assert.equal(ownershipTrend({}), null);
});

test('ranges cut the tail, and "all" keeps everything the history holds', () => {
  const trend = ownershipTrend({ ticker: 'AMZN' });
  assert.equal(TREND_RANGES['1y'], 4);
  const oneYear = trendRange(trend, '1y');
  assert.ok(oneYear.quarters.length <= 4);
  assert.deepEqual(
    oneYear.quarters,
    trend.quarters.slice(-Math.min(4, trend.quarters.length)),
    'the most recent quarters, not the oldest'
  );
  assert.deepEqual(trendRange(trend, 'all').quarters, trend.quarters);
  assert.deepEqual(trendRange(trend, 'nonsense').quarters, trend.quarters, 'an unknown range shows everything');
  assert.equal(trendRange(null), null);
});
