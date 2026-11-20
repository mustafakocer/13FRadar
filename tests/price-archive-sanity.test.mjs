// Does the price archive hold the security the filings say it does?
//
// Every 13F row implies a price: value ÷ shares at the period end. The price
// archive (api/_data/prices) has a close for that day. For a ticker the two
// agree within a few percent — unless the archive holds a different
// security under that ticker (a collision), a series scaled by a factor the
// shares were never adjusted for (a split missing from api/_data/splits.json,
// a spin-off factor applied to the wrong thing), or a wrong CUSIP → ticker
// mapping. Each of those silently corrupts whatever is computed from the
// archive for that name: the estimated purchase price, the gain, "since
// quarter end", the fund's chained return.
//
// For each guru's latest quarter, per ticker: the median over its holders of
// (implied price ÷ archive close). A median outside 1/2.5 … 2.5 is flagged.
// The band is wide on purpose: this is not a rounding check, it catches a
// series that is off by a multiple. (A 2-for-1 the table lacks sits at 2.0,
// inside the band — the split job's own alarm is the guard for that.)
//
// This reads the nightly data, like tests/data-integrity.test.mjs: a new
// anomaly turns it red on the day the data arrives. Then either fix the
// data, or — if it is understood and cannot be fixed yet — add the ticker to
// KNOWN with the reason. KNOWN is not a place to park something unexplained.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers.mjs';
import { closeOn } from '../api/_lib/valueUnits.js';

export const BAND = 2.5;
export const KNOWN = {
  // known anomaly — see the pull request that added this test (audit, November 2026)
  CTVA: 'the archived series is ~1/6.67 of the price every filing implies, in every quarter back to 2019 (five holders agree at 2026-09-30: $77.65 filed, $11.65 archived): a wrong series under the ticker or a mis-applied adjustment factor',
  SOXX: '3-for-1 split after 2026-09-30 is not in splits.json (the split job has had no working source since October 2026)',
  ITA: '3-for-1 split after 2026-09-30 is not in splits.json (same cause as SOXX)',
  CIR: 'CUSIP T19404101 is CIR SpA (Milan); the archive holds the prices of a US-listed security with the same ticker ($0.89 filed, $29.39 archived)',
  FLTR: "one filer's line (Hosking Partners, \"Flutter Entertainment PLC\" under CUSIP 92189F486, which is the VanEck FLTR ETF): $74.54 filed, $25.59 archived — the filing's own CUSIP and name disagree",
};

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

// → [{ ticker, date, ratio, holders, close }] for the tickers outside the band
export function archiveAnomalies(history, { closeOf = closeOn, band = BAND } = {}) {
  const by = new Map();
  for (const g of Object.values(history.gurus || {})) {
    const date = g.quarters?.at(-1)?.reportDate;
    if (!date) continue;
    for (const e of Object.values(g.positions || {})) {
      if (!e.ticker) continue;
      const r = (e.series || []).find((x) => x[0] === date);
      if (!r || !(r[1] > 0) || !(r[2] > 0)) continue;
      const close = closeOf(e.ticker, date);
      if (!(close > 0)) continue;
      const k = `${e.ticker}|${date}`;
      const cur = by.get(k) || { ticker: e.ticker, date, close, ratios: [] };
      cur.ratios.push(r[2] / r[1] / close);
      by.set(k, cur);
    }
  }
  const out = [];
  for (const a of by.values()) {
    const ratio = median(a.ratios);
    if (ratio > band || ratio < 1 / band) out.push({ ticker: a.ticker, date: a.date, ratio: Number(ratio.toPrecision(4)), holders: a.ratios.length, close: a.close });
  }
  return { checked: by.size, anomalies: out.sort((x, y) => x.ticker.localeCompare(y.ticker)) };
}

test('archiveAnomalies: a series off by a multiple is flagged, an ordinary one is not', () => {
  const g = (rows) => ({ quarters: [{ reportDate: '2026-09-30' }], positions: Object.fromEntries(rows.map(([t, sh, v], i) => [`C${i}`, { ticker: t, series: [['2026-09-30', sh, v, 1]] }])) });
  const history = { gurus: { a: g([['OK', 100, 10100], ['SPLIT', 100, 30000], ['TINY', 100, 30], ['NOPX', 1, 1]]), b: g([['OK', 50, 4950], ['SPLIT', 10, 3010]]) } };
  const closeOf = (t) => ({ OK: 100, SPLIT: 100, TINY: 10 })[t] ?? null;
  const r = archiveAnomalies(history, { closeOf });
  assert.equal(r.checked, 3, 'a ticker with no close is not judged');
  assert.deepEqual(r.anomalies.map((a) => [a.ticker, a.holders]), [['SPLIT', 2], ['TINY', 1]]);
  assert.equal(r.anomalies[0].ratio, 3.01);
  // a 2-for-1 sits inside the band: said in the header, pinned here
  assert.equal(archiveAnomalies({ gurus: { a: g([['TWO', 100, 20000]]) } }, { closeOf: () => 100 }).anomalies.length, 0);
});

test('price archive: no held ticker is priced at a multiple of what its filings imply, beyond the known ones', (t) => {
  const history = JSON.parse(fs.readFileSync(path.join(root, 'api', '_data', 'guru-history.json'), 'utf8'));
  const { checked, anomalies } = archiveAnomalies(history);
  assert.ok(checked > 500, `only ${checked} ticker-quarters could be priced: the archive or the history is not being read`);
  const unknown = anomalies.filter((a) => !KNOWN[a.ticker]);
  assert.deepEqual(
    unknown,
    [],
    `${unknown.length} ticker(s) whose archived close is a multiple of the price the filings imply:\n` +
      unknown.map((a) => `  ${a.ticker} at ${a.date}: filed ÷ archived = ${a.ratio} over ${a.holders} holder(s), archived close ${a.close}`).join('\n')
  );
  // a known one that has been repaired: say so, so the entry is removed
  const flagged = new Set(anomalies.map((a) => a.ticker));
  for (const k of Object.keys(KNOWN)) if (!flagged.has(k)) t.diagnostic(`${k} is no longer an anomaly: remove it from KNOWN`);
  t.diagnostic(`${checked} ticker-quarters checked, ${anomalies.length} known anomalies: ${anomalies.map((a) => `${a.ticker} ×${a.ratio}`).join(', ')}`);
});
