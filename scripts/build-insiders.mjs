// Builds the insider-trading dataset from SEC EDGAR.
//
//   node scripts/build-insiders.mjs
//
// Two sources, because neither covers everything:
//   1. Quarterly "Insider Transactions Data Sets" (structured TSV inside a zip)
//      — the whole market, but published ~1 month after each quarter ends.
//   2. The daily index, for every day after the newest quarterly dataset.
//      One request per filing, so only the recent tail is scanned.
//
// The run is incremental: api/_data/insiders.json is read first and only days
// newer than the ones already stored are fetched.
//
// Outputs
//   api/_data/insiders.json        full dataset (Pro, served by /api/insider-feed)
//   client/public/insiders-teaser.json  20 newest buys (public preview)
//   api/_data/ticker-meta.json     sector / market cap / last price per ticker
//                                  (Yahoo chart + SEC; no key needed)
//
// Env: SEC_USER_AGENT (required by SEC), INSIDER_MONTHS (default 12),
//      INSIDER_MAX_DAYS (daily-index safety cap), INSIDER_ENRICH_MAX (tickers
//      priced per run, default 5000)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import axios from 'axios';
import { parseStringPromise, processors } from 'xml2js';
import {
  classifyRole,
  businessDaysBetween,
  classifyTransaction,
  cleanSymbol,
  crawlLedger,
  KEPT_CODES,
  plausibleDates,
  selectScanDays,
} from '../api/_lib/insiderModel.js';
import { buildTeaser } from '../api/_lib/insiderTeaser.js';
import { fetchCharts, fetchSectors, fetchSharesOutstanding, marketCap } from '../api/_lib/marketData.js';

const UA = process.env.SEC_USER_AGENT || 'Fundocap insider bot (kocergpt@gmail.com)';
const MONTHS = Number(process.env.INSIDER_MONTHS || 12);
const MAX_DAYS = Number(process.env.INSIDER_MAX_DAYS || 25); // days scanned per run
const MAX_DAY_ATTEMPTS = 3; // failures before a single day is left behind
const BAN_STREAK = 3; // consecutive failures that mean EDGAR is refusing us
const KEEP_SELLS_DAYS = 120; // sells are only needed for the activity stats

const http = axios.create({
  timeout: 60000,
  headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Global pacer: SEC's fair-access limit is 10 requests/second per IP and it
// answers 403 for a while once you cross it. Every EDGAR call goes through
// here, so concurrency can never push the rate past the limit.
const MIN_GAP_MS = 130; // ≈7.5 req/s
let nextSlot = 0;
async function paced(fn) {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_GAP_MS;
  if (at > now) await sleep(at - now);
  return fn();
}

const dataDir = path.join(process.cwd(), 'api', '_data');
const pubDir = path.join(process.cwd(), 'client', 'public');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(pubDir, { recursive: true });

const OUT = path.join(dataDir, 'insiders.json');
const META = path.join(dataDir, 'ticker-meta.json');
const iso = (d) => d.toISOString().slice(0, 10);
const readJson = (p, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};

const cutoff = iso(new Date(Date.now() - MONTHS * 31 * 86400000));
const sellCutoff = iso(new Date(Date.now() - KEEP_SELLS_DAYS * 86400000));
// Noise (grants, tax withholding, gifts…) is kept for 90 days only: it is
// hidden by default and exists so the feed can show it on request.
const noiseCutoff = iso(new Date(Date.now() - 90 * 86400000));

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

// SEC dates in the datasets are DD-MON-YYYY (e.g. 04-SEP-2026) or ISO.
const MON = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
function normDate(s) {
  if (!s) return null;
  const v = String(s).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})-([A-Z]{3})-(\d{4})/i.exec(v);
  if (m) return `${m[3]}-${MON[m[2].toUpperCase()] || '01'}-${m[1]}`;
  return null;
}
const num = (x) => {
  const n = Number(String(x ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const truthy = (x) => ['1', 'true', 'Y', 'y'].includes(String(x ?? '').trim());

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
      });
      if (!newest || filed > newest) newest = filed;
    }

    const ownByAcc = new Map();
    for (const o of own) {
      if (!subByAcc.has(o.ACCESSION_NUMBER)) continue;
      if (ownByAcc.has(o.ACCESSION_NUMBER)) continue; // first reporting owner
      ownByAcc.set(o.ACCESSION_NUMBER, {
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
    for (const tr of trans) {
      const s = subByAcc.get(tr.ACCESSION_NUMBER);
      if (!s) continue;
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
      rows.push(makeRow({ s, o, code, cl, p5, d, shares, price, owned, acc: tr.ACCESSION_NUMBER }));
      kept++;
    }
    console.log(`  ${qt.y}Q${qt.q}: ${kept} transactions kept`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  return { rows, newest };
}

function makeRow({ s, o, code, cl, p5, d, shares, price, owned, acc }) {
  const value = price != null ? shares * price : null;
  const acquired = ['P', 'M', 'X', 'C', 'A', 'G', 'W', 'J', 'I', 'L'].includes(code) && code !== 'G';
  const prev = owned != null ? owned - (acquired ? shares : -shares) : null;
  const oc = prev && prev > 0 ? ((owned - prev) / prev) * 100 : null;
  return {
    t: s.ticker,
    c: s.issuer, // stripped again once the ticker -> name map is built
    ci: s.cik,
    n: o.name,
    r: classifyRole(o),
    ti: o.title || null,
    d,
    f: s.filed,
    k: code,
    cl: cl || classifyTransaction(code),
    ...(p5 ? { p5: 1 } : {}),
    s: Math.round(shares),
    p: price != null ? Number(price.toFixed(4)) : null,
    v: value != null ? Math.round(value) : null,
    o: owned != null ? Math.round(owned) : null,
    oc: oc != null ? Number(oc.toFixed(1)) : null,
    a: acc,
  };
}

// ------------------------------------------------------------- daily index
const quarterNum = (day) => Math.floor(Number(day.slice(5, 7) - 1) / 3) + 1;

// Which daily-index files EDGAR actually published for a quarter.
//
// EDGAR answers 403 — not 404 — for a daily-index file that does not exist,
// and every federal holiday is such a day. That is indistinguishable from the
// 403 it returns when it is refusing an automated client, so asking for a
// holiday looks exactly like being banned and stalls the crawl on that date
// forever (this is what froze the dataset on Memorial Day 2026-05-25). One
// listing per quarter tells us which days exist, so we never ask for one that
// does not.
const quarterListings = new Map();
async function publishedDays(day) {
  const y = day.slice(0, 4);
  const q = quarterNum(day);
  const key = `${y}Q${q}`;
  if (quarterListings.has(key)) return quarterListings.get(key);
  const url = `https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${q}/index.json`;
  let days = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    // A listing that cannot be read is not fatal: the crawl falls back to
    // probing each day, exactly as it did before listings existed.
    let data = null;
    let status = 0;
    try {
      ({ data, status } = await paced(() => http.get(url, { validateStatus: () => true })));
    } catch (e) {
      console.warn(`  ${key}: index listing failed (${e.message})`);
      break;
    }
    if (status === 200 && Array.isArray(data?.directory?.item)) {
      days = new Set(
        data.directory.item
          .map((it) => /^form\.(\d{4})(\d{2})(\d{2})\.idx$/.exec(it?.name || ''))
          .filter(Boolean)
          .map((m) => `${m[1]}-${m[2]}-${m[3]}`)
      );
      break;
    }
    if (status !== 403 && status !== 429) break;
    await sleep(5000 * (attempt + 1));
  }
  if (!days) console.warn(`  ${key}: index listing unavailable — falling back to probing each day`);
  quarterListings.set(key, days);
  return days;
}

async function dailyIndex(day) {
  const y = day.slice(0, 4);
  const q = quarterNum(day);
  const url = `https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${q}/form.${day.replace(/-/g, '')}.idx`;
  let status = 0;
  let data = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    ({ data, status } = await paced(() =>
      http.get(url, { responseType: 'text', transformResponse: [(x) => x], validateStatus: () => true })
    ));
    if (status === 200) break;
    if (status !== 403 && status !== 429) break; // 404 = no filings that day
    await sleep(5000 * (attempt + 1));
  }
  if (status !== 200 || typeof data !== 'string') {
    if (status !== 404) console.warn(`  ${day}: index HTTP ${status}`);
    return { files: [], status };
  }
  const out = [];
  for (const line of data.split('\n')) {
    if (!/^4(\/A)?\s/.test(line)) continue;
    const file = line.trim().split(/\s+/).pop();
    if (file && file.endsWith('.txt')) out.push(file);
  }
  return { files: out, status };
}

const OWNERSHIP_RE = /<ownershipDocument>[\s\S]*?<\/ownershipDocument>/i;

async function parseForm4(pathname, filedFallback) {
  const { data, status } = await paced(() =>
    http.get(`https://www.sec.gov/Archives/${pathname}`, {
      responseType: 'text',
      transformResponse: [(x) => x],
      validateStatus: () => true,
    })
  );
  if (status !== 200 || typeof data !== 'string') return [];
  const m = OWNERSHIP_RE.exec(data);
  if (!m) return [];
  let doc;
  try {
    doc = await parseStringPromise(m[0], {
      explicitArray: false,
      ignoreAttrs: true,
      tagNameProcessors: [processors.stripPrefix],
    });
  } catch {
    return [];
  }
  const od = doc?.ownershipDocument;
  if (!od) return [];
  const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
  const val = (x) => (x && typeof x === 'object' ? x.value : x) ?? null;

  const issuer = od.issuer || {};
  const s = {
    ticker: cleanSymbol(issuer.issuerTradingSymbol),
    issuer: issuer.issuerName || '',
    cik: String(issuer.issuerCik || '').padStart(10, '0'),
    filed: filedFallback,
  };
  const ro = arr(od.reportingOwner)[0] || {};
  const rel = ro.reportingOwnerRelationship || {};
  const o = {
    name: (ro.reportingOwnerId?.rptOwnerName || '—').trim(),
    title: (rel.officerTitle || '').trim(),
    isDirector: truthy(val(rel.isDirector)),
    isOfficer: truthy(val(rel.isOfficer)),
    isTenPercentOwner: truthy(val(rel.isTenPercentOwner)),
  };
  const acc = /(\d{10}-\d{2}-\d{6})/.exec(pathname)?.[1] || pathname;

  const rows = [];
  const txs = arr(od.nonDerivativeTable?.nonDerivativeTransaction);
  const codeOf = (tx) => String(val(tx.transactionCoding?.transactionCode) || tx.transactionCoding?.transactionCode || '').trim().toUpperCase();
  const sameFilingSale = txs.some((tx) => codeOf(tx) === 'S');
  // Rule 10b5-1 checkbox (Form 4 amendments, 2023)
  const p5 = truthy(val(od.aff10b5One));
  for (const tx of txs) {
    const code = codeOf(tx);
    if (!KEPT_CODES.has(code)) continue;
    const cl = classifyTransaction(code, { sameFilingSale });
    const d = normDate(val(tx.transactionDate));
    const shares = num(val(tx.transactionAmounts?.transactionShares));
    const price = num(val(tx.transactionAmounts?.transactionPricePerShare));
    const owned = num(val(tx.postTransactionAmounts?.sharesOwnedFollowingTransaction));
    if (!d || !shares || shares <= 0) continue;
    rows.push(makeRow({ s, o, code, cl, p5, d, shares, price, owned, acc }));
  }
  return rows;
}

async function fromDailyIndex(fromDay, prevBadDays = {}) {
  const rows = [];
  const today = iso(new Date());
  // day -> how many runs have failed on it; a day that has used up its
  // attempts is left behind so it cannot hold back every day after it
  const attempts = { ...prevBadDays };

  // Ask EDGAR which days it published before planning the scan, so a holiday
  // is never requested. Listings are fetched once per quarter in the range.
  // every quarter the backlog touches, not just its ends
  const listings = new Map();
  for (let d = new Date(`${fromDay}T00:00:00Z`); iso(d) <= today; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const day = iso(d);
    const key = `${day.slice(0, 4)}Q${quarterNum(day)}`;
    if (!listings.has(key)) listings.set(key, await publishedDays(day));
  }
  const published = (day) => listings.get(`${day.slice(0, 4)}Q${quarterNum(day)}`) ?? null;

  // Oldest first, capped per run: a full day is ~1900 filings ≈ 4 minutes at
  // SEC's rate limit, so the backlog is worked off over consecutive nights.
  const { days, skipped, abandoned, checkpoint, remaining } = selectScanDays({
    fromDay,
    today,
    published,
    exhausted: (day) => (attempts[day] || 0) >= MAX_DAY_ATTEMPTS,
    maxDays: MAX_DAYS,
  });
  if (skipped.length) console.log(`  EDGAR published no index for ${skipped.length} day(s): ${skipped.join(', ')}`);
  if (abandoned.length)
    console.log(`  giving up on ${abandoned.length} day(s) EDGAR kept refusing: ${abandoned.join(', ')}`);

  // Everything before the first day we are about to scan is settled: either
  // already stored, never published, or given up on.
  const ledger = crawlLedger({
    badDays: attempts,
    maxAttempts: MAX_DAY_ATTEMPTS,
    banStreak: BAN_STREAK,
    checkpoint,
  });
  // days older than the crawl's own lookback will never be scanned again
  const floor = iso(new Date(Date.now() - 400 * 86400000));

  if (!days.length) return { rows, remaining, ...ledger.finish(floor) };
  console.log(
    `Daily index: ${days.length + remaining} day(s) behind (after ${fromDay}); scanning ${days.length} this run…`
  );
  const fail = (day, why) => {
    const { attempts: n, banned } = ledger.fail(day);
    console.warn(`  ${day}: ${why} — attempt ${n} of ${MAX_DAY_ATTEMPTS}`);
    return banned;
  };

  for (const day of days) {
    let files = [];
    let status = 0;
    try {
      ({ files, status } = await dailyIndex(day));
    } catch (e) {
      if (fail(day, `index failed (${e.message})`)) break;
      continue;
    }
    // 403/429 means EDGAR refused this file. One day is skipped and retried;
    // several in a row means it is refusing us, so the run stops.
    if (status !== 200 && status !== 404) {
      if (fail(day, `index HTTP ${status}`)) break;
      continue;
    }
    let kept = 0;
    let failed = 0;
    const CONC = 8; // the pacer, not this number, decides the request rate
    let i = 0;
    await Promise.all(
      Array.from({ length: CONC }, async () => {
        while (i < files.length) {
          const f = files[i++];
          try {
            const parsed = await parseForm4(f, day);
            for (const r of parsed) {
              if (r.d < cutoff) continue;
              const rcl = r.cl || classifyTransaction(r.k);
              if (rcl === 'liquidity' && r.d < sellCutoff) continue;
              if (rcl === 'noise' && r.d < noiseCutoff) continue;
              rows.push(r);
              kept++;
            }
          } catch {
            failed++;
          }
        }
      })
    );
    if (files.length && failed > files.length * 0.5) {
      if (fail(day, `${failed}/${files.length} filings unreadable`)) break;
      continue;
    }
    ledger.ok(day);
    console.log(`  ${day}: ${files.length} form 4s → ${kept} transactions${failed ? ` (${failed} unreadable)` : ''}`);
  }

  const { scannedThrough, badDays, banned, streak } = ledger.finish(floor);
  if (banned) console.warn(`  EDGAR refused ${streak.length} days in a row — stopping this run.`);

  return { rows, scannedThrough, remaining, badDays, banned };
}

// --------------------------------------------------------------- enrichment
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
const existing = readJson(OUT, { rows: [], lastDay: null });
const prevRows = Array.isArray(existing.rows) ? existing.rows : [];
console.log(`Existing dataset: ${prevRows.length} rows, last day ${existing.lastDay || '—'}`);

let fresh = [];
let lastDay = existing.lastDay;

if (!prevRows.length) {
  console.log('First run — pulling the quarterly SEC datasets…');
  const q = await fromQuarterlyDatasets();
  fresh = q.rows;
  lastDay = q.newest || iso(new Date(Date.now() - 30 * 86400000));
  console.log(`Quarterly datasets: ${fresh.length} rows through ${lastDay}`);
}

const startedFrom = lastDay;
const daily = await fromDailyIndex(
  lastDay || iso(new Date(Date.now() - 7 * 86400000)),
  existing.badDays || {}
);
fresh = fresh.concat(daily.rows);
// The checkpoint only moves over days we actually read, plus the days EDGAR
// never published. A throttled or failed day is left behind for the next run.
if (daily.scannedThrough && daily.scannedThrough > (lastDay || '')) lastDay = daily.scannedThrough;
if (daily.remaining > 0) console.log(`${daily.remaining} day(s) still to backfill — the next run continues.`);

// A run that is behind and moved the checkpoint nowhere has achieved nothing,
// and would otherwise report success and rot silently — which is how the
// dataset sat four months stale behind a green workflow. Fail loudly instead.
const stalled = daily.banned || (daily.remaining > 0 && daily.scannedThrough === startedFrom);

// merge, de-duplicate (accession + insider + date + shares), trim the window
const seen = new Set();
const all = [];
let implausible = 0;
for (const r of [...prevRows, ...fresh]) {
  if (!r?.d || r.d < cutoff) continue;
  // a trade dated after the filing that reports it is the filer's typo, and
  // would sit at the top of every date-sorted view as an upcoming trade
  if (!plausibleDates(r.d, r.f)) {
    implausible++;
    continue;
  }
  // rows stored before the symbol cleaner existed still carry "OMEX", (SIRI)
  // and the odd CIK; normalise on the way through so they heal in one build
  if (r.t) r.t = cleanSymbol(r.t);
  const cl = r.cl || classifyTransaction(r.k);
  if (cl === 'liquidity' && r.d < sellCutoff) continue;
  if (cl === 'noise' && r.d < noiseCutoff) continue;
  if (!r.cl) r.cl = cl;
  const id = `${r.a}|${r.n}|${r.d}|${r.k}|${r.s}`;
  if (seen.has(id)) continue;
  seen.add(id);
  all.push(r);
}
// Ascending by filing date: new rows append at the end and only a small slice
// falls off the front each day, which keeps the daily git delta tiny.
all.sort((a, b) => (a.f === b.f ? (a.d < b.d ? -1 : 1) : a.f < b.f ? -1 : 1));

const companies = { ...(existing.companies || {}) };
for (const r of [...prevRows, ...fresh]) if (r.t && r.c) companies[r.t] = r.c;
for (const r of all) delete r.c;
// One pass over the rows instead of a scan per company name: the dataset is
// 78k rows and 4.5k names now, and the nested version was doing 350M
// comparisons on every daily build.
const live = new Set(all.filter((r) => r.t).map((r) => r.t));
for (const k of Object.keys(companies)) if (!live.has(k)) delete companies[k];

if (implausible) console.log(`Dropped ${implausible} row(s) dated after their own filing.`);

const tickers = [...live];
// issuer CIK per ticker, for the SEC lookups the enrichment makes
const cikOf = new Map();
for (const r of all) if (r.t && r.ci && !cikOf.has(r.t)) cikOf.set(r.t, r.ci);
const meta = await enrich(tickers.slice(0, Number(process.env.INSIDER_ENRICH_MAX || 5000)), cikOf);
fs.writeFileSync(META, JSON.stringify(meta));

fs.writeFileSync(
  OUT,
  JSON.stringify({
    updatedAt: new Date().toISOString(),
    lastDay,
    count: all.length,
    ...(Object.keys(daily.badDays || {}).length ? { badDays: daily.badDays } : {}),
    companies,
    rows: all,
  })
);
const teaser = buildTeaser(all, companies, meta);
fs.writeFileSync(path.join(pubDir, 'insiders-teaser.json'), JSON.stringify(teaser));
const buys = all.filter((r) => r.k === 'P');

console.log(
  `insiders.json: ${all.length} rows (${buys.length} buys), ${tickers.length} tickers, through ${lastDay}`
);

// Everything is written before this check so a stalled run still ships the
// data it has; the non-zero exit is what turns the workflow red.
if (stalled) {
  console.error(
    `\nStalled: ${daily.remaining + 1} day(s) behind and the checkpoint did not move past ${startedFrom}. ` +
      `EDGAR refused every attempt — check the 403s above and re-run.`
  );
  process.exit(1);
}
