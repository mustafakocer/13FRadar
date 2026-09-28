// Builds the insider-trading dataset from SEC EDGAR.
//
//   node scripts/build-insiders.mjs                       nightly run
//   node scripts/build-insiders.mjs --from 2026-09-19 --to 2026-09-27
//                                                         backfill a range
//   node scripts/build-insiders.mjs --from … --to … --dry-run
//                                                         count Form 4s per day, write nothing
//   node scripts/build-insiders.mjs --reingest-same-trade re-read the filings behind
//                                                         "same trade, two accessions" pairs
//                                                         so 4/A amendments get marked
//
// Two sources, because neither covers everything:
//   1. Quarterly "Insider Transactions Data Sets" (structured TSV inside a zip)
//      — the whole market, but published ~1 month after each quarter ends.
//      Only used to seed an empty dataset.
//   2. The daily index, for every day after the checkpoint. Which days are
//      read, skipped or waited for is decided by api/_lib/insiderCrawl.js —
//      read the header there before changing anything about the schedule.
//
// Storage goes through api/_lib/insiderStore.js (rows, raw Form 4 fields,
// ingest errors, the freshness record). Rows are upserted per filing, so a
// re-run or an overlapping backfill never duplicates anything.
//
// The run writes everything it collected and THEN exits non-zero if anything
// is wrong (a day that could not be read, a thin index, no progress, a day
// EDGAR has not published for over a business day). The workflow commits the
// data either way and pages us on the non-zero exit.
//
// Env: SEC_USER_AGENT (required by SEC), INSIDER_MONTHS (default 12),
//      INSIDER_MAX_DAYS (new days per run, default 45),
//      INSIDER_MIN_FORM4 (volume floor per business day, default 200),
//      INSIDER_RESCAN_DAYS (business days re-read every run, default 3),
//      INSIDER_ENRICH_MAX (tickers priced per run, default 5000),
//      SEC_RPS (request ceiling, default 7), SEC_RETRY_BACKOFF (seconds,
//      default 2,4,8,16), INSIDER_SIMULATE_FAILURE=1 (every EDGAR request
//      answers 403 — for testing the alarm end to end)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import axios from 'axios';
import { classifyTransaction, cleanSymbol, KEPT_CODES, plausibleDates } from '../api/_lib/insiderModel.js';
import { makeRow, normDate, num, truthy } from '../api/_lib/insiderForm4.js';
import { advanceCheckpoint, crawlDay, crawlOnce, DEFAULTS, fetchListing, planScan, quarterKey, runProblems, getWithRetry, indexUrl, parseFormIndex } from '../api/_lib/insiderCrawl.js';
import {
  assignLineIndexes,
  currentRows,
  duplicateIds,
  lastFilingDay,
  loadDataset,
  loadErrors,
  loadRaw,
  markSuperseded,
  mergeFilings,
  readJson,
  rowId,
  sameTradeGroups,
  saveDataset,
  saveErrors,
  saveFreshness,
  saveRaw,
  saveTeaser,
  files,
} from '../api/_lib/insiderStore.js';
import { parseForm4Submission, BadFilingError } from '../api/_lib/insiderForm4.js';
import { RateClock } from '../api/_lib/edgarClock.js';
import { buildTeaser } from '../api/_lib/insiderTeaser.js';
import { annotateOutcomes, checkPriceUnits } from '../api/_lib/insiderOutcome.js';
import { PLAN_NOTE_RE } from '../api/_lib/insiderClassify.js';
import { readSeries } from '../api/_lib/priceStore.js';
import { fetchCharts, fetchSectors, fetchSharesOutstanding, marketCap } from '../api/_lib/marketData.js';
import { isSecBusinessDay, addDays, calendarCoverage } from '../client/src/lib/secCalendar.js';

// ---------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const FROM = arg('from');
const TO = arg('to');
const DRY = Boolean(arg('dry-run'));
const REINGEST = Boolean(arg('reingest-same-trade'));
const NO_ENRICH = Boolean(arg('no-enrich'));
if ((FROM && !DAY_RE.test(FROM)) || (TO && !DAY_RE.test(TO)) || (TO && !FROM) || (FROM && TO && FROM > TO)) {
  console.error('Usage: --from YYYY-MM-DD [--to YYYY-MM-DD] [--dry-run]');
  process.exit(2);
}

// ---------------------------------------------------------------- config
const UA = process.env.SEC_USER_AGENT || 'Fundocap insider bot (kocergpt@gmail.com)';
const MONTHS = Number(process.env.INSIDER_MONTHS || 12);
const MAX_DAYS = Number(process.env.INSIDER_MAX_DAYS || DEFAULTS.maxDays);
const MIN_FORM4 = Number(process.env.INSIDER_MIN_FORM4 || DEFAULTS.minForm4PerDay);
const RESCAN = Number(process.env.INSIDER_RESCAN_DAYS ?? DEFAULTS.rescanBusinessDays);
const BACKOFF_MS = (process.env.SEC_RETRY_BACKOFF || '2,4,8,16').split(',').map((x) => Number(x) * 1000).filter((n) => n >= 0);
const SIMULATE = process.env.INSIDER_SIMULATE_FAILURE === '1';
const KEEP_SELLS_DAYS = 120; // sells are only needed for the activity stats

const http = axios.create({
  timeout: 60000,
  headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// SEC's fair-access limit is 10 requests/second per IP. Every EDGAR request
// takes a slot from one adaptive clock: a 403/429 halves the rate for a
// minute, a clean run walks it back up.
const clock = new RateClock({ rps: Math.max(1, Number(process.env.SEC_RPS) || 7) });
async function edgarGet(url) {
  const wait = clock.take();
  if (wait > 0) await sleep(wait);
  if (SIMULATE) return { status: 403, data: null };
  const r = await http.get(url, { responseType: 'text', transformResponse: [(x) => x], validateStatus: () => true });
  if (r.status === 403 || r.status === 429 || r.status === 503) clock.noteRateLimited();
  else clock.noteOk();
  return { status: r.status, data: r.data };
}
const retry = { backoffMs: BACKOFF_MS, sleep, log: (m) => console.warn(m) };

const dataDir = path.join(process.cwd(), 'api', '_data');
fs.mkdirSync(dataDir, { recursive: true });
const META = path.join(dataDir, 'ticker-meta.json');
const iso = (d) => d.toISOString().slice(0, 10);

const cutoff = iso(new Date(Date.now() - MONTHS * 31 * 86400000));
const sellCutoff = iso(new Date(Date.now() - KEEP_SELLS_DAYS * 86400000));
// Noise (grants, tax withholding, gifts…) is kept for 90 days only: it is
// hidden by default and exists so the feed can show it on request.
const noiseCutoff = iso(new Date(Date.now() - 90 * 86400000));
// Which parsed rows the dataset keeps at all.
const keepRow = (r) => {
  if (!r?.d || r.d < cutoff) return false;
  const cl = r.cl || classifyTransaction(r.k);
  if (cl === 'liquidity' && r.d < sellCutoff) return false;
  if (cl === 'noise' && r.d < noiseCutoff) return false;
  return true;
};

// ---------------------------------------------------------------- quarterly
function quarterOf(d) {
  return { y: d.getUTCFullYear(), q: Math.floor(d.getUTCMonth() / 3) + 1 };
}
function prevQuarter({ y, q }) {
  return q === 1 ? { y: y - 1, q: 4 } : { y, q: q - 1 };
}

const ZIP_HOSTS = [
  'https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets',
  'https://www.sec.gov/files/dera/data/insider-transactions-data-sets',
];

async function downloadQuarter({ y, q }, tmp) {
  const name = `${y}q${q}_form345.zip`;
  for (const host of ZIP_HOSTS) {
    try {
      const { data, status } = await http.get(`${host}/${name}`, {
        responseType: 'arraybuffer',
        validateStatus: () => true,
      });
      if (status !== 200 || !data || data.byteLength < 10000) {
        console.log(`  ${name}: HTTP ${status} from ${host}`);
        continue;
      }
      const file = path.join(tmp, name);
      fs.writeFileSync(file, Buffer.from(data));
      console.log(`  downloaded ${name} (${(data.byteLength / 1e6).toFixed(1)} MB) from ${host}`);
      return file;
    } catch {
      /* try next host */
    }
  }
  return null;
}

// TSV -> array of objects (the SEC files are tab separated with a header row)
function parseTsv(text) {
  const lines = text.split(/\r?\n/);
  const head = lines[0].split('\t');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = lines[i].split('\t');
    const o = {};
    for (let j = 0; j < head.length; j++) o[head[j]] = cells[j];
    rows.push(o);
  }
  return rows;
}

const unzip = (zip, member) => {
  try {
    return execFileSync('unzip', ['-p', zip, member], { maxBuffer: 1024 * 1024 * 512 }).toString('utf8');
  } catch {
    return null;
  }
};

async function fromQuarterlyDatasets() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'form345-'));
  const rows = [];
  let newest = null;
  const quarters = [];
  let q = quarterOf(new Date());
  for (let i = 0; i < Math.ceil(MONTHS / 3) + 1; i++) {
    quarters.push(q);
    q = prevQuarter(q);
  }

  for (const qt of quarters) {
    const zip = await downloadQuarter(qt, tmp);
    if (!zip) {
      console.log(`  ${qt.y}Q${qt.q}: dataset not published yet`);
      continue;
    }
    const sub = parseTsv(unzip(zip, 'SUBMISSION.tsv') || '');
    const own = parseTsv(unzip(zip, 'REPORTINGOWNER.tsv') || '');
    const trans = parseTsv(unzip(zip, 'NONDERIV_TRANS.tsv') || '');
    if (!sub.length || !trans.length) {
      console.warn(`  ${qt.y}Q${qt.q}: unexpected archive layout, skipping`);
      continue;
    }

    const subByAcc = new Map();
    for (const s of sub) {
      if (!String(s.DOCUMENT_TYPE || '').startsWith('4')) continue;
      const filed = normDate(s.FILING_DATE);
      if (!filed || filed < cutoff) continue;
      subByAcc.set(s.ACCESSION_NUMBER, {
        filed,
        aff10b5: s.AFF10B5ONE ?? null,
        issuer: s.ISSUERNAME || '',
        cik: String(s.ISSUERCIK || '').padStart(10, '0'),
        ticker: cleanSymbol(s.ISSUERTRADINGSYMBOL),
        formType: String(s.DOCUMENT_TYPE).trim().toUpperCase() === '4/A' ? '4/A' : '4',
      });
      if (!newest || filed > newest) newest = filed;
    }

    const ownByAcc = new Map();
    for (const o of own) {
      if (!subByAcc.has(o.ACCESSION_NUMBER)) continue;
      if (ownByAcc.has(o.ACCESSION_NUMBER)) continue; // first reporting owner
      ownByAcc.set(o.ACCESSION_NUMBER, {
        cik: o.RPTOWNERCIK ? String(o.RPTOWNERCIK).replace(/\D/g, '').padStart(10, '0') : null,
        name: (o.RPTOWNERNAME || '').trim(),
        title: (o.RPTOWNER_TITLE || o.OFFICER_TITLE || '').trim(),
        isDirector: truthy(o.RPTOWNER_RELATIONSHIP?.includes?.('Director') ? 1 : o.ISDIRECTOR),
        isOfficer: truthy(o.RPTOWNER_RELATIONSHIP?.includes?.('Officer') ? 1 : o.ISOFFICER),
        isTenPercentOwner: truthy(
          o.RPTOWNER_RELATIONSHIP?.includes?.('TenPercentOwner') ? 1 : o.ISTENPERCENTOWNER
        ),
      });
    }

    // filings that also contain a sale: an option exercise there is a cash-out
    const saleAccs = new Set(trans.filter((tr) => String(tr.TRANS_CODE || '').trim().toUpperCase() === 'S').map((tr) => tr.ACCESSION_NUMBER));
    let kept = 0;
    // line index: the transaction's position among its filing's
    // non-derivative rows, the second half of the row's unique key
    const lineOf = new Map();
    for (const tr of trans) {
      const s = subByAcc.get(tr.ACCESSION_NUMBER);
      if (!s) continue;
      const li = lineOf.get(tr.ACCESSION_NUMBER) ?? 0;
      lineOf.set(tr.ACCESSION_NUMBER, li + 1);
      const code = String(tr.TRANS_CODE || '').trim().toUpperCase();
      if (!KEPT_CODES.has(code)) continue;
      const cl = classifyTransaction(code, { sameFilingSale: saleAccs.has(tr.ACCESSION_NUMBER) });
      const d = normDate(tr.TRANS_DATE);
      if (!d || d < cutoff) continue;
      if (cl === 'liquidity' && d < sellCutoff) continue;
      if (cl === 'noise' && d < noiseCutoff) continue;
      const shares = num(tr.TRANS_SHARES);
      const price = num(tr.TRANS_PRICEPERSHARE);
      if (!shares || shares <= 0) continue;
      const o = ownByAcc.get(tr.ACCESSION_NUMBER) || { name: '—' };
      const owned = num(tr.SHRS_OWND_FOLWNG_TRANS);
      const p5 = truthy(tr.TRANS_10B5_1 ?? tr.AFF10B5ONE ?? s.aff10b5);
      rows.push(
        makeRow({ s, o, code, cl, p5, d, shares, price, owned, acc: tr.ACCESSION_NUMBER, li, formType: s.formType, ownerCik: o.cik })
      );
      kept++;
    }
    console.log(`  ${qt.y}Q${qt.q}: ${kept} transactions kept`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  return { rows, newest };
}

// --------------------------------------------------------------- enrichment
// Daily closes from the charts the enrichment already downloads (about 400
// days per ticker) — kept for the forward returns after insider buys.
const chartCloses = new Map();
// Price, 52-week range and volume from one Yahoo chart per ticker; sector
// from the SIC code on the issuer's SEC submissions feed (cached for good —
// only tickers never seen are looked up); market cap from SEC's share count
// times that price. No key, no plan, no batch endpoint to lose. FMP used to
// do all three and its free plan stopped answering more than one symbol a
// call, which left every one of these columns empty behind a green run.
async function enrich(tickers, cikOf) {
  const meta = readJson(META, {});
  const before = Object.keys(meta).length;

  console.log(`Enriching: ${tickers.length} tickers…`);
  const { snapshots, failed, blocked } = await fetchCharts(tickers, {
    onProgress: (d, n) => console.log(`  ${d}/${n} charts`),
  });
  let priced = 0;
  for (const [sym, snap] of snapshots) {
    if (!snap) continue;
    if (snap.closes?.length) chartCloses.set(sym, snap.closes);
    // vol/lo/hi drive the liquidity and off-the-low columns on the penny
    // board; every consumer treats them as optional, so a provider that
    // stops returning them degrades to "—" instead of breaking the page.
    meta[sym] = { ...(meta[sym] || {}), px: snap.price, vol: snap.vol, lo: snap.lo, hi: snap.hi, asOf: snap.asOf };
    if (snap.etf) meta[sym].etf = 1;
    priced++;
  }
  console.log(`  charts: ${priced} priced, ${failed} failed${blocked ? ' — provider blocked, stopped early' : ''}`);

  // sector: only what has never been asked; null (a fund, no SIC) is an answer
  const unknown = tickers.filter((t) => meta[t]?.sector === undefined && cikOf.get(t));
  if (unknown.length) {
    const ciks = [...new Set(unknown.map((t) => cikOf.get(t)))];
    console.log(`  sectors: ${unknown.length} new tickers (${ciks.length} filers) via SEC…`);
    const sectors = await fetchSectors(ciks);
    let got = 0;
    for (const t of unknown) {
      const r = sectors.get(cikOf.get(t));
      if (!r) continue; // fetch failed: ask again next run
      meta[t] = { ...(meta[t] || {}), sector: r.sector, name: meta[t]?.name || r.name || null };
      if (r.sector) got++;
    }
    console.log(`  sectors: ${got} classified`);
  }

  // market cap: share count × price, re-priced every run
  let capped = 0;
  try {
    const shares = await fetchSharesOutstanding();
    for (const t of tickers) {
      const sh = cikOf.get(t) ? shares.get(cikOf.get(t)) : null;
      const v = marketCap(sh?.shares, meta[t]?.px);
      if (v) {
        meta[t].mcap = v;
        capped++;
      }
    }
  } catch (e) {
    console.warn(`  SEC shares outstanding: ${e.message}`);
  }

  const after = Object.keys(meta).length;
  const withSector = Object.values(meta).filter((m) => m.sector).length;
  console.log(`Enriched: ${after} tickers in ticker-meta.json (was ${before}); ${withSector} with a sector, ${capped} with a market cap`);
  if (!priced) console.error('::warning::no ticker was priced this run — see the chart lines above');
  return meta;
}

// --------------------------------------------------------------------- main
const startedAt = new Date().toISOString();
const today = iso(new Date());
const db = loadDataset();
const prevHealth = readJson(files.freshness(), {});
console.log(
  `Existing dataset: ${db.rows.length} rows, newest filing ${lastFilingDay(currentRows(db.rows)) || '—'}, checkpoint ${db.checkpoint || '—'}`
);
if (SIMULATE) console.warn('::warning::INSIDER_SIMULATE_FAILURE=1 — every EDGAR request answers 403 this run');

let rows = db.rows;
let checkpoint = db.checkpoint;
const freshRows = [];
const freshAcc = new Set();
const rawAdd = {};
const newErrors = [];
const problems = [];
const results = [];

if (!rows.length && !FROM && !REINGEST && !DRY) {
  console.log('First run — pulling the quarterly SEC datasets…');
  const q = await fromQuarterlyDatasets();
  freshRows.push(...q.rows);
  checkpoint = q.newest || addDays(today, -30);
  console.log(`Quarterly datasets: ${q.rows.length} rows through ${checkpoint}`);
}
if (!checkpoint) checkpoint = addDays(today, -7);

let plan = { scan: [], timeline: [] };
let crawled = null; // { results, newCheckpoint, problems } once days were read
let timelineForProblems = [];

if (REINGEST) {
  // Re-read the filings behind every "same trade, two accessions" group, so
  // an amendment stored before form types were kept gets recognised as one.
  const groups = sameTradeGroups(currentRows(rows));
  const accs = [...new Set(groups.flatMap((g) => g.accessions))];
  const rowOf = new Map();
  for (const r of rows) if (!rowOf.has(r.a)) rowOf.set(r.a, r);
  console.log(`Re-ingest: ${groups.length} same-trade groups over ${accs.length} filings${DRY ? ' (dry run — nothing fetched)' : ''}`);
  if (!DRY) {
    let done = 0;
    for (const acc of accs) {
      const r0 = rowOf.get(acc);
      const url = `https://www.sec.gov/Archives/edgar/data/${Number(r0.ci)}/${acc}.txt`;
      const r = await getWithRetry(edgarGet, url, retry);
      if (r.status !== 200 || typeof r.data !== 'string') {
        problems.push(`re-ingest ${acc}: HTTP ${r.status || r.error}`);
        continue;
      }
      try {
        const parsed = await parseForm4Submission(r.data, { filed: r0.f, path: url });
        freshAcc.add(parsed.accession);
        for (const row of parsed.rows) if (keepRow(row)) freshRows.push(row);
        Object.assign(rawAdd, parsed.raw);
      } catch (e) {
        if (!(e instanceof BadFilingError)) throw e;
        newErrors.push({ accession: acc, path: url, day: r0.f, error: e.message, at: new Date().toISOString() });
      }
      if (++done % 200 === 0) console.log(`  ${done}/${accs.length}`);
    }
  }
} else {
  // Which days EDGAR published, per quarter, from the earliest day this run
  // could touch through today. A listing that cannot be read is null: those
  // days are probed directly instead.
  const start = [FROM, addDays(checkpoint, -30)].filter(Boolean).sort()[0];
  const listings = new Map();
  for (let d = start; d <= today; d = addDays(d, 28)) {
    const key = quarterKey(d);
    if (!listings.has(key)) listings.set(key, await fetchListing(edgarGet, d, retry));
  }
  if (!listings.has(quarterKey(today))) listings.set(quarterKey(today), await fetchListing(edgarGet, today, retry));
  for (const [k, v] of listings) if (!v) console.warn(`  ${k}: EDGAR listing unavailable — those days are probed directly`);
  const published = (day) => listings.get(quarterKey(day)) ?? null;

  if (FROM) {
    const to = TO || today;
    plan = planScan({ checkpoint, today, published, rescanBusinessDays: 0, maxDays: 100000 });
    const scan = [];
    for (let d = FROM; d <= to; d = addDays(d, 1)) {
      if (!isSecBusinessDay(d)) continue;
      const set = published(d);
      if (set && !set.has(d)) {
        console.log(`  ${d}: not in EDGAR's listing — not read`);
        continue;
      }
      scan.push({ day: d, rescan: d <= checkpoint, probe: !set });
    }
    plan.scan = scan;
    timelineForProblems = plan.timeline.filter((t) => t.day >= FROM && t.day <= to);
    console.log(`Backfill ${FROM} → ${to}: ${scan.length} business day(s) to read`);
  } else {
    plan = planScan({ checkpoint, today, published, rescanBusinessDays: RESCAN, maxDays: MAX_DAYS });
    timelineForProblems = plan.timeline;
    const by = (s) => plan.timeline.filter((t) => t.state === s).map((t) => t.day + (t.reason ? ` (${t.reason})` : ''));
    console.log(`Checkpoint ${checkpoint}, today ${today}`);
    if (plan.rescan.length) console.log(`  re-reading ${plan.rescan.length} recent day(s): ${plan.rescan.join(', ')}`);
    if (by('scan').length) console.log(`  new day(s) to read: ${by('scan').join(', ')}`);
    if (by('settled').length) console.log(`  settled without reading: ${by('settled').join(', ')}`);
    if (by('pending').length) console.log(`  waiting for EDGAR to publish: ${by('pending').join(', ')}`);
    if (by('deferred').length) console.log(`  over this run's cap, next run: ${by('deferred').length} day(s)`);
  }

  if (DRY) {
    console.log('\nDry run — daily indexes only, no filing is fetched and nothing is written:');
    let total = 0;
    for (const { day, rescan } of plan.scan) {
      const r = await getWithRetry(edgarGet, indexUrl(day), retry);
      const list = r.status === 200 ? parseFormIndex(r.data) : [];
      const amended = list.filter((f) => f.form === '4/A').length;
      total += list.length;
      const flag = r.status !== 200 ? `  ✗ HTTP ${r.status || r.error}` : list.length < MIN_FORM4 ? `  ✗ under the ${MIN_FORM4} floor` : '';
      console.log(`  ${day}${rescan ? ' (re-read)' : ''}  Form 4: ${String(list.length).padStart(5)}  (of which 4/A: ${amended})${flag}`);
      if (flag) problems.push(`${day}:${flag.replace('  ✗', '')}`);
    }
    console.log(`  total: ${total} Form 4 filings over ${plan.scan.length} day(s)`);
  } else {
    const log = (m) => console.warn(m);
    let runs;
    if (FROM) {
      // backfill: the chosen days, then the same checkpoint rule as every run
      runs = [];
      for (const { day, rescan } of plan.scan) {
        const r = await crawlDay(day, { get: edgarGet, minForm4PerDay: MIN_FORM4, keep: keepRow, ...retry });
        runs.push({ ...r, rescan });
      }
      const okDays = new Set(runs.filter((r) => r.ok).map((r) => r.day));
      crawled = { results: runs, newCheckpoint: advanceCheckpoint(checkpoint, plan.timeline, okDays) };
      crawled.problems = runProblems({ checkpoint, newCheckpoint: crawled.newCheckpoint, today, timeline: timelineForProblems, results: runs });
    } else {
      // the nightly path is exactly the function the regression tests drive
      crawled = await crawlOnce({
        checkpoint,
        today,
        published,
        get: edgarGet,
        rescanBusinessDays: RESCAN,
        maxDays: MAX_DAYS,
        minForm4PerDay: MIN_FORM4,
        keep: keepRow,
        ...retry,
        log,
      });
      runs = crawled.results;
    }
    for (const r of runs) {
      const { day, rescan } = r;
      results.push(r);
      freshRows.push(...r.rows);
      for (const a of r.accessions) freshAcc.add(a);
      Object.assign(rawAdd, r.raw);
      newErrors.push(...r.errors);
      console.log(
        `  ${day}${rescan ? ' (re-read)' : ''}: ${r.form4} Form 4 → ${r.rows.length} transactions` +
          `${r.errors.length ? `, ${r.errors.length} unreadable (logged)` : ''}${r.ok ? '' : ` — FAILED: ${r.error}`}`
      );
    }
  }
}

if (DRY) {
  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`);
    process.exit(1);
  }
  process.exit(0);
}

// ---------------------------------------------------------------- merge
rows = mergeFilings(rows, freshRows, freshAcc);
let implausible = 0;
const all = [];
for (const r of rows) {
  if (!keepRow(r)) continue;
  // a trade dated after the filing that reports it is the filer's typo, and
  // would sit at the top of every date-sorted view as an upcoming trade
  if (!plausibleDates(r.d, r.f)) {
    implausible++;
    continue;
  }
  if (r.t) r.t = cleanSymbol(r.t);
  if (!r.cl) r.cl = classifyTransaction(r.k);
  all.push(r);
}
assignLineIndexes(all);
const superseded = markSuperseded(all);
// Ascending by filing date: new rows append at the end and only a small slice
// falls off the front each day, which keeps the daily git delta small.
all.sort((a, b) => (a.f === b.f ? (a.a === b.a ? a.li - b.li : a.a < b.a ? -1 : 1) : a.f < b.f ? -1 : 1));

const companies = { ...(db.companies || {}) };
for (const r of [...rows, ...freshRows]) if (r.t && r.c) companies[r.t] = r.c;
for (const r of all) delete r.c;
const live = new Set(all.filter((r) => r.t).map((r) => r.t));
for (const k of Object.keys(companies)) if (!live.has(k)) delete companies[k];
if (implausible) console.log(`Dropped ${implausible} row(s) dated after their own filing.`);

const dups = duplicateIds(all);
if (dups.length) problems.push(`${dups.length} duplicate row id(s), e.g. ${dups.slice(0, 3).join(', ')}`);

const newCheckpoint = crawled ? crawled.newCheckpoint : checkpoint;
if (crawled) problems.push(...crawled.problems);
// the holiday list is nearing its end: a warning, not a red run (yet)
const calendar = calendarCoverage(today);
if (calendar.warning) console.warn(`::warning::${calendar.warning}`);

// ---------------------------------------------------------------- enrich + write
const current = currentRows(all);
let meta = readJson(META, {});
if (!NO_ENRICH) {
  const tickers = [...live];
  const cikOf = new Map();
  for (const r of all) if (r.t && r.ci && !cikOf.has(r.t)) cikOf.set(r.t, r.ci);
  meta = await enrich(tickers.slice(0, Number(process.env.INSIDER_ENRICH_MAX || 5000)), cikOf);
  fs.writeFileSync(META, JSON.stringify(meta));
}

// A footnote that says "10b5-1" or "trading plan" marks a planned trade even
// when the filing's checkbox is empty (`pn`; the classifier reads p5 || pn).
const rawAll = { ...loadRaw().rows, ...rawAdd };
let planNotes = 0;
for (const r of all) {
  const fn = rawAll[rowId(r)]?.fn;
  if (fn && Object.values(fn).some((t) => PLAN_NOTE_RE.test(t))) {
    if (!r.pn) planNotes++;
    r.pn = 1;
  }
}
if (planNotes) console.log(`Marked ${planNotes} line(s) as planned trades from their footnotes.`);

// 30/90-day return vs SPY after every open-market buy whose horizon has
// passed: from tonight's chart closes, else the nightly price cache.
const spy = readSeries('SPY')?.prices || chartCloses.get('SPY') || [];
const seriesFor = (t) => chartCloses.get(t) || readSeries(t)?.prices || null;
// a form price far from that day's close is flagged (`pu`) until the
// currency/ADR work (roadmap item 4) can convert it
const mismatched = checkPriceUnits(all, seriesFor);
if (mismatched.length) {
  const byTicker = {};
  for (const m of mismatched) byTicker[m.t] = (byTicker[m.t] || 0) + 1;
  const top = Object.entries(byTicker).sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log(`Price unit check: ${mismatched.length} line(s) over ${Object.keys(byTicker).length} ticker(s) more than 25% from the day's close — ${top.map(([t, n]) => `${t} ${n}`).join(', ')}`);
}
const outcomes = annotateOutcomes(all, seriesFor, spy);
console.log(`Forward returns vs SPY: ${outcomes} value(s) computed${spy.length ? '' : ' — no SPY series, none computed'}.`);

const newest = lastFilingDay(current);
saveDataset({
  updatedAt: new Date().toISOString(),
  // `checkpoint`: every day up to here was read or is a day EDGAR did not publish.
  // `lastDay` / `lastFilingDay`: the newest filing date actually in the rows —
  // the only date any page or alarm may call "data through".
  checkpoint: newCheckpoint,
  lastDay: newest,
  lastFilingDay: newest,
  count: all.length,
  companies,
  rows: all,
});
saveRaw({ rows: { ...loadRaw().rows, ...rawAdd } }, new Set(all.map(rowId)));
saveErrors([...(loadErrors().errors || []), ...newErrors]);
saveTeaser(buildTeaser(current, companies, meta));

const now = new Date().toISOString();
saveFreshness({
  last_run_at: startedAt,
  last_success_at: problems.length ? prevHealth.last_success_at || null : now,
  last_filing_date: newest,
  checkpoint: newCheckpoint,
  row_count: current.length,
  superseded_rows: all.length - current.length,
  ingest_errors_last_run: newErrors.length,
  last_error: problems.length ? problems.join(' | ').slice(0, 2000) : null,
  last_error_at: problems.length ? now : prevHealth.last_error_at || null,
  days: results.map((r) => ({ day: r.day, form4: r.form4, rows: r.rows.length, unreadable: r.errors.length, ok: r.ok, ...(r.rescan ? { rescan: true } : {}), ...(r.error ? { error: r.error } : {}) })),
});

console.log(
  `insiders.json: ${all.length} rows (${current.length} current, ${superseded} superseded by 4/A), ` +
    `${current.filter((r) => r.k === 'P').length} buys, ${live.size} tickers, newest filing ${newest}, checkpoint ${checkpoint} → ${newCheckpoint}` +
    (newErrors.length ? `, ${newErrors.length} unreadable filing(s) logged` : '')
);
if (REINGEST) {
  const before = sameTradeGroups(currentRows(db.rows)).length;
  const after = sameTradeGroups(current).length;
  console.log(`Same-trade groups: ${before} before, ${after} after — ${before - after} resolved by the 4/A rule`);
}

// Written first, failed second: the data this run did collect still ships,
// and the non-zero exit is what turns the workflow red and sends the alert.
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`::error::${p}`);
  process.exit(1);
}
