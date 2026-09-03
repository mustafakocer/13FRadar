import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCashLike, cashLikeSummary, effectivePositions } from '../client/src/lib/cashLike.js';

test('isCashLike: tickers and names', () => {
  assert.equal(isCashLike({ ticker: 'SGOV', issuer: 'ISHARES TR', class: '0-3 MONTH TREAS' }), true);
  assert.equal(isCashLike({ ticker: null, issuer: 'SPDR BLOOMBERG 1-3 MONTH T-BILL ETF', class: 'ETF' }), true);
  assert.equal(isCashLike({ ticker: null, issuer: 'ISHARES TR SHORT TREASURY BD', class: 'ETF' }), true);
  assert.equal(isCashLike({ ticker: 'VGSH', issuer: 'VANGUARD SHORT-TERM TREASURY ETF', class: 'ETF' }), false);
  assert.equal(isCashLike({ ticker: 'SHY', issuer: 'ISHARES 1-3 YEAR TREASURY BOND', class: 'ETF' }), false);
  assert.equal(isCashLike({ ticker: 'AAPL', issuer: 'APPLE INC', class: 'COM' }), false);
  assert.equal(isCashLike({ ticker: 'BIL', issuer: 'SPDR', class: 'ETF', putCall: 'Put' }), false);
});

test('cashLikeSummary / effectivePositions', () => {
  const s = cashLikeSummary([{ ticker: 'SGOV', value: 5e9, weight: 4 }, { ticker: 'AAPL', value: 1e9, weight: 1 }]);
  assert.deepEqual([s.value, s.weight, s.items.length], [5e9, 4, 1]);
  assert.ok(Math.abs(effectivePositions([{ weight: 50 }, { weight: 30 }, { weight: 20 }]) - 1 / 0.38) < 1e-9);
  assert.equal(effectivePositions([]), null);
});
