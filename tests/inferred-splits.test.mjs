// Splits the split table lacks, read off the filings
// (api/_lib/inferredSplits.js), and the one accessor every reader of share
// splits goes through (api/_lib/splitAdjust.js loadSplits).
//
// The rules are tested on hand-made rows; the two real cases the November
// 2026 audit found (SOXX and ITA, 3-for-1 after 30 September) on the rows
// their holders filed, with the next quarter made up: three times the shares
// at a third of the price, nothing traded.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers.mjs';
import { inferSplits, mergeSplitTables, rowResidual, splitRatio, SOURCE } from '../api/_lib/inferredSplits.js';
import { loadSplits, splitAdjustPrev, splitFactor } from '../api/_lib/splitAdjust.js';
import { reconcileSplits, splitAdjust } from '../api/_lib/history.js';
import { netActivity } from '../api/_lib/netActivity.js';
import { costBasis } from '../api/_lib/costBasis.js';

const Q1 = '2026-03-31';
const Q2 = '2026-06-30';
const Q3 = '2026-09-30';
// one fund per entry: { T: [[date, shares, value], …] }
const hist = (...funds) => ({
  gurus: Object.fromEntries(
    funds.map((f, i) => [i, { quarters: [Q1, Q2, Q3].map((reportDate) => ({ reportDate })), positions: Object.fromEntries(Object.entries(f).map(([t, rows], j) => [`C${i}${j}`, { ticker: t, series: rows.map(([d, sh, v]) => [d, sh, v, 1]) }])) }])
  ),
});
const flat = (px) => () => px;
// a row filed at `px` a share
const at = (d, sh, px) => [d, sh, sh * px];

test('splitRatio: the ratios splits come in, both ways, and nothing else', () => {
  assert.equal(splitRatio(3), 3);
  assert.equal(splitRatio(2.95), 3);
  assert.equal(splitRatio(1.5), 1.5);
  assert.equal(splitRatio(0.1), 0.1);
  assert.equal(splitRatio(1 / 40), 1 / 40);
  assert.equal(splitRatio(6.665), null, 'CTVA: a constant 6.67 is not a split');
  assert.equal(splitRatio(2.913), 3, 'within 3%…');
  assert.equal(splitRatio(2.913, 0.01), null, '…but not within the 1% one holder alone needs');
  assert.equal(splitRatio(1.25), null, 'a spin-off factor');
  assert.equal(splitRatio(1), null);
  assert.equal(splitRatio(0), null);
});

test('rowResidual: what is left after the splits the row carries and the table knows', () => {
  // filed 100 shares at $300, archive close $100: one 3-for-1 after the row
  assert.equal(rowResidual([Q1, 100, 30000], { close: 100 }), 3);
  // the table knows it
  assert.equal(rowResidual([Q1, 100, 30000], { close: 100, table: [{ date: '2026-05-15', ratio: 3 }] }), 1);
  // the stored row already carries it (300 shares): the same answer as as-filed
  assert.equal(rowResidual([Q1, 300, 30000], { close: 100, applied: ['2026-05-15:3'] }), 3);
  assert.equal(rowResidual([Q1, 300, 30000], { close: 100, applied: ['2026-05-15:3'], table: [{ date: '2026-05-15', ratio: 3 }] }), 1);
  // a split before the row is nobody's business
  assert.equal(rowResidual([Q2, 300, 30000], { close: 100, applied: ['2026-05-15:3'], table: [{ date: '2026-05-15', ratio: 3 }] }), 1);
  for (const bad of [[Q1, 0, 1], [Q1, 1, 0], null]) assert.equal(rowResidual(bad, { close: 100 }), null);
  assert.equal(rowResidual([Q1, 1, 1], { close: null }), null);
});

test('a split between two reports: confirmed by the later quarter, dated the day after the earlier one', () => {
  // adjusted archive: $100 then $150; filed: $300 a share, then $150
  const closeOf = (t, d) => (d <= Q2 ? 100 : 150);
  const h = hist({ X: [at(Q2, 100, 300), at(Q3, 300, 150)] }, { X: [at(Q2, 40, 300), at(Q3, 90, 150)] });
  const { byTicker } = inferSplits(h, { closeOf });
  assert.deepEqual(byTicker, { X: [{ date: '2026-07-01', ratio: 3, source: SOURCE, evidence: { from: Q2, until: Q3, holders: 2, residual: 3 } }] });
});

test('a reverse split is read the same way', () => {
  const h = hist({ X: [at(Q2, 1000, 1), at(Q3, 100, 12)] });
  const { byTicker } = inferSplits(h, { closeOf: (t, d) => (d <= Q2 ? 10 : 12) });
  assert.equal(byTicker.X[0].ratio, 0.1);
  assert.equal(splitAdjust(1000, Q2, byTicker.X, Q3), 100);
});

test('the newest quarter, not confirmed yet: two holders that agree, or one exactly on the ratio', () => {
  const two = inferSplits(hist({ X: [at(Q3, 100, 300)] }, { X: [at(Q3, 7, 299)] }), { closeOf: flat(100) });
  assert.deepEqual(two.byTicker.X[0].evidence, { from: Q3, until: null, holders: 2, residual: 3 });
  assert.equal(two.byTicker.X[0].date, '2026-10-01');
  const one = inferSplits(hist({ X: [at(Q3, 100, 300)] }), { closeOf: flat(100) });
  assert.equal(one.byTicker.X[0].ratio, 3);
  // one holder a few percent off (FLTR: a filer's wrong CUSIP at 2.913) is not enough
  const off = inferSplits(hist({ X: [at(Q3, 100, 291.3)] }), { closeOf: flat(100) });
  assert.deepEqual(off.byTicker, {});
  assert.equal(off.rejected[0].why, 'too few holders agree');
  // two holders that disagree with each other
  assert.deepEqual(inferSplits(hist({ X: [at(Q3, 100, 300)] }, { X: [at(Q3, 100, 200)] }), { closeOf: flat(100) }).byTicker, {});
});

test('what is not a split infers nothing', () => {
  // a wrong series under the ticker: 6.67 in every quarter (CTVA)
  const ctva = inferSplits(hist({ X: [at(Q1, 10, 667), at(Q2, 10, 667), at(Q3, 10, 667)] }, { X: [at(Q3, 5, 667)] }), { closeOf: flat(100) });
  assert.deepEqual(ctva.byTicker, {});
  assert.deepEqual(ctva.rejected.map((r) => [r.ticker, r.date, r.why]), [['X', Q3, 'not a split ratio']]);
  // one quarter whose archive close is wrong: ×6 then ÷6 (AMT, 2020) — two steps, no split
  const blip = inferSplits(hist({ X: [at(Q1, 10, 100), at(Q2, 10, 600), at(Q3, 10, 100)] }), { closeOf: flat(100) });
  assert.deepEqual(blip.byTicker, {});
  assert.match(blip.rejected[0].why, /2 steps/);
  // a position last seen two quarters ago, never confirmed: says nothing about today
  const stale = inferSplits(hist({ X: [at(Q1, 10, 300)], Y: [at(Q3, 10, 100)] }), { closeOf: flat(100) });
  assert.deepEqual(stale.byTicker, {});
  assert.equal(stale.rejected[0].why, 'unconfirmed and not the newest quarter');
  // ordinary rows, a row with no close, an option-sized nothing
  assert.deepEqual(inferSplits(hist({ X: [at(Q2, 10, 101), at(Q3, 10, 99)] }), { closeOf: flat(100) }), { byTicker: {}, rejected: [] });
  assert.deepEqual(inferSplits(hist({ X: [at(Q3, 10, 300)] }), { closeOf: () => null }).byTicker, {});
  assert.deepEqual(inferSplits(null, { closeOf: flat(1) }), { byTicker: {}, rejected: [] });
});

test('the table always wins: a split it lists is never inferred on top, and replaces an inferred one', () => {
  const closeOf = (t, d) => (d <= Q2 ? 100 : 150);
  const h = hist({ X: [at(Q2, 100, 300), at(Q3, 300, 150)] });
  const table = { X: [{ date: '2026-08-11', ratio: 3 }] };
  assert.deepEqual(inferSplits(h, { table, closeOf }).byTicker, {});
  // a stale inferred file next to a table that has since learnt the split
  const inferred = inferSplits(h, { closeOf }).byTicker;
  assert.deepEqual(mergeSplitTables(table, inferred).X, table.X);
  // a different ticker's inferred split is added, sorted, the table untouched
  const m = mergeSplitTables({ X: [{ date: '2020-01-02', ratio: 2 }], Z: [{ date: '2021-01-04', ratio: 4 }] }, { X: inferred.X });
  assert.deepEqual(m.X.map((s) => [s.date, s.ratio]), [['2020-01-02', 2], ['2026-07-01', 3]]);
  assert.deepEqual(m.Z, [{ date: '2021-01-04', ratio: 4 }]);
  assert.deepEqual(mergeSplitTables({ A: [] }, {}), { A: [] });
});

test('an insider trade is only restated when it is certainly before the split', () => {
  const splits = { X: [{ date: '2026-07-01', ratio: 3, source: SOURCE, evidence: { from: Q2, until: Q3 } }] };
  assert.equal(splitFactor('X', '2026-05-04', splits), 3, 'before the last report in old shares');
  assert.equal(splitFactor('X', Q2, splits), 3);
  assert.equal(splitFactor('X', '2026-08-03', splits), 1, 'between the two reports the real day is unknown: left as filed');
  assert.equal(splitFactor('X', '2026-10-05', splits), 1);
});

// ---- the real cases ---------------------------------------------------------
const history = JSON.parse(fs.readFileSync(path.join(root, 'api', '_data', 'guru-history.json'), 'utf8'));
const holdersOf = (ticker, date) => {
  const out = [];
  for (const [cik, g] of Object.entries(history.gurus)) {
    for (const [cusip, e] of Object.entries(g.positions)) {
      const r = e.ticker === ticker && e.series.find((x) => x[0] === date);
      if (r) out.push({ cik, name: g.name, cusip, e, row: r });
    }
  }
  return out;
};

test('the committed file: generated, SOXX and ITA 3-for-1 after 2026-09-30, and what the accessor serves', () => {
  const file = JSON.parse(fs.readFileSync(path.join(root, 'api', '_data', 'splits-inferred.json'), 'utf8'));
  for (const [t, list] of Object.entries(file.byTicker)) {
    assert.equal(list.length, 1, `${t}: one inferred split a ticker`);
    const [s] = list;
    assert.equal(s.source, SOURCE);
    assert.match(s.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(splitRatio(s.ratio, 1e-9) === s.ratio, `${t}: ${s.ratio} is a split ratio`);
    assert.ok(s.evidence?.from < s.date && s.evidence.holders >= 1);
    // served through the one accessor unless the table has learnt it since
    const served = loadSplits()[t] || [];
    const inTable = (loadSplits({ inferred: false })[t] || []).some((x) => x.date > s.evidence.from && Math.abs(x.ratio - s.ratio) < 1e-6);
    assert.equal(served.some((x) => x.source === SOURCE && x.date === s.date), !inTable, t);
  }
  // nothing from the inferred layer reaches the table-only view
  for (const list of Object.values(loadSplits({ inferred: false }))) assert.ok(!list.some((s) => s.source === SOURCE));
});

for (const ticker of ['SOXX', 'ITA']) {
  test(`${ticker}: the holders' filed rows, then a quarter with three times the shares — no purchase, the same cost`, (t) => {
    const merged = loadSplits();
    const sp = (merged[ticker] || []).find((s) => s.date > Q3);
    if (!sp) return t.skip(`${ticker}: no split after ${Q3} on file any more (the position or the split moved on)`);
    assert.equal(sp.ratio, 3);
    const holders = holdersOf(ticker, Q3);
    assert.ok(holders.length >= 1);
    const Q4 = '2026-12-31';
    for (const h of holders) {
      // as filed at Q3 (take back whatever the stored row carries after Q3)
      const carried = (h.e.splitsApplied || []).map((k) => ({ date: k.split(':')[0], ratio: Number(k.split(':')[1]) })).filter((s) => s.date > Q3).reduce((f, s) => f * s.ratio, 1);
      const shares = Math.round(h.row[1] / carried);
      const value = h.row[2];
      const prev = { positions: [{ cusip: h.cusip, issuer: ticker, shares, value, weight: 1 }] };
      const cur = { positions: [{ cusip: h.cusip, issuer: ticker, shares: shares * 3, value, weight: 1 }] };
      const adj = splitAdjustPrev(prev, Q3, Q4, { tickerOf: () => ticker, splits: merged });
      assert.equal(adj.positions[0].shares, shares * 3, `${h.name}: the Q3 book in Q4 shares`);
      const r = [...netActivity([{ cik: h.cik, name: h.name, reportDate: Q4, cur, prev: adj }], { idOf: (p) => p.cusip }).values()][0];
      assert.equal(r.buyValue, 0, `${h.name}: no purchase`);
      assert.equal(r.buyShares, 0);
      assert.equal(r.adders, 0);
      // with the provider's table alone it is the phantom the audit found
      const raw = splitAdjustPrev(prev, Q3, Q4, { tickerOf: () => ticker, splits: loadSplits({ inferred: false }) });
      const bad = [...netActivity([{ cik: h.cik, name: h.name, reportDate: Q4, cur, prev: raw }], { idOf: (p) => p.cusip }).values()][0];
      assert.equal(bad.adders, 1);
      assert.ok(bad.buyValue > 0);

      // the stored history: Q3 restated to today's shares, Q4 as filed — one flat lot
      const rows = [[Q3, shares, value, 1], [Q4, shares * 3, value, 1]];
      const { series } = reconcileSplits(rows, null, merged[ticker], new Set([Q3, Q4]));
      assert.deepEqual(series.map((x) => x[1]), [shares * 3, shares * 3]);
      // cost: bought in the quarter to Q3 at an adjusted $50, held through Q4 at $60
      const prices = [];
      for (let ms = Date.parse('2026-07-01T00:00:00Z'); ms <= Date.parse(`${Q4}T00:00:00Z`); ms += 86400000) {
        const d = new Date(ms).toISOString().slice(0, 10);
        prices.push({ date: d, close: d <= Q3 ? 50 : 60 });
      }
      const quarters = [{ reportDate: Q2 }, { reportDate: Q3 }, { reportDate: Q4 }];
      const cb = costBasis({ quarters, series, prices });
      assert.equal(cb.avgBuy, 50, `${h.name}: the cost is the purchase quarter's price, not a blend with a phantom lot`);
      assert.equal(cb.lotShares, shares * 3);
      const phantom = costBasis({ quarters, series: rows, prices });
      assert.ok(phantom.avgBuy > 50, 'as filed, two thirds of the lot would be "bought" at the later price');
    }
  });
}

test('the real history: what the rules infer today is exactly what the committed file holds', async () => {
  const { closeOn } = await import('../api/_lib/valueUnits.js');
  const { byTicker } = inferSplits(history, { table: loadSplits({ inferred: false }), closeOf: closeOn });
  const file = JSON.parse(fs.readFileSync(path.join(root, 'api', '_data', 'splits-inferred.json'), 'utf8'));
  const keys = (o) => Object.entries(o).map(([t, l]) => `${t}:${l.map((s) => `${s.date}x${s.ratio}`).join(',')}`).sort();
  // the nightly job writes the file before it rebuilds the history, so the
  // two can be one night apart: every split in the file must still be
  // inferred or have reached the table; nothing is asserted the other way
  const table = loadSplits({ inferred: false });
  for (const k of keys(file.byTicker)) {
    const t = k.split(':')[0];
    const s = file.byTicker[t][0];
    const known = (table[t] || []).some((x) => x.date > s.evidence.from && Math.abs(x.ratio - s.ratio) < 1e-6);
    assert.ok(keys(byTicker).includes(k) || known || !holdersOf(t, s.evidence.from).length, `${k}: in the file, but no longer inferred and not in the table`);
  }
});
