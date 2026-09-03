import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOverlap, jaccard, weightedOverlap } from '../api/_lib/overlap.js';

const P = (cusip, weight, shares = 100, px = 10, issuer = cusip) => ({ cusip, issuer, weight, shares, value: shares * px });
const fund = (cik, cur, prev = null) => ({ cik, name: cik, reportDate: '2026-06-30', cur, prev });

test('jaccard / weightedOverlap', () => {
  assert.equal(jaccard(new Set(['a', 'b']), new Set(['b', 'c'])), 1 / 3);
  assert.equal(jaccard(new Set(), new Set()), 0);
  const a = new Map([['x', P('x', 30)], ['y', P('y', 10)]]);
  const b = new Map([['x', P('x', 20)], ['z', P('z', 50)]]);
  assert.equal(weightedOverlap(a, b), 20);
});

test('computeOverlap: shared, unique, pairs, shared buys/sells, puts ignored', () => {
  const A = fund('A',
    [P('AAPL', 40, 100, 10), P('KO', 20, 100, 5), P('BAC', 10), { ...P('AAPL', 5), putCall: 'Put' }],
    [P('AAPL', 40, 80, 10), P('KO', 25, 120, 5), P('XOM', 10)]);
  const B = fund('B',
    [P('AAPL', 30, 50, 10), P('KO', 15, 100, 5), P('NVDA', 25)],
    [P('AAPL', 30, 40, 10), P('KO', 18, 130, 5), P('NVDA', 25)]);
  const C = fund('C', [P('AAPL', 10), P('TSLA', 50)]); // no prev filing

  const o = computeOverlap([A, B, C]);
  assert.equal(o.funds.length, 3);
  assert.equal(o.funds[0].positions, 3, 'put position not counted');
  assert.deepEqual(o.shared.map((r) => r.cusip), ['AAPL', 'KO']);
  assert.equal(o.shared[0].all, true);
  assert.equal(o.shared[1].all, false);
  assert.equal(o.sharedAllCount, 1);
  assert.deepEqual(o.shared[0].weights, { A: 40, B: 30, C: 10 });
  assert.deepEqual(o.unique.A.map((r) => r.cusip), ['BAC']);
  assert.deepEqual(o.unique.B.map((r) => r.cusip), ['NVDA']);
  assert.deepEqual(o.unique.C.map((r) => r.cusip), ['TSLA']);
  const ab = o.pairs.find((p) => p.a === 'A' && p.b === 'B');
  assert.equal(ab.shared, 2);
  assert.equal(ab.jaccard, 2 / 4);
  assert.equal(ab.weightedOverlap, 30 + 15);
  assert.equal(o.overallJaccard, 1 / 5); // AAPL held by all / union {AAPL,KO,BAC,NVDA,TSLA}
});

test('computeOverlap: union count sanity and shared buys/sells', () => {
  const A = fund('A', [P('AAPL', 40, 100), P('KO', 20, 100)], [P('AAPL', 40, 80), P('KO', 25, 120), P('XOM', 10)]);
  const B = fund('B', [P('AAPL', 30, 50), P('KO', 15, 100)], [P('AAPL', 30, 40), P('KO', 18, 130)]);
  const o = computeOverlap([A, B]);
  assert.equal(o.overallJaccard, 1);
  assert.deepEqual(o.sharedBuys.map((r) => r.cusip), ['AAPL']);
  assert.deepEqual(o.sharedBuys[0].buys.map((b) => b.action), ['ADD', 'ADD']);
  assert.deepEqual(o.sharedSells.map((r) => r.cusip), ['KO']);
  assert.deepEqual(o.sharedSells[0].sells.map((b) => b.action), ['REDUCE', 'REDUCE']);
});

test('computeOverlap: rejects wrong fund counts', () => {
  assert.throws(() => computeOverlap([fund('A', [])]));
  assert.throws(() => computeOverlap(Array.from({ length: 6 }, (_, i) => fund(String(i), []))));
});
