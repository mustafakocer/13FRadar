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
//
// Env: SEC_USER_AGENT (required by SEC), FMP_API_KEY (optional enrichment),
//      INSIDER_MONTHS (default 12), INSIDER_MAX_DAYS (daily-index safety cap)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import axios from 'axios';
import { parseStringPromise, processors } from 'xml2js';
import { classifyRole, businessDaysBetween, classifyTransaction, KEPT_CODES } from '../api/_lib/insiderModel.js';
import { buildTeaser } from '../api/_lib/insiderTeaser.js';

const UA = process.env.SEC_USER_AGENT || '13FRadar insider bot (kocergpt@gmail.com)';
const MONTHS = Number(process.env.INSIDER_MONTHS || 12);
const MAX_DAYS = Number(process.env.INSIDER_MAX_DAYS || 25); // days scanned per run
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
        ticker: String(s.ISSUERTRADINGSYMBOL || '').trim().toUpperCase() || null,
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
async function dailyIndex(day) {
  const y = day.slice(0, 4);
  const q = Math.floor(Number(day.slice(5, 7) - 1) / 3) + 1;
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
    ticker: String(issuer.issuerTradingSymbol || '').trim().toUpperCase() || null,
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

async function fromDailyIndex(fromDay) {
  const rows = [];
  const today = new Date();
  const all = [];
  for (let i = 0; i < 400; i++) {
    const d = new Date(today.getTime() - i * 86400000);
    const day = iso(d);
    if (day <= fromDay) break;
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    all.push(day);
  }
  all.reverse();
  // Oldest first, capped per run: a full day is ~1900 filings ≈ 4 minutes at
  // SEC's rate limit, so the backlog is worked off over consecutive nights.
  const days = all.slice(0, MAX_DAYS);
  if (!days.length) return { rows, scannedThrough: fromDay, remaining: 0 };
  console.log(
    `Daily index: ${all.length} day(s) behind (after ${fromDay}); scanning ${days.length} this run…`
  );

  let scannedThrough = fromDay;
  for (const day of days) {
    let files = [];
    let status = 0;
    try {
      ({ files, status } = await dailyIndex(day));
    } catch (e) {
      console.warn(`  ${day}: index failed (${e.message}) — stopping here`);
      break;
    }
    // 403/429 means EDGAR is refusing us; stopping keeps the checkpoint honest
    if (status !== 200 && status !== 404) {
      console.warn(`  ${day}: index HTTP ${status} — stopping so the day is retried next run`);
      break;
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
      console.warn(`  ${day}: ${failed}/${files.length} filings unreadable — stopping, will retry`);
      break;
    }
    scannedThrough = day;
    console.log(`  ${day}: ${files.length} form 4s → ${kept} transactions${failed ? ` (${failed} unreadable)` : ''}`);
  }
  return { rows, scannedThrough, remaining: all.length - days.length };
}

// --------------------------------------------------------------- enrichment
// FMP batch endpoints: one request covers many symbols, so this stays well
// inside the free daily quota. Sector/market cap is cached and only fetched
// for tickers we have never seen.
async function enrich(tickers) {
  const meta = readJson(META, {});
  const key = process.env.FMP_API_KEY;
  if (!key) return meta;
  const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

  const unknown = tickers.filter((t) => !meta[t]?.sector);
  console.log(`Enriching: ${unknown.length} new tickers, ${tickers.length} price refreshes`);
  for (const group of chunk(unknown, 50).slice(0, 40)) {
    try {
      const { data } = await axios.get('https://financialmodelingprep.com/stable/profile', {
        params: { symbol: group.join(','), apikey: key },
        timeout: 20000,
        validateStatus: () => true,
      });
      for (const p of Array.isArray(data) ? data : []) {
        const sym = String(p.symbol || '').toUpperCase();
        if (!sym) continue;
        meta[sym] = {
          ...(meta[sym] || {}),
          sector: p.sector || null,
          industry: p.industry || null,
          mcap: num(p.marketCap ?? p.mktCap),
          name: p.companyName || meta[sym]?.name || null,
        };
      }
    } catch {
      /* enrichment is optional */
    }
    await sleep(400);
  }
  for (const group of chunk(tickers, 50).slice(0, 60)) {
    try {
      const { data } = await axios.get('https://financialmodelingprep.com/stable/quote', {
        params: { symbol: group.join(','), apikey: key },
        timeout: 20000,
        validateStatus: () => true,
      });
      for (const qd of Array.isArray(data) ? data : []) {
        const sym = String(qd.symbol || '').toUpperCase();
        if (!sym) continue;
        // vol/lo/hi drive the liquidity and off-the-low columns on the penny
        // board; every consumer treats them as optional, so a provider that
        // stops returning them degrades to "—" instead of breaking the page.
        meta[sym] = {
          ...(meta[sym] || {}),
          px: num(qd.price),
          mcap: num(qd.marketCap) ?? meta[sym]?.mcap,
          vol: num(qd.avgVolume) ?? num(qd.volume) ?? meta[sym]?.vol,
          lo: num(qd.yearLow) ?? meta[sym]?.lo,
          hi: num(qd.yearHigh) ?? meta[sym]?.hi,
        };
      }
    } catch {
      /* optional */
    }
    await sleep(400);
  }
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

const daily = await fromDailyIndex(lastDay || iso(new Date(Date.now() - 7 * 86400000)));
fresh = fresh.concat(daily.rows);
// The checkpoint only moves over days we actually read. A throttled or failed
// day is left behind so the next run picks it up again.
if (daily.scannedThrough && daily.scannedThrough > (lastDay || '')) lastDay = daily.scannedThrough;
if (daily.remaining > 0) console.log(`${daily.remaining} day(s) still to backfill — the next run continues.`);

// merge, de-duplicate (accession + insider + date + shares), trim the window
const seen = new Set();
const all = [];
for (const r of [...prevRows, ...fresh]) {
  if (!r?.d || r.d < cutoff) continue;
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
for (const k of Object.keys(companies)) if (!all.some((r) => r.t === k)) delete companies[k];

const tickers = [...new Set(all.filter((r) => r.t).map((r) => r.t))];
const meta = await enrich(tickers.slice(0, 3000));
fs.writeFileSync(META, JSON.stringify(meta));

fs.writeFileSync(
  OUT,
  JSON.stringify({ updatedAt: new Date().toISOString(), lastDay, count: all.length, companies, rows: all })
);
const teaser = buildTeaser(all, companies, meta);
fs.writeFileSync(path.join(pubDir, 'insiders-teaser.json'), JSON.stringify(teaser));
const buys = all.filter((r) => r.k === 'P');

console.log(
  `insiders.json: ${all.length} rows (${buys.length} buys), ${tickers.length} tickers, through ${lastDay}`
);
