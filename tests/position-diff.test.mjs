import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quarterEnd, nextQuarterEnd, quarterGrid, classify, buildTimeline } from '../api/_lib/positionDiff.js';

const S = (reportDate, shares, px, weight = 1) => ({ reportDate, shares, value: shares * px, weight });

test('quarter helpers', () => {
  assert.equal(quarterEnd('2025-02-14'), '2025-03-31');
  assert.equal(quarterEnd('2025-06-30'), '2025-06-30');
  assert.equal(nextQuarterEnd('2025-12-31'), '2026-03-31');
  assert.deepEqual(quarterGrid(['2025-06-30', '2024-12-31']), ['2024-12-31', '2025-03-31', '2025-06-30']);
  assert.deepEqual(quarterGrid([]), []);
});

test('classify: new/add/reduce/hold/exit/start, split, value fallback', () => {
  assert.equal(classify(null, S('q', 10, 1), true).action, 'NEW');
  assert.equal(classify(null, S('q', 10, 1), false).action, 'START');
  assert.equal(classify(S('q', 10, 1), null, true).action, 'EXIT');
  assert.equal(classify(null, null, true).action, 'NONE');
  assert.equal(classify(S('q', 100, 10), S('q', 150, 10), true).action, 'ADD');
  assert.equal(classify(S('q', 100, 10), S('q', 40, 10), true).action, 'REDUCE');
  assert.equal(classify(S('q', 100, 10), S('q', 100, 12), true).action, 'HOLD');
  assert.equal(classify(S('q', 10000, 10), S('q', 10020, 10), true).action, 'HOLD', 'rounding noise');
  assert.equal(classify(S('q', 100, 100), S('q', 1000, 10), true).action, 'HOLD', '10:1 split');
  const r = classify(S('q', 100, 100), S('q', 1200, 10), true);
  assert.equal(r.action, 'ADD');
  assert.ok(Math.abs(r.dShares - 200) < 1e-9);
  assert.equal(classify({ reportDate: 'q', shares: 0, value: 100, weight: 1 }, { reportDate: 'q', shares: 0, value: 130, weight: 1 }, true).action, 'ADD');
});

test('buildTimeline: missing quarter is not an EXIT; exit, re-entry and start handled', () => {
  const filed = [
    { reportDate: '2024-09-30', snap: S('2024-09-30', 100, 10) }, // START
    { reportDate: '2024-12-31', snap: S('2024-12-31', 150, 10) }, // ADD
    // 2025-03-31 not filed at all
    { reportDate: '2025-06-30', snap: S('2025-06-30', 150, 11) }, // HOLD (compared to Q4)
    { reportDate: '2025-09-30', snap: null },                     // EXIT
    { reportDate: '2025-12-31', snap: null },                     // NONE
    { reportDate: '2026-03-31', snap: S('2026-03-31', 50, 12) },  // NEW (re-entry)
  ];
  const tl = buildTimeline(filed);
  assert.deepEqual(tl.map((q) => q.reportDate), ['2024-09-30', '2024-12-31', '2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31']);
  assert.deepEqual(tl.map((q) => q.action), ['START', 'ADD', 'NONE', 'HOLD', 'EXIT', 'NONE', 'NEW']);
  assert.equal(tl[2].filed, false);
  assert.equal(tl[4].filed, true);
  assert.equal(tl[4].held, false);
  assert.equal(tl[4].dShares, -150);
  assert.equal(tl[1].dShares, 50);
  assert.equal(tl[6].dShares, 50);
});

test('buildTimeline: first filed quarter without the position, then NEW', () => {
  const tl = buildTimeline([
    { reportDate: '2025-03-31', snap: null },
    { reportDate: '2025-06-30', snap: S('2025-06-30', 10, 1) },
  ]);
  assert.deepEqual(tl.map((q) => q.action), ['NONE', 'NEW']);
});
