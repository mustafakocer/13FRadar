// The estimated purchase price, the gain against it, and the split
// adjustment they both depend on — worked through by hand on made-up rows
// (api/_lib/costBasis.js, history.js reconcileSplits, splitAdjust.js,
// netActivity.js). tests/cost-basis.test.mjs holds the basic rules; these are
// the multi-quarter scenarios and the edges, plus the one failure the
// November 2026 audit found in the wild — a split the split table does not
// know about — and the layer that now reads it off the filings.
//
// Prices are flat inside a quarter so every "quarter average" is exact and
// every expected number below can be redone on paper.
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.mjs';
import { costBasis, gainPct } from '../api/_lib/costBasis.js';
import { reconcileSplits, splitAdjust } from '../api/_lib/history.js';
import { splitAdjustPrev } from '../api/_lib/splitAdjust.js';
import { netActivity } from '../api/_lib/netActivity.js';
import { inferSplits, mergeSplitTables } from '../api/_lib/inferredSplits.js';

const DAY = 86400 * 1000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const Q = ['2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30', '2026-12-31'];
const quarters = Q.map((reportDate) => ({ reportDate }));
// weekday closes, one flat level per quarter: `levels[i]` is the close of
// the quarter that ends at Q[i]
function flat(levels) {
  const out = [];
  for (let t = Date.parse('2025-07-01T00:00:00Z'); t <= Date.parse(`${Q.at(-1)}T00:00:00Z`); t += DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const d = iso(t);
    out.push({ date: d, close: levels[Q.findIndex((q) => d <= q)] });
  }
  return out;
}
const row = (i, shares) => [Q[i], shares, 1, 1];

test('buy, add, trim, add again: the average moves only on purchases', () => {
  const prices = flat([10, 20, 40, 50, 80, 100]);
  // Q1 +100 @20 → cost 2,000 · Q2 +300 @40 → 14,000 over 400 = 35
  // Q3 −200 at average cost → 200 left, cost 7,000, still 35
  // Q4 +200 @80 → 23,000 over 400 = 57.50
  const cb = costBasis({ quarters: quarters.slice(0, 5), series: [row(1, 100), row(2, 400), row(3, 200), row(4, 400)], prices });
  assert.equal(cb.avgBuy, 57.5);
  assert.equal(cb.lotShares, 400);
  assert.equal(cb.lotCost, 23000);
  assert.equal(cb.since, Q[1]);
  assert.equal(cb.openedBeforeData, false);
  assert.equal(cb.unpriced, false);
  // the step before the last purchase, on its own
  const before = costBasis({ quarters: quarters.slice(0, 4), series: [row(1, 100), row(2, 400), row(3, 200)], prices });
  assert.equal(before.avgBuy, 35);
  assert.equal(before.lotCost, 7000);
});

test('sold out and bought back: the old lot is forgotten, the new one starts at the re-entry quarter', () => {
  const prices = flat([10, 20, 40, 50, 80, 100]);
  // held 100 @20, gone in Q2 and Q3, back with 50 @80, then 50 more @100
  const cb = costBasis({ quarters, series: [row(1, 100), row(4, 50), row(5, 100)], prices });
  assert.equal(cb.since, Q[4]);
  assert.equal(cb.avgBuy, 90);
  assert.equal(cb.lotShares, 100);
  assert.equal(cb.lotCost, 9000);
  assert.equal(cb.openedBeforeData, false);
  // sold out and never back: nothing open, nothing estimated
  const gone = costBasis({ quarters, series: [row(1, 100), row(2, 60)], prices });
  assert.equal(gone.avgBuy, null);
  assert.equal(gone.lotShares, 0);
  assert.equal(gone.lotCost, null);
  assert.equal(gone.since, null);
});

test('a position already there in the first quarter on file: priced at that quarter and flagged — until it is sold out', () => {
  const prices = flat([10, 20, 40, 50, 80, 100]);
  let cb = costBasis({ quarters, series: [row(0, 100), row(1, 100), row(2, 100), row(3, 100), row(4, 100), row(5, 100)], prices });
  assert.equal(cb.openedBeforeData, true);
  assert.equal(cb.avgBuy, 10);
  assert.equal(cb.since, Q[0]);
  // the flag belongs to the lot, not the security: after an exit the new lot is known
  cb = costBasis({ quarters, series: [row(0, 100), row(3, 10), row(4, 10), row(5, 10)], prices });
  assert.equal(cb.openedBeforeData, false);
  assert.equal(cb.avgBuy, 50);
});

test('edges: no rows, no quarters, a zero-share line, a trim to nothing', () => {
  const prices = flat([10, 20, 40, 50, 80, 100]);
  for (const cb of [costBasis({}), costBasis({ quarters, series: [], prices }), costBasis({ quarters: [], series: [row(1, 5)], prices })]) {
    assert.equal(cb.avgBuy, null);
    assert.equal(cb.lotShares, 0);
    assert.deepEqual(cb.byQuarter, {});
  }
  // a line with zero shares is no position: it closes the lot like a missing line
  const zero = costBasis({ quarters, series: [row(1, 100), row(2, 0), row(3, 40), row(4, 40), row(5, 40)], prices });
  assert.equal(zero.since, Q[3]);
  assert.equal(zero.avgBuy, 50);
  // the estimate is never negative, never NaN, never Infinity
  for (const v of [zero.avgBuy, zero.lotCost, zero.lotShares]) assert.ok(Number.isFinite(v) && v >= 0);
});

test('gain against the estimate: plain arithmetic, and a dash for anything that is not a price', () => {
  assert.equal(gainPct(57.5, 80), 39.1); // (80 − 57.5) / 57.5 = 39.13%
  assert.equal(gainPct(90, 45), -50);
  assert.equal(gainPct(100, 100), 0);
  for (const [a, b] of [[0, 10], [10, 0], [-5, 10], [10, -5], [null, 10], [10, null], [undefined, undefined], [NaN, 10]]) assert.equal(gainPct(a, b), null, `${a} → ${b}`);
});

// --- splits -----------------------------------------------------------------
// The price archive is split-adjusted by its provider: after a 3-for-1 every
// earlier close reads a third of what the stock traded at. Share counts come
// from the filings as filed, so the earlier quarters must be multiplied by
// three (the split table, api/_data/splits.json) before a count is compared
// with a later one or priced with an archive close.
//
// The case: 100 shares bought in the quarter ending 2026-03-31 at $300, then
// a 3-for-1 on 2026-05-15, the fund trades nothing, the stock goes from $100
// to $150 (post-split). The next filing shows 300 shares.
const SPLIT = { date: '2026-05-15', ratio: 3 };
const adjusted = flat([90, 90, 100, 150, 150, 150]); // the archive: every close in post-split dollars
const filed = [row(2, 100), row(3, 300)]; // as filed

test('a 3-for-1 the split table knows: 300 shares at $100, no purchase, the gain is the price move', () => {
  const { series, applied } = reconcileSplits(filed, null, [SPLIT], new Set(filed.map((r) => r[0])));
  assert.deepEqual(series.map((r) => r[1]), [300, 300]);
  assert.deepEqual(applied, ['2026-05-15:3']);
  // running the build again does not adjust the stored rows a second time
  assert.deepEqual(reconcileSplits(series, applied, [SPLIT], new Set()).series.map((r) => r[1]), [300, 300]);

  const cb = costBasis({ quarters: quarters.slice(0, 4), series, prices: adjusted });
  // $30,000 paid for what is now 300 shares
  assert.equal(cb.avgBuy, 100);
  assert.equal(cb.lotShares, 300);
  assert.equal(cb.lotCost, 30000);
  assert.equal(cb.since, Q[2]);
  assert.equal(gainPct(cb.avgBuy, 150), 50);

  // and the quarter's activity: the previous book in today's shares, nothing bought
  const prev = { positions: [{ cusip: 'X1', issuer: 'X', shares: 100, value: 30000, weight: 10 }] };
  const cur = { positions: [{ cusip: 'X1', issuer: 'X', shares: 300, value: 45000, weight: 10 }] };
  const adj = splitAdjustPrev(prev, Q[2], Q[3], { tickerOf: () => 'X', splits: { X: [SPLIT] } });
  const r = [...netActivity([{ cik: '1', name: 'F', reportDate: Q[3], cur, prev: adj }], { idOf: (p) => p.cusip }).values()][0];
  assert.equal(r.buyShares, 0);
  assert.equal(r.buyValue, 0);
  assert.equal(r.netValue, 0);
  assert.equal(r.adders, 0);
});

test('a reverse split and a split dated after the later report leave the right things alone', () => {
  // 1-for-10 between the two reports: 1,000 shares become 100
  assert.equal(splitAdjust(1000, Q[2], [{ date: '2026-05-15', ratio: 0.1 }], Q[3]), 100);
  // a split after the current report date: both books are still in old shares
  assert.equal(splitAdjust(100, Q[2], [{ date: '2026-07-10', ratio: 3 }], Q[3]), 100);
  // …but it does reach the stored history, which is kept in today's shares
  assert.equal(splitAdjust(100, Q[2], [{ date: '2026-07-10', ratio: 3 }]), 300);
});

// The split table stopped being refreshed in October 2026 (its provider
// refuses the endpoint on the plan in use), so a split after that is not in
// it: SOXX and ITA, both 3-for-1, were found missing. Read with the table
// alone, the same case is a +200% purchase of $30,000 that never happened and
// a cost of $133.33 a share where $100 was paid.
//
// The evidence is in the data already: the filing's own price for the earlier
// quarter ($30,000 ÷ 100 = $300) is three times the archive's adjusted close
// for that day ($100), a ratio that is a share split and that the later
// quarter does not show ($45,000 ÷ 300 = $150 = the close). No trade produces
// that pattern; a split after the earlier report does. inferredSplits.js
// reads it, and every reader of the split table gets it through the one
// accessor (splitAdjust.js loadSplits → mergeSplitTables).
const closeOf = (ticker, date) => adjusted.findLast((p) => p.date <= date)?.close ?? null;
const asFiled = [[Q[2], 100, 30000, 1], [Q[3], 300, 45000, 1]];
const fund = (series, splitsApplied) => ({ gurus: { 1: { quarters: quarters.slice(0, 4), positions: { X1: { ticker: 'X', series, ...(splitsApplied ? { splitsApplied } : {}) } } } } });

test('the table alone: the 3-for-1 it lacks reads as a +200% purchase (what the inferred layer is for)', () => {
  const { series } = reconcileSplits(filed, null, [], new Set(filed.map((r) => r[0])));
  assert.deepEqual(series.map((r) => r[1]), [100, 300], 'nothing to apply: the counts stay as filed');
  const cb = costBasis({ quarters: quarters.slice(0, 4), series, prices: adjusted });
  assert.equal(cb.avgBuy, 133.33, 'true cost per share is $100');
  assert.equal(gainPct(cb.avgBuy, 150), 12.5, 'true gain is +50%');
});

test('a split the table lacks is recognised from the implied price: no phantom purchase', () => {
  const { byTicker } = inferSplits(fund(asFiled), { table: {}, closeOf });
  assert.deepEqual(byTicker.X.map((x) => [x.date, x.ratio, x.source]), [['2026-04-01', 3, 'inferred-13f']]);
  assert.deepEqual(byTicker.X[0].evidence, { from: Q[2], until: Q[3], holders: 1, residual: 3 });
  const splits = mergeSplitTables({}, byTicker);

  const prev = { positions: [{ cusip: 'X1', issuer: 'X', shares: 100, value: 30000, weight: 10 }] };
  const cur = { positions: [{ cusip: 'X1', issuer: 'X', shares: 300, value: 45000, weight: 10 }] };
  const adj = splitAdjustPrev(prev, Q[2], Q[3], { tickerOf: () => 'X', splits });
  assert.equal(adj.positions[0].shares, 300);
  const r = [...netActivity([{ cik: '1', name: 'F', reportDate: Q[3], cur, prev: adj }], { idOf: (p) => p.cusip }).values()][0];
  assert.equal(r.buyShares, 0);
  assert.equal(r.buyValue, 0);
  assert.equal(r.adders, 0);
});

test('a split the table lacks is recognised from the implied price: the cost stays $100 a share', () => {
  const splits = mergeSplitTables({}, inferSplits(fund(asFiled), { table: {}, closeOf }).byTicker);
  const { series, applied } = reconcileSplits(asFiled, null, splits.X, new Set(asFiled.map((r) => r[0])));
  assert.deepEqual(series.map((r) => r[1]), [300, 300]);
  const cb = costBasis({ quarters: quarters.slice(0, 4), series, prices: adjusted });
  assert.equal(cb.avgBuy, 100);
  assert.equal(cb.lotCost, 30000);
  assert.equal(gainPct(cb.avgBuy, 150), 50);

  // the next night reads the stored rows, which now carry the split: the
  // same split is inferred again (not a second one, and not none — the
  // history build would take the adjustment back)
  const again = inferSplits(fund(series, applied), { table: {}, closeOf }).byTicker;
  assert.deepEqual(again.X.map((x) => [x.date, x.ratio]), [['2026-04-01', 3]]);
  assert.deepEqual(reconcileSplits(series, applied, mergeSplitTables({}, again).X, new Set()).series.map((r) => r[1]), [300, 300]);

  // and when the table learns the real split, the inference steps aside
  const table = { X: [SPLIT] };
  assert.deepEqual(inferSplits(fund(series, applied), { table, closeOf }).byTicker, {});
  const real = reconcileSplits(series, applied, mergeSplitTables(table, {}).X, new Set());
  assert.deepEqual(real.series.map((r) => r[1]), [300, 300], 'the inferred key is taken back and the real one applied: the counts do not move');
  assert.deepEqual(real.applied, ['2026-05-15:3']);
});
