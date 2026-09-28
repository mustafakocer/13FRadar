// Form 4 fields (security title, 10b5-1 box, footnotes) for recent
// open-market buys filed before the raw fields were kept (mid-September
// 2026). The cluster rules (api/_lib/insiderCluster.js) read the footnotes —
// "Employee Stock Purchase Plan", "purchased in the underwritten public
// offering", "private placement … directly from the issuer" — and without
// them every August cluster would be judged on numbers alone.
//
// Writes api/_data/insiders-raw-backfill.json ({ rows: { `${accession}:${li}`:
// { st, af, fn } } }); insiderStore.readRawServed merges it under the
// nightly insiders-raw.json. Only the footnotes that matter to the rules are
// kept (the file ships with the API). A line already in insiders-raw.json,
// in fpi.json or in this file is not fetched again, so a re-run costs
// nothing once it is complete.
//
//   node scripts/backfill-insider-raw.mjs            last 120 days
//   INSIDER_BACKFILL_DAYS=180 node scripts/…         further back
import fs from 'node:fs';
import path from 'node:path';
import { secGet, numCik } from '../api/_lib/sec.js';
import { loadDataset, currentRows, loadRaw, readJson, rowId } from '../api/_lib/insiderStore.js';
import { parseForm4Submission } from '../api/_lib/insiderForm4.js';

const OUT = path.join(process.cwd(), 'api', '_data', 'insiders-raw-backfill.json');
const DAYS = Number(process.env.INSIDER_BACKFILL_DAYS || 120);
const MAX_FILINGS = Number(process.env.INSIDER_BACKFILL_MAX || 5000);
const text = { responseType: 'text', transformResponse: [(x) => x] };

// footnotes worth keeping: plans, offerings, issuer sales, reinvestment,
// compensation, prices/currencies (the FPI conversion reads those too)
export const RELEVANT = /plan|espp|employee|offering|placement|issuer|underwrit|subscri|dividend|reinvest|compensation|10b5|matching|401\(k\)|retirement|price|currency|dollar|peso|depositary|\bads\b|represent|rights|warrant|unit/i;
export function compact(x) {
  if (!x) return null;
  const fn = Object.fromEntries(Object.entries(x.fn || {}).filter(([, t]) => RELEVANT.test(t)).map(([k, t]) => [k, t.slice(0, 500)]));
  const rm = x.rm && RELEVANT.test(x.rm) ? x.rm.slice(0, 500) : null;
  return { ...(x.st ? { st: x.st } : {}), ...(x.af != null ? { af: x.af } : {}), ...(Object.keys(fn).length ? { fn } : {}), ...(rm ? { rm } : {}) };
}

const db = loadDataset();
const rows = currentRows(db.rows);
const last = rows.reduce((m, r) => (r.f > m ? r.f : m), '');
const since = new Date(Date.parse(last) - DAYS * 86400000).toISOString().slice(0, 10);
const nightly = loadRaw().rows || {};
const fpiRaw = readJson(path.join(process.cwd(), 'api', '_data', 'fpi.json'), {})?.raw || {};
const prev = readJson(OUT, { rows: {} });
const store = { ...(prev.rows || {}) };

// INSIDER_BACKFILL_REREAD=BBD,SBLK: read these tickers' filings again even
// when their fields are stored — for the remarks, which only this script
// keeps for older lines — and print what they say.
const REREAD = new Set(String(process.env.INSIDER_BACKFILL_REREAD || '').split(',').filter(Boolean));
const missing = new Map();
for (const r of rows) {
  if (r.k !== 'P' || r.d < since || !r.ci) continue;
  const id = rowId(r);
  const reread = REREAD.has(r.t) && !store[id]?.rr;
  if (!reread && (nightly[id] || fpiRaw[id] || store[id])) continue;
  if (!missing.has(r.a)) missing.set(r.a, []);
  missing.get(r.a).push(r);
}
console.log(`${missing.size} filing(s) with open-market buys since ${since} have no stored Form 4 fields`);

let fetched = 0;
let filled = 0;
let failed = 0;
for (const [acc, list] of [...missing.entries()].slice(0, MAX_FILINGS)) {
  const r0 = list[0];
  const url = `https://www.sec.gov/Archives/edgar/data/${numCik(r0.ci)}/${acc}.txt`;
  try {
    const body = (await secGet(url, text)).data;
    const parsed = await parseForm4Submission(body, { filed: r0.f, path: url });
    fetched++;
    // lines stored before line indexes were kept may be numbered differently:
    // match on the trade itself
    for (const r of list) {
      const m = parsed.rows.find((p) => p.d === r.d && p.k === r.k && p.s === r.s);
      const full = m ? parsed.raw[`${acc}:${m.li}`] : null;
      const raw = full ? compact(full) : null;
      if (REREAD.has(r.t)) {
        store[rowId(r)] = { ...(nightly[rowId(r)] ? {} : raw || {}), ...(full?.rm ? { rm: full.rm.slice(0, 500) } : {}), rr: 1 };
        console.log(`  [${r.t}] ${r.d} ${r.n}: remarks ${full?.rm ? JSON.stringify(full.rm.slice(0, 300)) : '—'}; footnotes ${JSON.stringify(Object.values(full?.fn || {}).join(' | ').slice(0, 300))}`);
      } else store[rowId(r)] = raw || {};
      if (raw) filled++;
    }
  } catch (e) {
    failed++;
    console.warn(`  ${url}: ${e.response?.status || e.message}`);
  }
  if (fetched % 250 === 0 && fetched) console.log(`  ${fetched}/${missing.size}`);
}

// keep only lines that are still in the data
const live = new Set(rows.map(rowId));
// (a re-read line keeps its marker `rr`, or the next run would read it again)
for (const id of Object.keys(store)) if (!live.has(id) || (nightly[id] && !store[id].rm && !store[id].rr)) delete store[id];
console.log(`fetched ${fetched} filing(s), ${filled} line(s) filled, ${failed} failed; file holds ${Object.keys(store).length} line(s)`);
// written only when a line was added or dropped — not for a timestamp
const changed = JSON.stringify(store) !== JSON.stringify(prev.rows || {});
if (changed) {
  fs.writeFileSync(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), since, rows: store }));
  console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
} else console.log('nothing new — file unchanged');
