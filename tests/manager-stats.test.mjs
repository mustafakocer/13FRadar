import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quarterTrades } from '../api/_handlers/manager-stats.js';

const snap = (aum, list) => ({ reportDate: 'x', aum, byCusip: new Map(list.map((p) => [p.cusip, p])) });

test('quarterTrades: splits neutralised, adds/trims/new/exits priced sensibly', () => {
  const prev = snap(1000, [
    { cusip: 'NVDA', value: 400, shares: 4 },
    { cusip: 'AAPL', value: 300, shares: 3 },
    { cusip: 'KO', value: 200, shares: 2 },
    { cusip: 'XOM', value: 100, shares: 1 },
  ]);
  const cur = snap(1100, [
    { cusip: 'NVDA', value: 420, shares: 40 },
    { cusip: 'AAPL', value: 440, shares: 4 },
    { cusip: 'KO', value: 90, shares: 1 },
    { cusip: 'CB', value: 150, shares: 1 },
  ]);
  const q = quarterTrades(prev, cur);
  assert.deepEqual([q.newCount, q.exitCount, q.addCount, q.trimCount], [1, 1, 1, 1]);
  assert.equal(q.bought, 260);
  assert.equal(q.sold, 200);
  assert.equal(q.net, 60);
  assert.ok(Math.abs(q.activity - (460 / 1050) * 100) < 1e-9);
});

test('quarterTrades: value fallback when share counts are missing', () => {
  const prev = snap(100, [{ cusip: 'A', value: 100, shares: 0 }]);
  const cur = snap(120, [{ cusip: 'A', value: 120, shares: 0 }]);
  const q = quarterTrades(prev, cur);
  assert.equal(q.bought, 20);
  assert.equal(q.addCount, 1);
});
