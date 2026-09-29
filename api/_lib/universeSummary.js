// The home page's headline numbers — funds tracked and assets in the latest
// quarter — computed in one place so every page that states them agrees.
//
// Assets: the latest complete quarter (the newest quarter end whose 45-day
// filing deadline has passed), one filing per fund (its newest period, with
// amendments folded in — never the original and its amendment both), funds
// whose newest filing is older than that quarter left out. A share held by
// two funds is counted twice: 13F is a report per manager, not a census of
// securities. Option lines (puts and calls) are left out: they report the
// value of the underlying shares, not an asset the fund holds, and a few
// market makers carry trillions of them (putCallValue on each row, recorded
// by the universe build).

const DAY = 86_400_000;
export const FILING_DEADLINE_DAYS = 45;

const quarterEnds = (y) => [`${y}-03-31`, `${y}-06-30`, `${y}-09-30`, `${y}-12-31`];

// The quarter a 13F filed on `filed` normally reports: the last quarter end
// before the filing's own quarter (a filing in July–September reports June).
export function inferPeriod(filed) {
  const d = String(filed || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const y = Number(d.slice(0, 4));
  return [...quarterEnds(y - 1), ...quarterEnds(y)].filter((q) => q < d).at(-1);
}

// The newest quarter end whose filing deadline has passed at `asOf`.
export function completeQuarter(asOf) {
  const t = Date.parse(String(asOf).slice(0, 10));
  const y = new Date(t).getUTCFullYear();
  return [...quarterEnds(y - 1), ...quarterEnds(y)].filter((q) => Date.parse(q) + FILING_DEADLINE_DAYS * DAY <= t).at(-1);
}

// A universe row's report period: stated, or from the filer's submissions
// feed (filer-meta reportByAcc), or inferred from the filing date.
export function periodOf(row, reportByAcc = null) {
  return row.reportDate || reportByAcc?.[row.acc] || inferPeriod(row.filed);
}

// rows: universe.json rows ({ aum, positions, reportDate?, filed }).
export function summarizeUniverse(rows, { asOf = new Date().toISOString() } = {}) {
  const quarter = completeQuarter(asOf);
  let totalAum = 0;
  let totalPositions = 0;
  let inTotal = 0;
  let stale = 0;
  let duplicates = 0;
  let optionsExcluded = 0;
  // the same book filed under two CIKs (a filing agent's slip: Sixth Street
  // Partners carried Schwab's $751B table in 2026-Q2) is counted once
  const seen = new Set();
  for (const r of rows) {
    const p = r.reportDate || inferPeriod(r.filed);
    if (!p || p < quarter) {
      stale++;
      continue;
    }
    const book = r.aum > 0 ? `${r.aum}|${r.positions}` : null;
    if (book && seen.has(book)) {
      duplicates++;
      continue;
    }
    if (book) seen.add(book);
    inTotal++;
    const opts = Number.isFinite(r.putCallValue) ? Math.min(r.putCallValue, r.aum || 0) : 0;
    optionsExcluded += opts;
    totalAum += (Number.isFinite(r.aum) ? r.aum : 0) - opts;
    totalPositions += Number.isFinite(r.positions) ? r.positions : 0;
  }
  return { count: rows.length, quarter, inTotal, stale, duplicates, optionsExcluded: Math.round(optionsExcluded), totalAum: Math.round(totalAum), totalPositions };
}

// the label every page states the count with
export { fundCountLabel } from '../../client/src/lib/fundCount.js';
