import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers.mjs';
import { netActivity, storiesByManager } from '../api/_lib/netActivity.js';
import { buildNewListings } from '../api/_lib/newListings.js';
import { listingLookup, listedInQuarter, previousQuarterEnd, heldBeforeListing } from '../client/src/lib/newListings.js';

// A1 — a security's first quarter in the 13F universe (IPO, spin-off) is not
// a quarter of buying.

const pos = (cusip, shares, value) => ({ cusip, issuer: cusip, shares, value, weight: 1, putCall: '' });
const Q = '2026-06-30';

test('listedInQuarter: first traded after the previous quarter end, on or before this one', () => {
  assert.equal(previousQuarterEnd(Q), '2026-03-31');
  assert.equal(previousQuarterEnd('2026-03-31'), '2025-12-31');
  assert.ok(listedInQuarter('2026-06-12', Q));
  assert.ok(!listedInQuarter('2026-03-31', Q), 'listed on the last day of the quarter before');
  assert.ok(!listedInQuarter('2026-07-01', Q), 'after the period');
  assert.ok(!listedInQuarter(null, Q));
});

test('a pre-IPO stake is held, not bought: out of buy $, net $ and the buyer counts', () => {
  const listedOn = listingLookup({ rows: [{ t: 'SPCX', c: ['84615Q103'], d: '2026-06-12' }] });
  const managers = [
    { cik: 'A', name: 'A', reportDate: Q, cur: { positions: [pos('84615Q103', 100, 15000), pos('X', 10, 100)] }, prev: { positions: [pos('X', 5, 50)] } },
    { cik: 'B', name: 'B', reportDate: Q, cur: { positions: [pos('84615Q103', 50, 7500)] }, prev: { positions: [pos('Y', 1, 1)] } },
  ];
  const rows = netActivity(managers, { listedOn });
  const s = rows.get('84615Q103');
  assert.equal(s.buyValue, 0);
  assert.equal(s.netValue, 0);
  assert.equal(s.buyers, 0);
  assert.equal(s.newBuyers, 0);
  assert.equal(s.preListing, 2);
  assert.equal(s.preListingValue, 22500);
  assert.equal(s.listedOn, '2026-06-12');
  assert.equal(s.holderCount, 2, 'still held by both');
  assert.ok(s.holders.every((h) => h.activity === 'preListing'));
  assert.equal(rows.get('X').buyValue, 50, 'the other lines are untouched');
  const st = storiesByManager(rows).get('A');
  assert.deepEqual(st.newBuys.map((x) => x.cusip), []);
  assert.deepEqual(st.preListing.map((x) => x.cusip), ['84615Q103']);
  // without the lookup it is the old reading: $22.5k bought
  assert.equal(netActivity(managers).get('84615Q103').buyValue, 22500);
});

test('the next quarter, new stakes in the same stock are buys again', () => {
  const listedOn = listingLookup({ rows: [{ t: 'SPCX', c: ['84615Q103'], d: '2026-06-12' }] });
  const rows = netActivity([{ cik: 'A', name: 'A', reportDate: '2026-09-30', cur: { positions: [pos('84615Q103', 10, 1500)] }, prev: { positions: [pos('X', 1, 1)] } }], { listedOn });
  assert.equal(rows.get('84615Q103').buyValue, 1500);
  assert.equal(rows.get('84615Q103').newBuyers, 1);
});

test('a security some fund held the quarter before is not new to the set (the rule stays off)', () => {
  const listedOn = listingLookup({ rows: [{ t: 'OLD', c: ['OLD1'], d: '2026-05-01' }] });
  const rows = netActivity(
    [
      { cik: 'A', name: 'A', reportDate: Q, cur: { positions: [pos('OLD1', 10, 100)] }, prev: { positions: [pos('Z', 1, 1)] } },
      { cik: 'B', name: 'B', reportDate: Q, cur: { positions: [pos('OLD1', 20, 200)] }, prev: { positions: [pos('OLD1', 20, 180)] } },
    ],
    { listedOn }
  );
  const r = rows.get('OLD1');
  assert.equal(r.buyValue, 100);
  assert.equal(r.preListing, 0);
  assert.equal(r.listedOn, undefined);
});

test('buildNewListings: series starting at the ten-year floor and new ETFs are not listings', () => {
  const index = new Map([
    ['AAPL', { from: '2016-09-23' }],
    ['LATE', { from: '2016-10-10' }],
    ['SPCX', { from: '2026-06-12' }],
    ['DRAM', { from: '2026-04-02' }],
    ['GONE', { from: '2024-01-02' }],
  ]);
  const f = buildNewListings({ index, cusipTickers: { '84615Q103': 'SPCX' }, sectorOf: { DRAM: 'ETF' }, now: Date.parse('2026-10-02') });
  assert.equal(f.floor, '2016-09-23');
  assert.deepEqual(f.rows, [{ t: 'SPCX', c: ['84615Q103'], d: '2026-06-12' }]);
  const on = listingLookup(f);
  assert.ok(heldBeforeListing({ cusip: '84615q103' }, Q, on));
  assert.ok(heldBeforeListing({ cusip: 'nope', ticker: 'SPCX' }, Q, on));
  assert.ok(!heldBeforeListing({ cusip: 'AAPLCUSIP', ticker: 'AAPL' }, Q, on));
});

test('the published data: SPCX and CBRS are not among the most bought, and the file lists them', () => {
  const read = (...p) => JSON.parse(fs.readFileSync(path.join(root, ...p), 'utf8'));
  const pro = read('api', '_data', 'consensus-pro.json');
  const pub = read('client', 'public', 'consensus.json');
  const gs = read('api', '_data', 'guru-stocks.json');
  const listings = read('client', 'public', 'new-listings.json');
  const on = listingLookup(listings);
  for (const t of ['SPCX', 'CBRS']) {
    assert.ok(!pro.topBought.some((r) => r.ticker === t), `${t} in topBought`);
    assert.ok(!pub.activity.buys.some((r) => r.ticker === t), `${t} on the home page`);
    assert.ok(on(t), `${t} in new-listings.json`);
    const row = gs.stocks.find((s) => s.ticker === t);
    if (row) {
      assert.equal(row.netValue, 0, `${t} net`);
      assert.ok(row.preListing > 0 && row.listedOn, `${t} marked held-before-listing`);
    }
  }
  // no row the rule covers ranks as a buy
  for (const r of pro.topBought) assert.ok(!listedInQuarter(on(r.cusip) || on(r.ticker), pro.quarter) || r.adders > 0 || r.sellers > 0, `${r.ticker} listed in ${pro.quarter}`);
});
