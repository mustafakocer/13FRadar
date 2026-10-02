import fs from 'node:fs';
import path from 'node:path';

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

// The filing a row is counted from in the `quarter` total: its own, or — a
// fund that has already filed a newer period (Q3 filings start on 1 October,
// while Q2 stays the reference until 14 November) — the reference period's
// filing the build keeps on the row as `ref`. The newer filing still drives
// the fund's page and the rankings; it never moves the fund out of, or
// changes its amount in, the quarter's total.
export function countedFiling(r, quarter) {
  const p = r.reportDate || inferPeriod(r.filed);
  if (p && p > quarter && r.ref?.reportDate === quarter) return { ...r, ...r.ref, misfiled: r.ref.misfiled, cik: r.cik, viaRef: true };
  return r;
}

// rows: universe.json rows ({ aum, positions, reportDate?, filed, ref? }).
export function summarizeUniverse(rows, { asOf = new Date().toISOString(), sameBooks = [] } = {}) {
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
  // and a subsidiary's book its parent also files (config/duplicate-books.json)
  const dropped = new Set(sameBooks.map((p) => String(p.drop).padStart(10, '0')));
  let fromReference = 0;
  for (const row of rows) {
    const r = countedFiling(row, quarter);
    const p = r.reportDate || inferPeriod(r.filed);
    if (!p || p < quarter) {
      stale++;
      continue;
    }
    const book = r.aum > 0 ? `${r.aum}|${r.positions}` : null;
    // …and a filing that carries another filer's table (misfiledBooks.js)
    if ((book && seen.has(book)) || dropped.has(r.cik) || r.misfiled) {
      duplicates++;
      continue;
    }
    if (book) seen.add(book);
    inTotal++;
    if (r.viaRef) fromReference++;
    const opts = Number.isFinite(r.putCallValue) ? Math.min(r.putCallValue, r.aum || 0) : 0;
    optionsExcluded += opts;
    totalAum += (Number.isFinite(r.aum) ? r.aum : 0) - opts;
    totalPositions += Number.isFinite(r.positions) ? r.positions : 0;
  }
  return { count: rows.length, quarter, inTotal, stale, duplicates, fromReference, optionsExcluded: Math.round(optionsExcluded), totalAum: Math.round(totalAum), totalPositions };
}

// THE contents of client/public/universe-summary.json, from universe.json's
// rows: the only way that file is written (build-universe, repair-units,
// measure-options all call writeUniverseSummaryFile). A run on older code once
// wrote it by another definition ($79T, options and stale funds counted):
// tests/universe-summary-file.test.mjs and the Site check hold the file to
// this function.
//
// updatedAt is when the file was written (every writer moves it: the nightly
// build, and repair-units on every consensus run); dataUpdatedAt is when
// universe.json was built, which also fixes the reference quarter, so a
// later rewrite never moves the quarter by itself.
export function universeSummaryFile(U, root = process.cwd(), { now = new Date().toISOString() } = {}) {
  return { updatedAt: now, dataUpdatedAt: U.updatedAt, ...summarizeUniverse(U.rows || [], { asOf: U.updatedAt, sameBooks: loadSameBooks(root) }) };
}

export function writeUniverseSummaryFile(U, root = process.cwd()) {
  const summary = universeSummaryFile(U, root);
  fs.writeFileSync(path.join(root, 'client', 'public', 'universe-summary.json'), JSON.stringify(summary));
  return summary;
}

// The reviewed list of books filed twice (parent and subsidiary).
export function loadSameBooks(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'config', 'duplicate-books.json'), 'utf8')).pairs || [];
  } catch {
    return [];
  }
}

// One universe.json row from a filer's snapshot — what the nightly universe
// build writes. putCallValue (the option lines' notional) is computed here on
// every run, so the headline total never falls back to counting options.
export function universeRow({ cik, name }, snap) {
  const positions = snap.positions || [];
  const top10 = positions.slice(0, 10).reduce((s, p) => s + (p.weight || 0), 0);
  return {
    cik: String(cik).padStart(10, '0'),
    name,
    filed: snap.filed,
    // the accession these numbers were computed from (the period's base
    // document), so the filings feed attaches them to that filing and not to
    // a later amendment
    acc: snap.acc,
    ...(snap.reportDate ? { reportDate: snap.reportDate, periodFrom: snap.periodFrom } : {}),
    aum: Math.round(snap.aum),
    putCallValue: Math.round(positions.reduce((s, p) => s + (p.putCall ? p.value : 0), 0)),
    // the filer's own declared total (cover page), for the nightly check
    ...(Number.isFinite(snap.declared) ? { declared: Math.round(snap.declared) } : {}),
    ...(snap.declaredAlt?.length ? { declaredAlt: snap.declaredAlt.map(Math.round) } : {}),
    // the reference quarter's filing, when the newest is a later period
    ...(snap.ref ? { ref: referenceRow(snap.ref) } : {}),
    positions: positions.length,
    top10: Number(top10.toFixed(1)),
  };
}

// The reference period's figures a row keeps when its newest filing is a
// later period (see countedFiling): what summarizeUniverse needs, no more.
export function referenceRow(snap) {
  const positions = snap.positions || [];
  return {
    reportDate: snap.reportDate,
    acc: snap.acc,
    filed: snap.filed,
    aum: Math.round(snap.aum),
    putCallValue: Math.round(positions.reduce((s, p) => s + (p.putCall ? p.value : 0), 0)),
    positions: positions.length,
  };
}

// the label every page states the count with
export { fundCountLabel } from '../../client/src/lib/fundCount.js';
