import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accumulateFiler, finalizeAgg, consensusScore, sicToSector, latestPublicFloat, floatBand } from '../api/_lib/universeAgg.js';

const P = (cusip, value, shares, extra = {}) => ({ cusip, issuer: cusip, value, shares, weight: 1, ...extra });

test('accumulateFiler: adding / reducing / new / exit / hold, net flow, puts ignored, no-prev filers count only funds', () => {
  const agg = new Map();
  accumulateFiler(agg, [P('AAPL', 1100, 110), P('KO', 250, 50), P('NEW', 100, 10), P('AAPL', 5, 1, { putCall: 'Put' })], [P('AAPL', 1000, 100), P('KO', 500, 100), P('OLD', 300, 30)]);
  accumulateFiler(agg, [P('AAPL', 200, 20)], null);
  const rows = finalizeAgg(agg);
  const aapl = rows.find((r) => r.cusip === 'AAPL');
  assert.deepEqual([aapl.funds, aapl.adding, aapl.reducing, aapl.diffFunds, aapl.value], [2, 1, 0, 1, 1300]);
  assert.equal(aapl.netFlow, 100, '10 more shares at $10');
  const ko = rows.find((r) => r.cusip === 'KO');
  assert.deepEqual([ko.reducing, ko.netFlow], [1, -250]);
  const nw = rows.find((r) => r.cusip === 'NEW');
  assert.deepEqual([nw.newCount, nw.adding, nw.netFlow], [1, 1, 100]);
  const old = rows.find((r) => r.cusip === 'OLD');
  assert.deepEqual([old.funds, old.exitCount, old.reducing, old.netFlow], [0, 1, 1, -300]);
  assert.equal(aapl.consensus, 100);
  assert.equal(consensusScore({ adding: 3, reducing: 1 }), 50);
  assert.equal(consensusScore({ adding: 0, reducing: 0 }), null);
});

test('accumulateFiler: split is a hold', () => {
  const agg = new Map();
  accumulateFiler(agg, [P('NVDA', 1000, 1000)], [P('NVDA', 1000, 100)]);
  const r = finalizeAgg(agg)[0];
  assert.deepEqual([r.holding, r.adding, r.reducing], [1, 0, 0]);
});

test('sicToSector / latestPublicFloat / floatBand', () => {
  assert.equal(sicToSector(7372), 'Technology');
  assert.equal(sicToSector(3571), 'Technology');
  assert.equal(sicToSector(2834), 'Healthcare');
  assert.equal(sicToSector(6021), 'Financials');
  assert.equal(sicToSector(6798), 'Real Estate');
  assert.equal(sicToSector(1311), 'Energy');
  assert.equal(sicToSector(3711), 'Industrials');
  assert.equal(sicToSector(5812), 'Consumer Discretionary');
  assert.equal(sicToSector(null), null);
  assert.equal(sicToSector('abc'), null);
  const f = latestPublicFloat({ units: { USD: [{ end: '2024-06-28', filed: '2024-11-01', val: 2.6e12 }, { end: '2025-06-27', filed: '2025-10-31', val: 3.1e12 }] } });
  assert.deepEqual(f, { value: 3.1e12, asOf: '2025-06-27' });
  assert.equal(latestPublicFloat(null), null);
  assert.equal(floatBand(3.1e12), 'mega');
  assert.equal(floatBand(5e9), 'mid');
  assert.equal(floatBand(null), null);
});
