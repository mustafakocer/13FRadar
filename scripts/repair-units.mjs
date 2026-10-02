// Put stored 13F values into dollars, filing by filing, and keep the record.
//
//   node scripts/repair-units.mjs          # fix the files in place
//   node scripts/repair-units.mjs --check  # report only, exit 1 if anything is off
//
// The builders now judge each filing's unit against market prices as they
// read it (api/_lib/valueUnits.js via sec.js aggregatePositions). This does
// the same for what is already stored, without EDGAR:
//
//   api/_data/guru-history.json   every guru quarter (series values + aum)
//   api/_data/latest-holdings.json the latest filing of every filer (aum +
//                                  its top lines)
//   client/public/universe.json   the same filers' aum, and every row's report
//                                  period (stated, filer-meta, or the filing date)
//   client/public/universe-summary.json   the home page's headline numbers
//   api/_data/unit-corrections.json       one line per rescaled filing
//
// A filing is rescaled as a whole (never line by line) and marked `unitFix`,
// so a second run finds it in dollars and leaves it alone: the script is safe
// to run after every build, and the correction log is rebuilt from the marks.
import fs from 'node:fs';
import path from 'node:path';
import { filingScale, correctionEntry } from '../api/_lib/valueUnits.js';
import { periodOf, universeSummaryFile, writeUniverseSummaryFile } from '../api/_lib/universeSummary.js';
import { markMisfiled } from '../api/_lib/misfiledBooks.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CHECK = process.argv.includes('--check');
const file = (...p) => path.join(root, ...p);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, v) => {
  if (!CHECK) fs.writeFileSync(f, JSON.stringify(v));
};

const fixes = [];

// ---------------------------------------------------------- guru history ---
export function repairHistory(H) {
  const out = [];
  for (const [cik, g] of Object.entries(H.gurus || {})) {
    const byDate = {};
    for (const [cusip, p] of Object.entries(g.positions || {})) {
      for (const row of p.series || []) (byDate[row[0]] ??= []).push({ cusip, ticker: p.ticker, shares: row[1], value: row[2], row });
    }
    for (const q of g.quarters || []) {
      if (q.unitFix) continue;
      const rows = byDate[q.reportDate] || [];
      const v = filingScale(rows, q.reportDate);
      if (v.factor === 1) continue;
      for (const r of rows) r.row[2] = Math.round(r.row[2] * v.factor);
      q.aum = Math.round(q.aum * v.factor);
      q.unitFix = { factor: v.factor, by: 'market-price', median: v.median, priced: v.priced, agree: v.agree };
      out.push({ cik, name: g.name, period: q.reportDate, acc: q.acc, filed: q.filed });
    }
  }
  return out;
}

// ------------------------------------------------ latest filing per filer ---
export function repairLatest(L, universeRows, reportByCik = {}) {
  const out = [];
  const rowByCik = new Map(universeRows.map((r) => [r.cik, r]));
  for (const [cik, e] of Object.entries(L.byCik || {})) {
    const u = rowByCik.get(cik);
    const period = periodOf({ reportDate: e.reportDate, acc: e.acc, filed: e.filed }, reportByCik[cik]);
    if (e.unitFix) continue;
    const v = filingScale((e.top || []).map((p) => ({ ...p })), period);
    if (v.factor === 1) continue;
    e.aum = Math.round(e.aum * v.factor);
    for (const p of e.top || []) p.value = Math.round(p.value * v.factor);
    e.unitFix = { factor: v.factor, by: 'market-price', median: v.median, priced: v.priced, agree: v.agree };
    if (u && u.acc === e.acc) u.aum = Math.round(u.aum * v.factor);
    out.push({ cik, name: u?.name, period, acc: e.acc, filed: e.filed });
  }
  return out;
}

// every universe row gets its report period; one filed on the same day as
// others (several periods at once) is dated from filer-meta, not the index
export function datePeriods(rows, reportByCik = {}) {
  for (const r of rows) {
    const p = periodOf(r, reportByCik[r.cik]);
    if (p && !r.reportDate) {
      r.reportDate = p;
      r.periodFrom = reportByCik[r.cik]?.[r.acc] ? 'submissions' : 'filing-date';
    }
  }
  return rows;
}

// the log: every marked filing, newest first
export function correctionLog(H, L, universeRows) {
  const names = new Map(universeRows.map((r) => [r.cik, r.name]));
  const rows = [];
  for (const [cik, g] of Object.entries(H.gurus || {})) {
    for (const q of g.quarters || []) {
      if (q.unitFix?.by === 'market-price' || q.unitFix?.factor) rows.push(correctionEntry({ cik, name: g.name, period: q.reportDate, acc: q.acc, filed: q.filed, verdict: { ...q.unitFix, median: q.unitFix.median ?? NaN, agree: q.unitFix.agree ?? NaN, priced: q.unitFix.priced ?? 0 }, source: 'guru-history' }));
    }
  }
  for (const [cik, e] of Object.entries(L.byCik || {})) {
    if (e.unitFix?.factor) rows.push(correctionEntry({ cik, name: names.get(cik), period: e.reportDate || null, acc: e.acc, filed: e.filed, verdict: { ...e.unitFix, median: e.unitFix.median ?? NaN, agree: e.unitFix.agree ?? NaN, priced: e.unitFix.priced ?? 0 }, source: 'latest-holdings' }));
  }
  return rows.sort((a, b) => (b.period || '').localeCompare(a.period || '') || a.cik.localeCompare(b.cik));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const H = readJson(file('api/_data/guru-history.json'));
  const L = readJson(file('api/_data/latest-holdings.json'));
  const U = readJson(file('client/public/universe.json'));
  const meta = readJson(file('api/_data/filer-meta.json')).byCik || {};
  const reportByCik = Object.fromEntries(Object.entries(meta).map(([cik, m]) => [cik, m.reportByAcc || {}]));

  const h = repairHistory(H);
  const l = repairLatest(L, U.rows, reportByCik);
  datePeriods(U.rows, reportByCik);
  markMisfiled(U.rows);
  U.rows.sort((a, b) => b.aum - a.aum);
  fixes.push(...h, ...l);
  console.log(`guru-history: ${h.length} filings rescaled${h.length ? ` (${[...new Set(h.map((x) => x.name))].join(', ')})` : ''}`);
  console.log(`latest-holdings / universe: ${l.length} filings rescaled`);

  const summary = universeSummaryFile(U, root);
  console.log(`universe-summary: ${summary.count} funds, ${summary.inTotal} in the ${summary.quarter} total, $${(summary.totalAum / 1e12).toFixed(2)}T`);

  const log = correctionLog(H, L, U.rows);
  if (CHECK) {
    if (fixes.length) {
      console.log(`::error::${fixes.length} filing(s) in the wrong unit`);
      process.exit(1);
    }
    process.exit(0);
  }
  writeJson(file('api/_data/guru-history.json'), H);
  writeJson(file('api/_data/latest-holdings.json'), L);
  writeJson(file('client/public/universe.json'), U);
  writeUniverseSummaryFile(U, root);
  // the timestamp moves only when the record does, so a clean run commits nothing
  const logFile = file('api/_data/unit-corrections.json');
  const before = fs.existsSync(logFile) ? readJson(logFile) : null;
  const same = before && JSON.stringify(before.corrections) === JSON.stringify(log);
  fs.writeFileSync(logFile, JSON.stringify({ updatedAt: same ? before.updatedAt : new Date().toISOString(), count: log.length, corrections: log }, null, 1));
  console.log(`unit-corrections.json: ${log.length} filings on record`);
}
