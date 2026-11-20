// Real 13F filings, as filed, for tests/edgar-reconcile.test.mjs.
//
//   node tests/fixtures/make-edgar-fixtures.mjs
//
// For every fund below this stores, under tests/fixtures/edgar/:
//   filings/<cik>/<accession>/infotable.xml    the information table, byte for byte
//   filings/<cik>/<accession>/primary_doc.xml  the cover page (the filer's own
//                                              count and total; amendment type)
//   filings/<cik>/<accession>/closes.json      { cusip: close at the period end }
//                                              for the rows we can price — what
//                                              the unit and column checks
//                                              (valueUnits.js) read, frozen so
//                                              the test never opens the nightly
//                                              price archive
//   manifest.json                              one entry per fund: the filing,
//                                              its amendments, and what the site
//                                              stored for it that day
//                                              (api/_data/latest-holdings.json)
//
// The funds (config/reconcile-funds.json) are picked for the ways a 13F table
// goes wrong, not at random; `why` says which. Re-running refreshes every fixture to each fund's latest
// filing — the test reads only the manifest, so it follows without edits.
//
// Network: www.sec.gov through the project's own EDGAR client (rate clock,
// retries). Set SEC_USER_AGENT to something that identifies you.
import fs from 'node:fs';
import path from 'node:path';
import { secGet, numCik } from '../../api/_lib/sec.js';
import { defaultCloseOf } from '../../api/_lib/valueUnits.js';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..', '..');
const out = path.join(here, 'edgar');

// config/reconcile-funds.json: the list the live check
// (scripts/reconcile-edgar.mjs) reads too; the books too large to commit are
// left to that check.
export const FUNDS = JSON.parse(fs.readFileSync(path.join(root, 'config', 'reconcile-funds.json'), 'utf8')).funds.filter((f) => f.fixture !== false);

const text = { responseType: 'text', transformResponse: [(d) => d] };

async function fetchFiling(cik, acc) {
  const base = `https://www.sec.gov/Archives/edgar/data/${numCik(cik)}/${acc.replace(/-/g, '')}`;
  let items = (await secGet(`${base}/index.json`)).data?.directory?.item || [];
  if (!Array.isArray(items)) items = [items];
  const xmls = items.filter((i) => /\.xml$/i.test(i.name) && !/primary_doc/i.test(i.name));
  // the table is the XML document that holds an <informationTable>; the
  // name is the filer's choice, so the content decides
  let table = null;
  for (const x of xmls.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0))) {
    const body = (await secGet(`${base}/${x.name}`, text)).data;
    if (/<(?:[\w-]+:)?informationTable[\s>]/i.test(body)) {
      table = body;
      break;
    }
  }
  if (!table) throw new Error(`${cik} ${acc}: no information table among ${xmls.map((x) => x.name).join(', ')}`);
  const coverName = items.find((i) => /^primary_doc\.xml$/i.test(i.name))?.name;
  const cover = coverName ? (await secGet(`${base}/${coverName}`, text)).data : null;
  return { table, cover };
}

const tag = (block, name) => {
  const m = block.match(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>\\s*([^<]*?)\\s*</(?:[\\w-]+:)?${name}>`, 'i'));
  return m ? m[1] : '';
};

function closesFor(table, period) {
  const closes = {};
  for (const m of table.matchAll(/<(?:[\w-]+:)?infoTable(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?infoTable>/gi)) {
    const cusip = tag(m[1], 'cusip').toUpperCase();
    if (!cusip || cusip in closes) continue;
    const close = defaultCloseOf({ cusip }, period);
    if (close) closes[cusip] = close;
  }
  return closes;
}

function store(cik, acc, { table, cover }, period) {
  const dir = path.join(out, 'filings', numCik(cik), acc.replace(/-/g, ''));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'infotable.xml'), table);
  if (cover) fs.writeFileSync(path.join(dir, 'primary_doc.xml'), cover);
  fs.writeFileSync(path.join(dir, 'closes.json'), `${JSON.stringify(closesFor(table, period), null, 1)}\n`);
  return Buffer.byteLength(table);
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const latest = JSON.parse(fs.readFileSync(path.join(root, 'api', '_data', 'latest-holdings.json'), 'utf8')).byCik;
  const names = JSON.parse(fs.readFileSync(path.join(root, 'api', '_data', 'slugs.json'), 'utf8')).byCik;
  fs.rmSync(path.join(out, 'filings'), { recursive: true, force: true });
  const funds = [];
  for (const f of FUNDS) {
    const e = latest[f.cik];
    if (!e) throw new Error(`${f.cik} is not in latest-holdings.json`);
    let bytes = store(f.cik, e.acc, await fetchFiling(f.cik, e.acc), e.reportDate);
    for (const a of e.amendments || []) bytes += store(f.cik, a.acc, await fetchFiling(f.cik, a.acc), e.reportDate);
    funds.push({
      cik: f.cik,
      name: names[f.cik]?.name || null,
      why: f.why,
      acc: e.acc,
      filed: e.filed,
      reportDate: e.reportDate,
      amendments: (e.amendments || []).map((a) => ({ acc: a.acc, filingDate: a.filingDate, type: a.type })),
      // what the site stored for this filing on the day of the fetch
      site: { aum: e.aum, count: e.count, putCallValue: e.putCallValue ?? null, unitFactor: e.unitFix?.factor ?? 1, top: e.top },
    });
    console.log(`${f.cik} ${names[f.cik]?.name || ''}: ${e.acc}${e.amendments?.length ? ` + ${e.amendments.length} amendment(s)` : ''}, ${(bytes / 1024).toFixed(0)} KB`);
  }
  fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify({ fetchedAt: new Date().toISOString().slice(0, 10), source: 'https://www.sec.gov/Archives/edgar/data/<cik>/<accession>/', funds }, null, 1)}\n`);
  console.log(`${funds.length} funds → ${path.relative(root, out)}`);
}
