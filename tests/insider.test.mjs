import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTransaction, findClusters, rowClass } from '../api/_lib/insiderModel.js';
import { buildTeaser } from '../api/_lib/insiderTeaser.js';

test('transaction taxonomy: conviction / liquidity / noise', () => {
  assert.equal(classifyTransaction('P'), 'conviction');
  assert.equal(classifyTransaction('C'), 'conviction');
  assert.equal(classifyTransaction('M'), 'conviction', 'exercise-and-hold');
  assert.equal(classifyTransaction('M', { sameFilingSale: true }), 'liquidity', 'exercise cash-out');
  assert.equal(classifyTransaction('S'), 'liquidity');
  assert.equal(classifyTransaction('D'), 'liquidity', 'tender / disposition to issuer');
  for (const c of ['A', 'F', 'G', 'W', 'J', 'I']) assert.equal(classifyTransaction(c), 'noise', c);
  assert.equal(rowClass({ k: 'S' }), 'liquidity', 'legacy rows without cl');
  assert.equal(rowClass({ k: 'M', cl: 'liquidity' }), 'liquidity', 'stored class wins');
});

test('cluster detector: ≥2 distinct insiders, code P, 7-day window', () => {
  const rows = [
    { t: 'ABC', k: 'P', n: 'A', d: '2026-05-01', v: 100 },
    { t: 'ABC', k: 'P', n: 'B', d: '2026-05-06', v: 200 },
    { t: 'ABC', k: 'P', n: 'C', d: '2026-05-20', v: 300 }, // outside the window of the first two
    { t: 'XYZ', k: 'P', n: 'A', d: '2026-05-01', v: 100 },
    { t: 'XYZ', k: 'P', n: 'A', d: '2026-05-02', v: 100 }, // same insider twice ≠ cluster
    { t: 'QQQ', k: 'S', n: 'A', d: '2026-05-01', v: 100 },
    { t: 'QQQ', k: 'S', n: 'B', d: '2026-05-01', v: 100 }, // sales never cluster
  ];
  const c = findClusters(rows);
  assert.deepEqual([...c.keys()], ['ABC']);
  assert.equal(c.get('ABC').insiders, 2);
  assert.equal(c.get('ABC').value, 300);
});

test('teaser: pulse, highlight and signals from a dataset', () => {
  const rows = [
    { t: 'ABC', k: 'P', n: 'Alice', r: 'ceo', d: '2026-05-01', f: '2026-05-02', v: 50000, p: 4.5, s: 1000 },
    { t: 'ABC', k: 'P', n: 'Bob', r: 'director', d: '2026-05-03', f: '2026-05-04', v: 30000, p: 4.6, s: 500 },
    { t: 'DEF', k: 'S', n: 'Carol', r: 'cfo', d: '2026-05-03', f: '2026-05-04', v: 900000, p: 40, s: 100 },
    { t: 'NONE', k: 'P', n: 'Fund', r: 'owner10', d: '2026-05-04', f: '2026-05-04', v: 5e6, p: 10, s: 1 },
  ];
  const t = buildTeaser(rows, { ABC: 'Abc Corp' }, {}, Date.parse('2026-05-05'));
  assert.equal(t.lastDay, '2026-05-04');
  assert.equal(t.pulse.sellCount, 1);
  assert.equal(t.highlight.t, 'ABC', 'unlisted NONE rows are ignored');
  assert.equal(t.signals.cluster[0].t, 'ABC');
  assert.deepEqual(t.signals.cluster[0].roles, ['ceo']);
  assert.equal(t.signals.csuite[0].n, 'Alice');
  assert.equal(t.signals.penny.length, 1, 'one row per ticker');
});
