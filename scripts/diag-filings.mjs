// Read named filers' current filings document by document and print what
// is in each (commits nothing; diag-filings.yml). For a fund whose total we
// read far below its declared one: is the table split over several files,
// misread, or in another unit?
//
//   node scripts/diag-filings.mjs 0001081019 0001777271 …
//
// Per filer: every document in the submission (name, type, size); for each
// XML that is not the cover page, its infoTable line count and value sum;
// the cover page's declared entry count and value total; the implied price
// against the quarter-end close over the largest priced lines; the ten
// largest lines of the combined table.
import fs from 'node:fs';
import path from 'node:path';
import { secGet, numCik, parse13F, fetchCoverPage, aggregatePositions } from '../api/_lib/sec.js';
import { filingScale } from '../api/_lib/valueUnits.js';
import { inferPeriod } from '../api/_lib/universeSummary.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const U = JSON.parse(fs.readFileSync(path.join(root, 'client', 'public', 'universe.json'), 'utf8'));
const byCik = new Map(U.rows.map((r) => [r.cik, r]));
const $ = (v) => (v == null ? '—' : `$${(v / 1e9).toFixed(3)}B`);

for (const arg of process.argv.slice(2)) {
  const cik = arg.padStart(10, '0');
  const r = byCik.get(cik);
  if (!r) {
    console.log(`\n## ${cik}: not in universe.json`);
    continue;
  }
  const period = r.reportDate || inferPeriod(r.filed);
  console.log(`\n## ${r.name} (${cik}) ${r.acc} filed ${r.filed} period ${period}; stored ${$(r.aum)}, ${r.positions} positions`);
  try {
    const base = `https://www.sec.gov/Archives/edgar/data/${numCik(cik)}/${r.acc.replace(/-/g, '')}`;
    const idx = (await secGet(`${base}/index.json`)).data;
    let items = idx?.directory?.item || [];
    if (!Array.isArray(items)) items = [items];
    for (const i of items) console.log(`DOC ${cik} ${i.name} ${i.type || ''} ${i.size || ''}`);
    const cover = await fetchCoverPage(cik, r.acc);
    console.log(`COVER ${cik} entries=${cover?.tableEntryTotal ?? 'NA'} value=${cover?.tableValueTotal ?? 'NA'} (${$(cover?.tableValueTotal)}) amendment=${cover?.isAmendment ? cover.amendmentType : 'no'}`);
    const all = [];
    for (const i of items.filter((x) => /\.xml$/i.test(x.name) && !/primary_doc/i.test(x.name))) {
      const xml = (await secGet(`${base}/${i.name}`, { responseType: 'text', transformResponse: [(d) => d] })).data;
      let rows = [];
      try {
        rows = await parse13F(xml);
      } catch (e) {
        console.log(`XML ${cik} ${i.name} parse error: ${e.message}`);
      }
      const sum = rows.reduce((s, x) => s + (Number(x.value) || 0), 0);
      console.log(`XML ${cik} ${i.name} bytes=${xml.length} lines=${rows.length} valueSum=${sum} (${$(sum)})`);
      all.push(...rows);
    }
    const agg = aggregatePositions(all, r.filed, { period });
    const v = filingScale(agg.positions.filter((p) => !p.putCall).slice(0, 25).map((p) => ({ ...p })), period);
    console.log(`ALL ${cik} lines=${all.length} positions=${agg.positions.length} total=${Math.round(agg.aum)} (${$(agg.aum)}) unitFix=${JSON.stringify(agg.unitFix || null)} impliedPrice/close median=${v.median ?? 'NA'} priced=${v.priced} agree=${v.agree ?? 'NA'}`);
    for (const p of agg.positions.slice(0, 10)) console.log(`TOP ${cik} ${p.cusip} ${p.putCall || '-'} ${String(p.issuer).slice(0, 30).replace(/\s+/g, '_')} shares=${p.shares} value=${Math.round(p.value)} px=${p.shares ? (p.value / p.shares).toFixed(2) : 'NA'}`);
  } catch (e) {
    console.log(`FAILED ${cik} ${e.message}`);
  }
}
