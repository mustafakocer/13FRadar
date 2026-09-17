// Builds client/public/filings.json — the rolling feed of 13F filings as they
// arrive, behind /filings.
//
//   node scripts/build-filings.mjs
//
// Env: SEC_USER_AGENT (recommended), FILINGS_DAYS (business days to scan back,
// default 10), FILINGS_WINDOW (days kept in the file, default 120),
// FILER_META_BUDGET (submissions lookups per run, default 400).
//
// Cost is one small index file per business day plus a bounded number of
// submissions lookups, so this is cheap enough to run daily alongside the
// consensus build. The last few days are re-read every run on purpose: EDGAR
// keeps adding to a day's index after midnight, and re-reading is free because
// the merge de-duplicates by accession.
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { parseFilingIndex, mergeFilings, joinUniverse, quartersOf } from '../api/_lib/filings.js';

const DAYS = Number(process.env.FILINGS_DAYS || 10);
const WINDOW = Number(process.env.FILINGS_WINDOW || 120);
const META_BUDGET = Number(process.env.FILER_META_BUDGET || 400);
const UA = process.env.SEC_USER_AGENT || 'Fundocap filings build (contact via fundocap.com)';

const root = process.cwd();
const pub = path.join(root, 'client', 'public');
const dataDir = path.join(root, 'api', '_data');
const OUT = path.join(pub, 'filings.json');
const META = path.join(dataDir, 'filer-meta.json');

const http = axios.create({ headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' }, timeout: 30000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (d) => d.toISOString().slice(0, 10);
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

const quarterNum = (day) => Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1;

// Business days, newest first. Weekends never have an index; holidays answer
// 403 (not 404) and are simply skipped — see the note in insiderModel.js.
function businessDaysBack(n) {
  const out = [];
  const cur = new Date();
  while (out.length < n) {
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(iso(cur));
    cur.setUTCDate(cur.getUTCDate() - 1);
  }
  return out;
}

async function dayIndex(day) {
  const url = `https://www.sec.gov/Archives/edgar/daily-index/${day.slice(0, 4)}/QTR${quarterNum(day)}/form.${day.replace(/-/g, '')}.idx`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, status } = await http.get(url, {
      responseType: 'text',
      transformResponse: [(x) => x],
      validateStatus: () => true,
    });
    if (status === 200 && typeof data === 'string') return data;
    if (status !== 429 && status !== 403) return null; // 404: no index that day
    await sleep(4000 * (attempt + 1));
  }
  return null;
}

// data.sec.gov lists every filing a filer has made, so one request fills in the
// report period for all of their accessions at once — and their address, which
// the filer directory filters by. Both are stored, because asking again next
// week for a value that does not change is the expensive way to be wrong.
async function submissions(cik) {
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const { data, status } = await http.get(url, { validateStatus: () => true });
  if (status !== 200 || !data) return null;
  const recent = data.filings?.recent || {};
  const reportByAcc = {};
  const accs = recent.accessionNumber || [];
  for (let i = 0; i < accs.length; i++) {
    if (recent.reportDate?.[i]) reportByAcc[accs[i]] = recent.reportDate[i];
  }
  const addr = data.addresses?.business || {};
  return {
    name: data.name || null,
    state: addr.stateOrCountry || null,
    city: addr.city || null,
    reportByAcc,
  };
}

const stored = readJson(OUT, { rows: [] });
const universe = readJson(path.join(pub, 'universe.json'), { rows: [] });
const meta = readJson(META, { updatedAt: null, byCik: {} });

const days = businessDaysBack(DAYS);
console.log(`Scanning ${days.length} business days back to ${days[days.length - 1]}…`);

const incoming = [];
let misses = 0;
for (const day of days) {
  const text = await dayIndex(day);
  if (!text) {
    misses++;
    console.log(`  ${day}: no index`);
    continue;
  }
  const rows = parseFilingIndex(text);
  incoming.push(...rows);
  console.log(`  ${day}: ${rows.length} 13F filings`);
  await sleep(300);
}

// Every index read cleanly and not one line matched. That is what a parser
// that cannot read the index it was given looks like, and it is also what a
// genuinely quiet stretch looks like, since 13F filings bunch up around the
// 45-day deadline. It is not an error, so say it loudly instead of failing:
// a silent zero is how eight empty days went unnoticed.
if (!incoming.length && misses < days.length) {
  console.log(
    `::warning::${days.length - misses} index files read, no 13F line in any of them — ` +
      'expected between deadlines, worth checking the parser if it persists past one.'
  );
}

// A run that reads nothing must not overwrite a good file with an empty one.
if (!incoming.length && misses === days.length) {
  console.error('No index could be read — keeping the stored feed.');
  process.exit(stored.rows?.length ? 0 : 1);
}

let rows = mergeFilings(stored.rows || [], incoming, { today: iso(new Date()), windowDays: WINDOW });

// Fill in report periods and addresses for filers we have not looked up yet,
// newest filing first so the top of the feed is complete before the tail.
const need = [];
for (const r of rows) {
  if (need.length >= META_BUDGET) break;
  const m = meta.byCik[r.cik];
  if (m && (m.reportByAcc?.[r.acc] || m.checkedAt >= r.filed)) continue;
  if (!need.includes(r.cik)) need.push(r.cik);
}
if (need.length) {
  console.log(`Looking up ${need.length} filers…`);
  let done = 0;
  for (const cik of need) {
    try {
      const s = await submissions(cik);
      if (s) {
        meta.byCik[cik] = {
          ...(meta.byCik[cik] || {}),
          ...s,
          reportByAcc: { ...(meta.byCik[cik]?.reportByAcc || {}), ...s.reportByAcc },
          checkedAt: iso(new Date()),
        };
      }
    } catch {
      /* a filer we cannot read keeps its stored entry and is retried next run */
    }
    if (++done % 100 === 0) console.log(`  ${done}/${need.length}`);
    await sleep(140); // ~7 req/s, inside SEC's guidance
  }
  meta.updatedAt = new Date().toISOString();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(META, JSON.stringify(meta));
}

rows = rows.map((r) => {
  const m = meta.byCik[r.cik];
  return {
    ...r,
    reportDate: m?.reportByAcc?.[r.acc] ?? r.reportDate ?? null,
    state: m?.state ?? null,
  };
});
rows = joinUniverse(rows, universe.rows || []);

fs.mkdirSync(pub, { recursive: true });
fs.writeFileSync(
  OUT,
  JSON.stringify({
    updatedAt: new Date().toISOString(),
    count: rows.length,
    quarters: quartersOf(rows),
    rows,
  })
);
// A compact CIK → state map for the filer directory and the fund screener.
// Everything the submissions lookups have learned so far, not only the filers
// in the current window, so the filter keeps working as the window rolls.
const byCik = {};
for (const [cik, m] of Object.entries(meta.byCik)) {
  if (m?.state) byCik[cik] = m.state;
}
fs.writeFileSync(
  path.join(pub, 'filer-states.json'),
  JSON.stringify({ updatedAt: new Date().toISOString(), count: Object.keys(byCik).length, byCik })
);
console.log(`filer-states.json: ${Object.keys(byCik).length} filers with an address`);

console.log(
  `filings.json: ${rows.length} filings (${rows.filter((r) => r.amended).length} amendments, ${rows.filter((r) => r.reportDate).length} with a period, ${rows.filter((r) => r.aum != null).length} with figures)`
);
