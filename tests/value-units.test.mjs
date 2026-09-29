// Filing-level unit check against market prices (api/_lib/valueUnits.js),
// the stored data after scripts/repair-units.mjs, and the headline total
// (api/_lib/universeSummary.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { unitVerdict, filingScale } from '../api/_lib/valueUnits.js';
import { aggregatePositions } from '../api/_lib/sec.js';
import { ownershipTrend } from '../api/_lib/guruStockHistory.js';
import { repairHistory, repairLatest } from '../scripts/repair-units.mjs';
import { inferPeriod, completeQuarter, summarizeUniverse, fundCountLabel } from '../api/_lib/universeSummary.js';

const json = (p) => JSON.parse(fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));

test('unitVerdict: a book near the market stays; one 1000× off either way is rescaled as a whole', () => {
  assert.equal(unitVerdict([1, 1.02, 0.97, 10, 0.1]).factor, 1, 'splits and odd lines move rows, not the median');
  assert.equal(unitVerdict([1000, 1001, 998, 999]).factor, 1 / 1000);
  assert.equal(unitVerdict([0.001, 0.00102, 0.00099]).factor, 1000);
  // too few priced rows, or a split vote: no change
  assert.equal(unitVerdict([1000, 1000]).factor, 1);
  assert.equal(unitVerdict([1000, 1000, 1000, 1, 1, 1, 1000]).factor, 1 / 1000);
  assert.equal(unitVerdict([1000, 1000, 1, 1, 1000, 1, 1]).factor, 1);
});

test('filingScale: options and zero-share rows do not vote', () => {
  const closeOf = () => 100;
  const rows = [
    { cusip: 'A', shares: 10, value: 1_000_000 },
    { cusip: 'B', shares: 10, value: 1_000_000 },
    { cusip: 'C', shares: 10, value: 1_000_000 },
    { cusip: 'D', shares: 10, value: 1_000, putCall: 'Put' },
  ];
  assert.equal(filingScale(rows, '2020-06-30', { closeOf }).factor, 1 / 1000);
});

test('aggregatePositions with a period: thousands written into a 2024 filing come out in dollars, the flag says so', () => {
  // T. Rowe Price's shape: $150 stocks, 1000 shares, value column 150 (thousands)
  const rows = Array.from({ length: 12 }, (_, i) => ({ cusip: `C${i}`, nameOfIssuer: `N${i}`, value: '150', shrsOrPrnAmt: { sshPrnamt: '1000', sshPrnamtType: 'SH' } }));
  const out = aggregatePositions(rows, '2024-08-14', { period: '2024-06-30', closeOf: () => 150 });
  assert.equal(Math.round(out.aum), 12 * 150_000);
  assert.equal(out.unitFix.factor, 1000);
  assert.equal(out.unitFix.by, 'market-price');
  // the same book in dollars: untouched, no flag
  const ok = aggregatePositions(rows.map((r) => ({ ...r, value: '150000' })), '2024-08-14', { period: '2024-06-30', closeOf: () => 150 });
  assert.equal(ok.unitFix, undefined);
  assert.equal(Math.round(ok.aum), 12 * 150_000);
});

const jumps = (ticker) => {
  const q = ownershipTrend({ ticker })?.quarters || [];
  const out = [];
  for (let i = 1; i < q.length; i++) {
    const r = q[i].value / q[i - 1].value;
    out.push({ at: q[i].reportDate, r: Math.max(r, 1 / r) });
  }
  return out;
};

test('TSM and AAPL ownership by quarter: no quarter-to-quarter jump above 5× (was $3.65B → $13.12B → $93.03B → $5.34B for TSM)', () => {
  for (const t of ['TSM', 'AAPL']) {
    const j = jumps(t);
    assert.ok(j.length > 30, `${t} has a history`);
    const worst = j.reduce((a, b) => (b.r > a.r ? b : a));
    assert.ok(worst.r < 5, `${t}: ${worst.r.toFixed(1)}× at ${worst.at}`);
  }
  const tsm = ownershipTrend({ ticker: 'TSM' }).quarters;
  const at = (d) => tsm.find((q) => q.reportDate === d).value / 1e9;
  assert.ok(at('2020-06-30') < 10 && at('2021-09-30') < 10, 'Select Equity’s dollars-as-thousands quarters are gone');
});

test('the stored data is in dollars: a second repair finds nothing, every correction is on record', () => {
  const H = json('api/_data/guru-history.json');
  const L = json('api/_data/latest-holdings.json');
  const U = json('client/public/universe.json');
  assert.equal(repairHistory(H).length, 0);
  assert.equal(repairLatest(L, U.rows).length, 0);
  const log = json('api/_data/unit-corrections.json');
  assert.ok(log.count >= 400);
  for (const c of log.corrections) {
    assert.ok(c.cik && c.factor && c.reason && c.source, JSON.stringify(c));
    assert.ok([1000, 1 / 1000].includes(c.factor));
  }
  const select = log.corrections.filter((c) => c.name === 'Select Equity Group' && c.factor === 1 / 1000);
  assert.ok(select.some((c) => c.period === '2020-06-30'));
  const trowe = log.corrections.find((c) => c.cik === '0000080255');
  assert.equal(trowe?.factor, 1000, 'T. Rowe Price Associates wrote thousands after 2023');
});

test('inferPeriod / completeQuarter', () => {
  assert.equal(inferPeriod('2026-08-14'), '2026-06-30');
  assert.equal(inferPeriod('2026-07-01'), '2026-06-30');
  assert.equal(inferPeriod('2026-05-15'), '2026-03-31');
  assert.equal(inferPeriod('2026-02-10'), '2025-12-31');
  assert.equal(completeQuarter('2026-09-29'), '2026-06-30');
  assert.equal(completeQuarter('2026-08-13'), '2026-03-31', 'June is not complete before its 14 August deadline');
  assert.equal(completeQuarter('2026-08-14'), '2026-06-30');
});

test('summarizeUniverse: the latest quarter, one row per fund, stale funds and a book filed twice left out', () => {
  const rows = [
    { cik: '1', aum: 100, positions: 10, filed: '2026-08-10' },
    { cik: '2', aum: 50, positions: 5, reportDate: '2026-06-30', filed: '2026-08-12' },
    { cik: '3', aum: 999, positions: 9, filed: '2026-05-10' }, // March book: stale
    { cik: '4', aum: 7, positions: 3, reportDate: '2024-03-31', filed: '2026-09-24' }, // a 2024 book filed late
    { cik: '5', aum: 50, positions: 5, reportDate: '2026-06-30', filed: '2026-08-12' }, // cik 2's book again
  ];
  const s = summarizeUniverse(rows, { asOf: '2026-09-29' });
  assert.deepEqual(s, { count: 5, quarter: '2026-06-30', inTotal: 2, stale: 2, duplicates: 1, optionsExcluded: 0, totalAum: 150, totalPositions: 15 });
  // option notional is left out of the total
  const withOpts = summarizeUniverse([{ ...rows[0], putCallValue: 30 }, rows[1]], { asOf: '2026-09-29' });
  assert.equal(withOpts.totalAum, 120);
  assert.equal(withOpts.optionsExcluded, 30);
});

test('the universe holds one row per fund: an original and its amendment are never both counted', async () => {
  const U = json('client/public/universe.json');
  const ciks = U.rows.map((r) => r.cik);
  assert.equal(new Set(ciks).size, ciks.length);
  // the published summary is exactly what the shared definition gives
  const S = json('client/public/universe-summary.json');
  const { loadSameBooks } = await import('../api/_lib/universeSummary.js');
  const again = summarizeUniverse(U.rows, { asOf: U.updatedAt, sameBooks: loadSameBooks(new URL('..', import.meta.url).pathname) });
  assert.equal(S.totalAum, again.totalAum);
  assert.equal(S.count, U.rows.length);
});

test('fundCountLabel: one count, exact or rounded', () => {
  assert.equal(fundCountLabel(9023), '9,023');
  assert.equal(fundCountLabel(9023, { round: true }), '9,000+');
  assert.equal(fundCountLabel(9023, { locale: 'tr-TR' }), '9.023');
  assert.equal(fundCountLabel(0), null);
});
