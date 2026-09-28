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
  return { ...(x.st ? { st: x.st } : {}), ...(x.af != null ? { af: x.af } : {}), ...(Object.keys(fn).length ? { fn } : {}) };
}

const db = loadDataset();
const rows = currentRows(db.rows);
const last = rows.reduce((m, r) => (r.f > m ? r.f : m), '');
const since = new Date(Date.parse(last) - DAYS * 86400000).toISOString().slice(0, 10);
const nightly = loadRaw().rows || {};
const fpiRaw = readJson(path.join(process.cwd(), 'api', '_data', 'fpi.json'), {})?.raw || {};
const prev = readJson(OUT, { rows: {} });
const store = { ...(prev.rows || {}) };

const missing = new Map();
for (const r of rows) {
  if (r.k !== 'P' || r.d < since || !r.ci) continue;
  const id = rowId(r);
  if (nightly[id] || fpiRaw[id] || store[id]) continue;
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
      const raw = m ? compact(parsed.raw[`${acc}:${m.li}`]) : null;
      store[rowId(r)] = raw || {};
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
for (const id of Object.keys(store)) if (!live.has(id) || nightly[id]) delete store[id];
console.log(`fetched ${fetched} filing(s), ${filled} line(s) filled, ${failed} failed; file holds ${Object.keys(store).length} line(s)`);
if (filled || Object.keys(store).length !== Object.keys(prev.rows || {}).length) {
  fs.writeFileSync(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), since, rows: store }));
  console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
} else console.log('nothing new — file unchanged');
