import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateAvgBuy } from '../api/_handlers/holdings-history.js';

const q = (shares, px) => ({ shares, value: shares * px });

test('estimateAvgBuy: adds, trims, splits, exits, noise', () => {
  assert.equal(estimateAvgBuy([q(100, 10), q(200, 20), q(150, 25)]), 15);
  assert.ok(Math.abs(estimateAvgBuy([q(100, 100), q(1000, 10)]) - 10) < 1e-9);
  assert.ok(Math.abs(estimateAvgBuy([q(100, 100), q(1000, 10), q(1500, 12)]) - 16000 / 1500) < 1e-9);
  assert.equal(estimateAvgBuy([q(100, 10), null, q(100, 30)]), 30);
  assert.equal(estimateAvgBuy([null, null]), null);
  assert.equal(estimateAvgBuy([{ shares: 0, value: 5 }]), null);
  assert.equal(estimateAvgBuy([q(10000, 10), q(10020, 50)]), 10);
});
