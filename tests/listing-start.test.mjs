// An earlier listing under the same ticker is not part of the series
// (api/_lib/priceStore.js listingStart): BSP's file is a shell that traded at
// a cent until 2022, 1,582 days of nothing, then Bending Spoons from $40.50 —
// read as one series it gave "year to date +2,779,900%" and a beta of 30,735.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';
import {
  listingStart,
  listingStartOf,
  encodeSeries,
  writeSeries,
  readSeries,
  readSeriesRaw,
  returnsFromSeries,
  withdrawAcrossListing,
  clearSeriesCache,
  LISTING_GAP_DAYS,
  HALT_GAP_DAYS,
} from '../api/_lib/priceStore.js';
import { sanitizeReturns } from '../scripts/sanitize-returns.mjs';

const DAY = 86400 * 1000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
// weekday closes from `from`, `n` rows, close = f(i)
function days(from, n, f) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); out.length < n; t += DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    out.push({ date: iso(t), close: f(out.length) });
  }
  return out;
}
const startOf = (prices) => {
  const e = encodeSeries(prices);
  const i = listingStart(e.d, e.c);
  assert.equal(listingStartOf(prices), i, 'the two forms agree');
  return i;
};

// the shape of BSP's file: a shell, years of silence, a new listing
const shell = days('2019-12-17', 551, (i) => (i < 536 ? 0.01 : 0.0015));
const listing = days('2026-07-01', 100, (i) => 40.5 + (i % 7) * 0.4);
const BSP = [...shell, ...listing];

test('a year of silence is a different listing, whatever the price did across it', () => {
  assert.equal(startOf(BSP), 551);
  // the same with a price that happens to match (LIME: $6.07 → $25 is not even split-sized)
  const quiet = [...days('2018-01-02', 50, () => 22), ...days('2026-07-02', 30, () => 25)];
  assert.equal(startOf(quiet), 50);
  // two earlier listings: the series starts at the newest
  const three = [...days('2012-01-03', 20, () => 5), ...days('2017-01-03', 20, () => 9), ...days('2024-01-02', 20, () => 30)];
  assert.equal(startOf(three), 40);
  assert.ok(LISTING_GAP_DAYS === 365);
});

test('a shorter silence is a new listing only with a split-sized move across it', () => {
  // back from bankruptcy in new shares after 105 days (CRC 2020: $1.18 → $15)
  const reorg = [...days('2020-03-02', 95, () => 1.18), ...days('2020-10-28', 60, () => 15)];
  assert.equal(startOf(reorg), 95);
  // a fund priced again after six months at about the same value: one series
  const fund = [...days('2025-01-02', 12, () => 9.99), ...days('2025-07-24', 60, () => 9.6)];
  assert.equal(startOf(fund), 0);
  // a halt of three weeks with a collapse across it is still the same listing
  const halt = [...days('2026-01-05', 40, (i) => 30 + (i % 5) * 0.1), ...days('2026-03-20', 40, () => 5)];
  assert.ok((Date.parse(halt[40].date) - Date.parse(halt[39].date)) / DAY <= HALT_GAP_DAYS);
  assert.equal(startOf(halt), 0);
});

test('a real move from one day to the next is never cut, however large', () => {
  // ×20 on a trial result, and a 1-for-20 the provider did not restate: the
  // two closes cannot tell them apart, so the history stays
  const jump = days('2025-01-02', 300, (i) => (i < 150 ? 0.57 + (i % 3) * 0.01 : 11.3));
  assert.equal(startOf(jump), 0);
  const crash = days('2025-01-02', 300, (i) => (i < 150 ? 30 + (i % 4) : 1.2));
  assert.equal(startOf(crash), 0);
  // a filler quote repeated for weeks, then a market: the same rule — kept
  assert.equal(startOf([...days('2016-10-03', 33, () => 7000), ...days('2016-11-17', 200, (i) => 200000 - i)]), 0);
  assert.equal(startOf(days('2025-01-02', 300, (i) => 10 + i * 0.01)), 0);
  assert.equal(listingStart([], []), 0);
  assert.equal(listingStartOf(null), 0);
});

test('readers get the current listing: no year-to-date across the gap, no 1Y for a listing younger than a year', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'listing-'));
  const before = process.env.PRICES_DIR;
  process.env.PRICES_DIR = dir;
  clearSeriesCache();
  try {
    const now = Date.parse('2026-11-19T12:00:00Z');
    writeSeries('BSP', BSP, { src: 'twelvedata', now, hist: BSP.at(-1).date });
    const raw = readSeriesRaw('BSP');
    assert.equal(raw.prices.length, BSP.length, 'every row stays in the file');
    assert.equal(raw.listing, 551);
    const s = readSeries('BSP');
    assert.equal(s.from, '2026-07-01');
    assert.equal(s.skipped, 551);
    assert.equal(s.held, 0, 'not an unverified break: the row is not dropped from returns.json, it is restated');
    assert.equal(s.prices.length, 100);
    assert.equal(s.prices[0].close, 40.5);

    // what the whole file said, and what the series says
    const wrong = returnsFromSeries('BSP', raw.prices, now);
    assert.ok(wrong.retYtd > 1_000_000, `the defect: year to date ${wrong.retYtd}%`);
    assert.ok(wrong.ret1y != null, 'and a "1Y" that was a since-listing return');
    const right = returnsFromSeries('BSP', s.prices, now);
    assert.equal(right.retYtd, null);
    assert.equal(right.ret1y, null);
    assert.ok(Math.abs(right.ret1d) < 5);
    assert.equal(right.price, BSP.at(-1).close);

    // the row a build wrote before the cut, repaired at deploy time and by the nightly build alike
    const row = { ret1y: 2.96, retYtd: 2779900, ret1d: -2.55, asOf: '2026-11-19' };
    assert.deepEqual(withdrawAcrossListing(row, s.from), { ret1y: null, retYtd: null, ret1d: -2.55, asOf: '2026-11-19' });
    const table = { BSP: { ...row }, OTHER: { ret1y: 5, retYtd: 4, ret1d: 1, asOf: '2026-11-19' } };
    const changed = sanitizeReturns(table);
    assert.deepEqual(changed, [{ symbol: 'BSP', before: { ret1y: 2.96, retYtd: 2779900 }, after: { ret1y: null, retYtd: null } }]);
    assert.deepEqual(table.OTHER, { ret1y: 5, retYtd: 4, ret1d: 1, asOf: '2026-11-19' });
    assert.deepEqual(sanitizeReturns(table), [], 'a second run finds nothing');

    // an unverified split-sized break after the listing still withholds, counted from the listing
    const tail = [...BSP, { date: iso(Date.parse(`${BSP.at(-1).date}T00:00:00Z`) + 3 * DAY), close: 400 }];
    writeSeries('BSP', tail, { src: 'finnhub', now, hist: BSP.at(-1).date });
    const cut = readSeries('BSP');
    assert.equal(cut.prices.length, 1);
    assert.equal(cut.skipped, 551);
    assert.equal(cut.held, 100);
  } finally {
    if (before === undefined) delete process.env.PRICES_DIR;
    else process.env.PRICES_DIR = before;
    clearSeriesCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('withdrawAcrossListing: only the figures whose window reaches back before the listing', () => {
  const row = { ret1y: 10, retYtd: 20, ret1d: 1, asOf: '2026-11-19' };
  assert.equal(withdrawAcrossListing(row, '2020-01-02'), row, 'an old cut changes nothing');
  assert.deepEqual(withdrawAcrossListing(row, '2025-12-15'), { ...row, ret1y: null }, 'listed eleven months ago: no 1Y, year to date stands');
  assert.deepEqual(withdrawAcrossListing(row, '2026-01-01'), { ...row, ret1y: null, retYtd: null });
  assert.equal(withdrawAcrossListing(row, null), row);
  assert.equal(withdrawAcrossListing(null, '2026-01-01'), null);
  const nulls = { ret1y: null, retYtd: null, ret1d: 1, asOf: '2026-11-19' };
  assert.equal(withdrawAcrossListing(nulls, '2026-07-01'), nulls);
});

test('the archive on file: BSP starts at its listing, and the benchmarks are whole', () => {
  clearSeriesCache();
  const bsp = readSeries('BSP');
  if (bsp?.skipped) {
    assert.ok(bsp.from >= '2026-01-01', `BSP starts ${bsp.from}`);
    assert.ok(bsp.prices[0].close > 1);
    assert.equal(returnsFromSeries('BSP', bsp.prices).retYtd, null);
  }
  for (const b of ['SPY', 'QQQ', 'IWM', 'AAPL', 'BRK-B']) {
    const s = readSeries(b);
    assert.ok(s?.prices?.length > 1000, b);
    assert.equal(s.skipped, 0, `${b} has no earlier listing`);
  }
  // nothing is cut by accident: the share of the archive with an earlier listing stays small
  const dir = path.join(root, 'api', '_data', 'prices');
  let files = 0;
  let cut = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json') || name.startsWith('_')) continue;
    const f = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    files++;
    if (listingStart(f.d || [], f.c || []) > 0) cut++;
  }
  assert.ok(files > 1000);
  assert.ok(cut / files < 0.03, `${cut} of ${files} series start after an earlier listing — more than 3% means the rule has gone wrong`);
});
