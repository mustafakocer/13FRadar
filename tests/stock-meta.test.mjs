import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sectorsToFetch,
  mergeSectors,
  capBucket,
  applyStockMeta,
} from '../api/_lib/stockMeta.js';

// Sector and market cap enrichment: which symbols the daily build asks the
// provider about, and how the answers land on the per-security rows.

const rows = (...tickers) => tickers.map((ticker, i) => ({ ticker, rank: i + 1 }));

test('only unknown symbols are looked up, most-held first, within budget', () => {
  const map = { bySymbol: { AAPL: 'Technology' } };
  assert.deepEqual(sectorsToFetch(rows('AAPL', 'MSFT', 'KO', 'BAC'), map, 2), ['MSFT', 'KO']);
});

test('a symbol the provider reported no sector for is not asked about again', () => {
  const map = mergeSectors({ bySymbol: {} }, { BRKB: null });
  assert.equal(map.bySymbol.BRKB, null);
  assert.deepEqual(sectorsToFetch(rows('BRKB'), map, 10), [], 'null is an answer, not a gap');
});

test('securities with no resolved ticker are skipped', () => {
  const list = [{ ticker: null, rank: 1 }, { ticker: 'KO', rank: 2 }];
  assert.deepEqual(sectorsToFetch(list, { bySymbol: {} }, 10), ['KO']);
});

test('merging is additive, case-normalised and stamps a time', () => {
  const first = mergeSectors({ bySymbol: { AAPL: 'Technology' } }, { ko: 'Consumer Staples' });
  assert.equal(first.bySymbol.AAPL, 'Technology');
  assert.equal(first.bySymbol.KO, 'Consumer Staples');
  assert.ok(first.updatedAt);
  const second = mergeSectors(first, { AAPL: 'Information Technology' });
  assert.equal(second.bySymbol.AAPL, 'Information Technology', 'a later answer wins');
  assert.equal(second.bySymbol.KO, 'Consumer Staples', 'and the rest survives');
});

test('market cap buckets follow the boundaries the rest of the site filters by', () => {
  assert.equal(capBucket(250e9), 'mega');
  assert.equal(capBucket(200e9), 'mega');
  assert.equal(capBucket(199e9), 'large');
  assert.equal(capBucket(10e9), 'large');
  assert.equal(capBucket(9.9e9), 'mid');
  assert.equal(capBucket(2e9), 'mid');
  assert.equal(capBucket(1e9), 'small');
  assert.equal(capBucket(300e6), 'small');
  assert.equal(capBucket(299e6), 'micro');
  assert.equal(capBucket(0), null);
  assert.equal(capBucket(null), null);
});

test('missing meta stays null instead of guessing', () => {
  const out = applyStockMeta(rows('AAPL', 'ZZZZ'), {
    sectors: { AAPL: 'Technology' },
    marketCaps: { AAPL: 3.5e12 },
  });
  assert.equal(out[0].sector, 'Technology');
  assert.equal(out[0].cap, 'mega');
  assert.equal(out[1].sector, null);
  assert.equal(out[1].marketCap, null);
  assert.equal(out[1].cap, null, 'an unknown cap is not bucketed as micro');
  assert.equal(out[0].rank, 1, 'the row it enriches is otherwise untouched');
});
