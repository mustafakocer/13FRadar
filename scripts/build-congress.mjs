// Builds the Congress trading dataset from the two official STOCK Act sources.
//
//   node scripts/build-congress.mjs            normal run (new filings only)
//   node scripts/build-congress.mjs --dry-run  read the indexes, fetch nothing, write nothing
//
// Sources (both public, no key):
//   House  — the Clerk's yearly index <YEAR>FD.zip (FD.xml: one <Member> per
//            filing; FilingType P = periodic transaction report) and each
//            PTR's PDF. E-filed PDFs carry text and are parsed
//            (api/_lib/congressParse.js); paper filings are scans, recorded
//            as such and not read.
//   Senate — efdsearch.senate.gov: agree to the terms, page through the PTR
//            index, read each e-filed report's table. Paper reports are
//            images, recorded and skipped. The site answers US addresses
//            only, so this runs in GitHub Actions.
// Who filed is matched to the unitedstates/congress-legislators records for
// party, state and committees (api/_lib/congressMembers.js).
//
// Every PTR read is kept in api/_data/congress-filings.json, so a run fetches
// only what is new (and retries a failed filing up to three times). The run
// writes what it collected and THEN exits non-zero when an index could not
// be read, too many filings failed, or nothing at all was served — the
// workflow commits the data and raises the alarm.
//
// Env: CONGRESS_SINCE (first filing day kept, default 2025-01-01),
//      CONGRESS_MAX_FETCH (filings fetched per run, default 1500),
//      CONGRESS_UA (User-Agent), CONGRESS_DATA_DIR (tests).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { housePdfUrl, linesFromItems, parseHouseIndex, parseHousePtr, parseSenateIndexRow, parseSenatePtr, SENATE_BASE } from '../api/_lib/congressParse.js';
import { committeeSeats, indexLegislators } from '../api/_lib/congressMembers.js';
import { buildServed } from '../api/_lib/congressModel.js';
import { files, readJson, writeJson } from '../api/_lib/congressStore.js';
import { readSeries } from '../api/_lib/priceStore.js';
import { mapLimit } from '../api/_lib/mapLimit.js';
import { fetchSecTickers, fetchSectors } from '../api/_lib/marketData.js';

const DRY = process.argv.includes('--dry-run');
const SINCE = process.env.CONGRESS_SINCE || '2025-01-01';
const MAX_FETCH = Number(process.env.CONGRESS_MAX_FETCH || 1500);
const MAX_TRIES = 3;
const UA = process.env.CONGRESS_UA || 'Fundocap congress bot (https://www.fundocap.co)';
const LEGIS = 'https://raw.githubusercontent.com/unitedstates/congress-legislators/gh-pages';
const now = Date.now();
const problems = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, opts = {}, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(60000) });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch (e) {
      last = e;
      await sleep(2000 * 2 ** i);
    }
  }
  throw last;
}
const getJson = async (url) => {
  const r = await get(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
};

// ------------------------------------------------------------ House

async function houseIndex(year) {
  const r = await get(`https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${year}FD.zip`);
  if (!r.ok) throw new Error(`House ${year}FD.zip: HTTP ${r.status}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'house-'));
  const zip = path.join(dir, 'fd.zip');
  fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
  execFileSync('unzip', ['-o', '-q', zip, `${year}FD.xml`, '-d', dir]);
  const xml = fs.readFileSync(path.join(dir, `${year}FD.xml`), 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return parseHouseIndex(xml);
}

let pdfjs = null;
async function housePages(buf) {
  pdfjs ||= await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, verbosity: 0 }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    pages.push(linesFromItems((await page.getTextContent()).items));
  }
  await doc.destroy();
  return pages;
}

async function readHouse(f) {
  const r = await get(f.url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const parsed = parseHousePtr(await housePages(await r.arrayBuffer()));
  if (!parsed.text) return { status: 'scan', tx: [] };
  return { status: parsed.tx.length ? 'ok' : 'empty', tx: parsed.tx };
}

// ------------------------------------------------------------ Senate

function senateSession() {
  const jar = new Map();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const keep = (r) => {
    for (const c of r.headers.getSetCookie?.() || []) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1));
    }
  };
  const req = async (url, opts = {}) => {
    const r = await get(url, { ...opts, headers: { Cookie: cookie(), ...(opts.headers || {}) } });
    keep(r);
    return r;
  };
  return {
    async open() {
      const home = await req(`${SENATE_BASE}/search/home/`);
      const token = (/name="csrfmiddlewaretoken" value="([^"]+)"/.exec(await home.text()) || [])[1];
      if (!token) throw new Error(`Senate eFD: no form token (HTTP ${home.status})`);
      const agree = await req(`${SENATE_BASE}/search/home/`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${SENATE_BASE}/search/home/` },
        body: new URLSearchParams({ csrfmiddlewaretoken: token, prohibition_agreement: '1' }),
      });
      if (agree.status >= 400) throw new Error(`Senate eFD: agreement refused (HTTP ${agree.status})`);
    },
    async index(since) {
      const [y, m, d] = since.split('-');
      const out = [];
      for (let start = 0; ; start += 100) {
        const r = await req(`${SENATE_BASE}/search/report/data/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${SENATE_BASE}/search/`, 'X-CSRFToken': jar.get('csrftoken') || '' },
          body: new URLSearchParams({
            start: String(start),
            length: '100',
            report_types: '[11]',
            filer_types: '[]',
            submitted_start_date: `${m}/${d}/${y} 00:00:00`,
            submitted_end_date: '',
            candidate_state: '',
            senator_state: '',
            office_id: '',
            first_name: '',
            last_name: '',
            csrfmiddlewaretoken: jar.get('csrftoken') || '',
          }),
        });
        if (!r.ok) throw new Error(`Senate index: HTTP ${r.status}`);
        const j = await r.json();
        const page = (j.data || []).map(parseSenateIndexRow).filter(Boolean);
        out.push(...page);
        if (page.length < 100 || out.length >= Number(j.recordsFiltered || 0)) break;
        await sleep(500);
      }
      return out;
    },
    async report(url) {
      const r = await req(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      // a lapsed session lands on the agreement page instead of the report
      if (/prohibition_agreement/.test(html)) throw new Error('session lapsed');
      return parseSenatePtr(html);
    },
  };
}

// ------------------------------------------------------------ run

const state = readJson(files.filings(), { filings: {} });
const filings = state.filings || {};
const stats = { house: { indexed: 0, fetched: 0, ok: 0, scan: 0, empty: 0, error: 0 }, senate: { indexed: 0, fetched: 0, ok: 0, paper: 0, empty: 0, error: 0 } };

const want = (key) => {
  const f = filings[key];
  return !f || (f.status === 'error' && (f.tries || 0) < MAX_TRIES);
};

// House: every year the window touches
const houseTodo = [];
for (let y = Number(SINCE.slice(0, 4)); y <= new Date(now).getUTCFullYear(); y++) {
  try {
    const list = (await houseIndex(y)).filter((f) => f.filed >= SINCE);
    stats.house.indexed += list.length;
    for (const f of list) {
      const key = `H:${f.docId}`;
      const base = { ch: 'H', id: f.docId, filed: f.filed, first: f.first, last: f.last, stateDst: f.stateDst, url: housePdfUrl(f.year, f.docId) };
      // the index can correct a name or a seat after the fact
      if (filings[key]) Object.assign(filings[key], base);
      if (want(key)) houseTodo.push({ key, ...base });
    }
    console.log(`House ${y}: ${list.length} PTRs since ${SINCE}`);
  } catch (e) {
    problems.push(`House index ${y}: ${e.message}`);
  }
}

// Senate
const senate = senateSession();
const senateTodo = [];
try {
  await senate.open();
  const list = await senate.index(SINCE);
  stats.senate.indexed = list.length;
  for (const f of list) {
    const key = `S:${f.id}`;
    const base = { ch: 'S', id: f.id, filed: f.filed, first: f.first, last: f.last, stateDst: null, url: f.url, title: f.title };
    if (f.paper) {
      if (!filings[key]) filings[key] = { ...base, status: 'paper', tx: [] };
      continue;
    }
    if (filings[key]) Object.assign(filings[key], base);
    if (want(key)) senateTodo.push({ key, ...base });
  }
  console.log(`Senate: ${list.length} PTRs since ${SINCE}`);
} catch (e) {
  problems.push(`Senate index: ${e.message}`);
}

const budget = { left: MAX_FETCH };
const take = (list) => list.sort((a, b) => b.filed.localeCompare(a.filed)).splice(0, Math.max(0, budget.left));
const houseNow = take(houseTodo);
budget.left -= houseNow.length;
const senateNow = take(senateTodo);
console.log(`to read: House ${houseNow.length}, Senate ${senateNow.length}${houseTodo.length + senateTodo.length ? ` (${houseTodo.length + senateTodo.length} left for later runs)` : ''}`);

const record = (f, res, chamber) => {
  stats[chamber].fetched += 1;
  stats[chamber][res.status] = (stats[chamber][res.status] || 0) + 1;
  const { key, ...base } = f;
  filings[key] = { ...base, ...res, readAt: new Date().toISOString() };
};
const fail = (f, e, chamber) => record(f, { status: 'error', err: String(e.message || e).slice(0, 200), tries: (filings[f.key]?.tries || 0) + 1, tx: [] }, chamber);

if (!DRY) {
  await mapLimit(houseNow, 3, async (f) => {
    try {
      record(f, await readHouse(f), 'house');
    } catch (e) {
      fail(f, e, 'house');
    }
    await sleep(150);
  });
  for (const f of senateNow) {
    try {
      const tx = await senate.report(f.url);
      record(f, { status: tx.length ? 'ok' : 'empty', tx }, 'senate');
    } catch (e) {
      if (/session lapsed/.test(e.message)) {
        try {
          await senate.open();
        } catch {
          /* counted below as an error */
        }
      }
      fail(f, e, 'senate');
    }
    await sleep(400);
  }
}

for (const ch of ['house', 'senate']) {
  const s = stats[ch];
  if (s.fetched >= 10 && s.error / s.fetched > 0.3) problems.push(`${ch}: ${s.error} of ${s.fetched} filings could not be read`);
}
const errs = Object.entries(filings).filter(([, f]) => f.status === 'error').slice(0, 5);
for (const [k, f] of errs) console.log(`  error ${k}: ${f.err}`);

// Who is who
let legislators = [];
let seats = {};
let committeeNames = {};
try {
  const [cur, hist, committees, membership] = await Promise.all([
    getJson(`${LEGIS}/legislators-current.json`),
    getJson(`${LEGIS}/legislators-historical.json`),
    getJson(`${LEGIS}/committees-current.json`),
    getJson(`${LEGIS}/committee-membership-current.json`),
  ]);
  // former members whose last term ended inside the window still filed in it
  const cutoff = `${Number(SINCE.slice(0, 4)) - 1}${SINCE.slice(4)}`;
  const recent = hist.filter((l) => (l.terms || []).some((t) => (t.end || '') >= cutoff));
  legislators = indexLegislators([...cur, ...recent]);
  ({ seats, names: committeeNames } = committeeSeats(committees, membership));
} catch (e) {
  problems.push(`legislator records: ${e.message}`);
  // keep the previous file's members rather than serve trades with no names
}

if (DRY) {
  console.log(JSON.stringify(stats));
  console.log('dry run: nothing written');
  process.exit(problems.length ? 1 : 0);
}

writeJson(files.filings(), { updatedAt: new Date(now).toISOString(), since: SINCE, filings });

// The traded companies' SEC industry (SIC) codes, for the committee-field
// flag. Kept between runs; a ticker is looked up once and again after half
// a year. EDGAR being down costs only the new tickers' flags, never the run.
const sicCache = readJson(files.sic(), { byTicker: {} });
const SIC_MAX_AGE = 180 * 86400000;
try {
  const traded = new Set();
  for (const f of Object.values(filings)) for (const tx of f.tx || []) if (tx.t) traded.add(tx.t);
  const stale = [...traded].filter((t) => {
    const e = sicCache.byTicker[t];
    return !e || now - Date.parse(e.at || 0) > SIC_MAX_AGE;
  });
  if (stale.length && !DRY) {
    const index = await fetchSecTickers();
    const cikOf = (t) => index.get(t)?.cik || index.get(t.replace('.', '-'))?.cik || null;
    const ciks = [...new Set(stale.map(cikOf).filter(Boolean))];
    const bySic = await fetchSectors(ciks);
    const at = new Date(now).toISOString();
    let found = 0;
    for (const t of stale) {
      const hit = cikOf(t) ? bySic.get(cikOf(t)) : null;
      // a lookup that failed this run is retried next run, not stored as "no code"
      if (cikOf(t) && !hit) continue;
      sicCache.byTicker[t] = { sic: hit?.sic || null, d: hit?.sicDescription || null, at };
      if (hit?.sic) found++;
    }
    console.log(`SEC industry codes: ${stale.length} tickers looked up, ${found} with a code`);
    writeJson(files.sic(), { updatedAt: at, byTicker: sicCache.byTicker });
  }
} catch (e) {
  console.log(`::warning::SEC industry codes not refreshed (${e.message}); the committee-field flag uses the codes on file`);
}
const sicFor = (t) => sicCache.byTicker[t]?.sic || null;

if (legislators.length) {
  const served = buildServed(filings, { legislators, seats, committeeNames, seriesFor: readSeries, sicFor, since: SINCE, now });
  if (!served.rows.length) problems.push('no trades to serve');
  else writeJson(files.data(), served);
  console.log(`served: ${served.counts.rows} trades (House ${served.counts.house}, Senate ${served.counts.senate}), ${served.counts.members} members, ${served.counts.priced} priced, ${served.counts.inField} in a committee's field; newest disclosure ${served.lastFiled}`);
  if (served.unmatched.length) console.log(`unmatched filers (${served.unmatched.length}): ${served.unmatched.join('; ')}`);
}

const prev = readJson(files.freshness(), {});
const served = readJson(files.data(), { rows: [] });
const all = Object.values(filings);
writeJson(
  files.freshness(),
  {
    dataset: 'congress',
    last_run_at: new Date(now).toISOString(),
    last_success_at: problems.length ? prev.last_success_at || null : new Date().toISOString(),
    last_filing_date: served.lastFiled || null,
    row_count: served.rows?.length || 0,
    member_count: Object.keys(served.members || {}).length,
    filings: {
      total: all.length,
      ok: all.filter((f) => f.status === 'ok').length,
      scan: all.filter((f) => f.status === 'scan' || f.status === 'paper').length,
      empty: all.filter((f) => f.status === 'empty').length,
      error: all.filter((f) => f.status === 'error').length,
    },
    unmatched: served.unmatched?.length || 0,
    run: stats,
    last_error: problems.length ? problems.join(' | ') : null,
    last_error_at: problems.length ? new Date().toISOString() : prev.last_error_at || null,
  },
  { pretty: true },
);

console.log(JSON.stringify(stats));
if (problems.length) {
  for (const p of problems) console.log(`::error::${p}`);
  process.exit(1);
}
