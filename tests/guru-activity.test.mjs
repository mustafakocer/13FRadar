import test from 'node:test';
import assert from 'node:assert/strict';
import { isTradeable, quarterDeltas, pctChange, isFresh, consensusOf, capBucket } from '../api/_lib/guruActivity.js';

// quarter map helper: ticker -> { shares, value, perGuru }
const q = (entries) =>
  new Map(
    entries.map(([t, value, perGuru]) => [
      t,
      {
        shares: Object.values(perGuru).reduce((s, n) => s + n, 0),
        value,
        perGuru: new Map(Object.entries(perGuru)),
      },
    ])
  );

test('tradeable filter: real tickers only, no bonds or unmapped CUSIPs', () => {
  assert.equal(isTradeable('AAPL', 'APPLE INC'), true);
  assert.equal(isTradeable('BRK.B', 'BERKSHIRE HATHAWAY INC'), true);
  assert.equal(isTradeable(null, 'APPLE INC'), false, 'a CUSIP that never resolved');
  assert.equal(isTradeable('023135106', 'AMAZON COM INC'), false, 'a CUSIP is not a ticker');
  assert.equal(isTradeable('WDC', 'WDC 3 11-15-28'), false, 'a note, not the equity');
  assert.equal(isTradeable('XYZ', 'SOMECO 4.5% DUE 2030'), false, 'a bond');
});

test('quarter deltas: buyers and sellers are counted per guru, not from the holder count', () => {
  const prev = q([['ABC', 1000, { g1: 100, g2: 100 }]]);
  // g1 doubles, g2 exits, g3 arrives — the holder count is unchanged at 2
  const cur = q([['ABC', 1500, { g1: 200, g3: 100 }]]);
  const [r] = quarterDeltas(cur, prev);
  assert.equal(r.g, 2, 'still two holders');
  assert.equal(r.b, 2, 'g1 added and g3 is new');
  assert.equal(r.s, 1, 'g2 left');
  assert.equal(r.ng, 1, 'only g3 is new to the name');
  assert.equal(r.sh, 300);
  assert.equal(r.bs, 100, 'combined shares rose by 100');
  assert.equal(r.ss, 0);
});

test('quarter deltas: a name nobody held is new to everyone holding it', () => {
  const [r] = quarterDeltas(q([['NEW', 500, { g1: 50, g2: 50 }]]), q([['OTHER', 10, { g1: 1 }]]));
  assert.equal(r.ng, 2);
  assert.equal(r.b, 2);
  assert.equal(r.s, 0);
  assert.equal(r.bs, 100, 'the whole position counts as bought');
  assert.equal(r.nv, 500, 'valued at this quarter’s price');
  assert.equal(isFresh(r), true);
  assert.equal(pctChange(r), null, 'no prior position means no percentage');
});

test('quarter deltas: a full group exit sells everything', () => {
  const [r] = quarterDeltas(q([['ABC', 200, { g1: 20 }]]), q([['ABC', 1000, { g1: 60, g2: 40 }]]));
  assert.equal(r.s, 2, 'g1 trimmed and g2 left');
  assert.equal(r.b, 0);
  assert.equal(r.ss, 80);
  assert.equal(r.nv, -800, 'negative: net selling');
  assert.equal(isFresh(r), false);
  assert.equal(pctChange(r), -80);
});

test('percentage change is measured against what the gurus held going in', () => {
  assert.equal(pctChange({ sh: 150, bs: 50, ss: 0 }), 50, 'from 100 to 150');
  assert.equal(pctChange({ sh: 50, bs: 0, ss: 50 }), -50, 'from 100 to 50');
  assert.equal(pctChange({ sh: 100, bs: 0, ss: 0 }), 0, 'untouched');
});

test('consensus label needs a real majority, not a single trade', () => {
  assert.equal(consensusOf({ b: 4, s: 1 }), 'accumulating');
  assert.equal(consensusOf({ b: 1, s: 0 }), 'neutral', 'one buyer is not a consensus');
  assert.equal(consensusOf({ b: 0, s: 5 }), 'distributing');
  assert.equal(consensusOf({ b: 3, s: 3 }), 'neutral');
  assert.equal(consensusOf({ b: 5, s: 3 }), 'neutral', 'a lean is not a consensus');
});

test('market-cap buckets cover the range without gaps or overlap', () => {
  assert.equal(capBucket(500e9), 'mega');
  assert.equal(capBucket(200e9), 'mega', 'the boundary belongs to the larger bucket');
  assert.equal(capBucket(199e9), 'large');
  assert.equal(capBucket(5e9), 'mid');
  assert.equal(capBucket(1e9), 'small');
  assert.equal(capBucket(1e8), 'micro');
  assert.equal(capBucket(0), null);
  assert.equal(capBucket(null), null);
});
