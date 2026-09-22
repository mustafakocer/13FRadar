import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import { parseStringPromise, processors } from 'xml2js';
import { cached, TTL } from './cache.js';
import { storedHoldings } from './holdingsStore.js';
import { effectiveFilings, effectiveSnapshot, isAmendmentForm, parseCoverPage } from './amendments.js';
import { RateClock } from './edgarClock.js';
import { cacheGet, cachePut, cacheStats } from './edgarCache.js';

// SEC requires a descriptive User-Agent with contact info.
const UA = process.env.SEC_USER_AGENT || 'Fundocap/1.0 (kocergpt@gmail.com)';

// A batch script can wait out a slow EDGAR response; a request on Vercel has
// a ten-second function limit and a reader watching a spinner. Fail fast
// there and let the page render what it has — the CDN keeps the last good
// answer for a week.
const http = axios.create({
  timeout: process.env.VERCEL ? 8000 : 25000,
  headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' },
});

// EDGAR fair-access policy: at most 10 requests per second per IP, and a
// temporary block (429 or 403 "Request Rate Threshold Exceeded", 503 on a
// bad day) once it is exceeded. Every EDGAR call goes through one
// process-wide adaptive clock (edgarClock.js): a rate-limit answer halves
// the rate for a cool-down and a clean run walks it back up, so a retry
// never goes back in at the rate that was just rejected. Rate-limit and
// transient failures are retried with backoff. The batch scripts (GitHub
// Actions) wait long enough to outlast a ten-minute block; on Vercel a
// request can only afford a couple of short retries.
//   SEC_RPS            ceiling, requests per second (default 6 in a batch
//                      run, 8 on Vercel — the safe band is 6–8)
//   SEC_RETRY_BACKOFF  comma-separated seconds between retries
const RPS = Math.max(1, Number(process.env.SEC_RPS) || (process.env.VERCEL ? 8 : 6));
const BACKOFF = (
  process.env.SEC_RETRY_BACKOFF ||
  (process.env.VERCEL ? '1' : '5,15,30,60,120,300')
)
  .split(',')
  .map(Number)
  .filter((n) => n >= 0);
const clock = new RateClock({ rps: RPS });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function slot() {
  const wait = clock.take();
  if (wait > 0) await sleep(wait);
}
const rateLimited = (st) => st === 429 || st === 403 || st === 503;
function retriable(e) {
  const st = e.response?.status;
  if (rateLimited(st)) return true;
  if (st >= 500 && st < 600) return true;
  return !st && /ECONNRESET|ETIMEDOUT|ECONNABORTED|EAI_AGAIN|timeout|socket hang up/i.test(e.message || '');
}
export async function secGet(url, opts) {
  for (let attempt = 0; ; attempt++) {
    await slot();
    try {
      const r = await http.get(url, opts);
      clock.noteOk();
      return r;
    } catch (e) {
      if (rateLimited(e.response?.status)) clock.noteRateLimited();
      if (!retriable(e) || attempt >= BACKOFF.length) throw e;
      clock.noteRetry();
      const ra = Number(e.response?.headers?.['retry-after']);
      const wait = (ra > 0 ? ra : BACKOFF[attempt]) * 1000;
      console.warn(
        `EDGAR ${e.response?.status || e.code || 'error'} for ${url} — retry ${attempt + 1}/${BACKOFF.length} in ${wait / 1000}s (rate now ${clock.rate.toFixed(1)}/s)`
      );
      await sleep(wait);
    }
  }
}
// Requests made, rate-limit answers, retries, and the disk cache's hit
// ratio — the build logs print this at the end.
export const edgarStats = () => ({ ...clock.snapshot(), cache: cacheStats() });
// Test hook: lets a test swap the transport without touching the network.
export const secHttp = http;

// Offline fixtures for tests and sandboxes without EDGAR access:
//   $SEC_FIXTURE_DIR/submissions/CIK0001067983.json
//   $SEC_FIXTURE_DIR/filings/<cik>/<accession-no-dashes>/infotable.xml
// Never consulted unless the env var is set explicitly.
const FIXTURES = process.env.SEC_FIXTURE_DIR || null;
function fixture(rel) {
  if (!FIXTURES) return null;
  const file = path.join(FIXTURES, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

export const padCik = (cik) => String(cik).replace(/\D/g, '').padStart(10, '0');
export const numCik = (cik) => String(Number(String(cik).replace(/\D/g, '')));

export function getSubmissions(cik) {
  const id = padCik(cik);
  return cached(`sub:${id}`, TTL.HOUR_1, async () => {
    const fx = fixture(`submissions/CIK${id}.json`);
    if (fx) return JSON.parse(fx);
    const { data } = await secGet(`https://data.sec.gov/submissions/CIK${id}.json`);
    return data;
  });
}

// Every 13F-HR and 13F-HR/A in the submissions feed, one row per accession,
// newest filed first — the raw list, for the audit trail and the filing feed.
export function list13FAll(sub) {
  const r = sub?.filings?.recent;
  if (!r) return [];
  const out = [];
  for (let i = 0; i < (r.form || []).length; i++) {
    if (!String(r.form[i]).startsWith('13F-HR')) continue;
    out.push({
      acc: r.accessionNumber[i],
      form: r.form[i],
      filingDate: r.filingDate[i],
      reportDate: r.reportDate[i],
      amended: isAmendmentForm(r.form[i]),
    });
  }
  return out.sort((a, b) => (a.filingDate === b.filingDate ? String(b.acc).localeCompare(String(a.acc)) : a.filingDate < b.filingDate ? 1 : -1));
}

// One filing per period of report, newest period first: the original 13F-HR
// with its 13F-HR/A amendments attached (see amendments.js). This used to
// keep "the most recently filed document per quarter", which let a
// four-line NEW HOLDINGS amendment stand in for the whole quarter.
export function list13F(sub) {
  return effectiveFilings(list13FAll(sub));
}

// The directory listing of one submission, cached in memory and on disk:
// the info table and the cover page are both picked out of it.
function filingIndex(cik, acc) {
  const cikN = numCik(cik);
  const accNo = acc.replace(/-/g, '');
  const base = `https://www.sec.gov/Archives/edgar/data/${cikN}/${accNo}`;
  return cached(`idx:${cikN}:${accNo}`, TTL.DAY_7, async () => {
    const onDisk = cacheGet(cikN, accNo, 'index.json');
    let idx;
    if (onDisk) idx = JSON.parse(onDisk);
    else {
      idx = (await secGet(`${base}/index.json`)).data;
      cachePut(cikN, accNo, 'index.json', JSON.stringify(idx));
    }
    let items = idx?.directory?.item || [];
    if (!Array.isArray(items)) items = [items];
    return { base, items };
  });
}

// A filed document never changes, so the table is read from disk when a
// previous run stored it; the directory listing is only needed on a miss.
export async function fetchInfoTableXml(cik, acc) {
  const cikN = numCik(cik);
  const accNo = acc.replace(/-/g, '');
  const fx = fixture(`filings/${cikN}/${accNo}/infotable.xml`);
  if (fx) return fx;
  const onDisk = cacheGet(cikN, accNo, 'infotable.xml');
  if (onDisk) return onDisk;
  const { base, items } = await filingIndex(cik, acc);
  const xmls = items.filter(
    (i) => /\.xml$/i.test(i.name) && !/primary_doc/i.test(i.name)
  );
  if (!xmls.length) throw new Error('No information table XML found in filing');
  const pick =
    xmls.find((i) => /info/i.test(i.name)) ||
    xmls.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0))[0];
  const { data: xml } = await secGet(`${base}/${pick.name}`, {
    responseType: 'text',
    transformResponse: [(d) => d],
  });
  cachePut(cikN, accNo, 'infotable.xml', xml);
  return xml;
}

// The cover page of a submission (primary_doc.xml): the period of report
// the filer wrote, and for an amendment whether it restates the table or
// adds to it. Null when the document cannot be read — the caller then
// infers the kind from the table (amendments.js). Cached for a week like
// the table: a filed document does not change.
//   fixture: $SEC_FIXTURE_DIR/filings/<cik>/<acc>/primary_doc.xml
export function fetchCoverPage(cik, acc) {
  const cikN = numCik(cik);
  const accNo = acc.replace(/-/g, '');
  return cached(`cover:${cikN}:${accNo}`, TTL.DAY_7, async () => {
    const fx = fixture(`filings/${cikN}/${accNo}/primary_doc.xml`);
    if (fx) return parseCoverPage(fx);
    if (FIXTURES) return null; // offline: no cover page in the fixture set
    const onDisk = cacheGet(cikN, accNo, 'primary_doc.xml');
    if (onDisk) return parseCoverPage(onDisk);
    try {
      const { base, items } = await filingIndex(cik, acc);
      const doc = items.find((i) => /primary_doc\.xml$/i.test(i.name)) || items.find((i) => /^primary_doc/i.test(i.name));
      if (!doc) return null;
      const { data } = await secGet(`${base}/${doc.name}`, { responseType: 'text', transformResponse: [(d) => d] });
      cachePut(cikN, accNo, 'primary_doc.xml', data);
      return parseCoverPage(data);
    } catch {
      return null;
    }
  });
}

export async function parse13F(xml) {
  const doc = await parseStringPromise(xml, {
    explicitArray: false,
    ignoreAttrs: true,
    tagNameProcessors: [processors.stripPrefix],
  });
  let rows = doc?.informationTable?.infoTable || [];
  if (!Array.isArray(rows)) rows = [rows];
  return rows;
}

// Filings submitted on/after 2023-01-03 report values in whole dollars;
// earlier filings report in thousands (SEC rule amendment).
export function valueMultiplier(filingDate) {
  return filingDate && filingDate >= '2023-01-03' ? 1 : 1000;
}

// The band of implied share prices a whole equity book can sit in. It is
// deliberately wide: the top has to clear Berkshire A stock (about $700k a
// share) and the bottom has to leave room for a genuine penny-stock fund.
const SANE_PRICE = [0.01, 100_000];

// Some filers ignore the reporting-unit rule: whole dollars in a filing that
// should be thousands, or thousands in one that should be dollars. Either way
// the portfolio comes out 1000× wrong, which is the difference between a $7B
// fund and a $7M one.
//
// The date rule decides the multiplier; this checks the result against the
// share prices the filing itself implies, and only overrides when the stated
// units put the median price outside anything a stock can trade at *and* the
// other unit puts it back inside. A filing that is merely unusual is left
// alone — a wrong correction is worse than an odd-looking number.
//
// This catches a book reported 1000× too large, where the implied prices climb
// past any traded price. It deliberately does not catch one reported 1000× too
// small: a median implied price of fifteen cents is what a filer writing
// thousands into a dollars filing looks like, and it is also exactly what a
// real penny-stock fund looks like. Without market prices to compare against,
// correcting that case would silently multiply a legitimate portfolio by a
// thousand, so the extreme end (under a cent a share) is the only part of that
// direction acted on.
export function detectValueScale(rows, filingDate, { minRows = 8 } = {}) {
  const stated = valueMultiplier(filingDate);
  const prices = [];
  for (const r of rows) {
    // principal amounts (convertible debt) are not share counts, so the ratio
    // is not a price and must not vote
    if (String(r.shrsOrPrnAmt?.sshPrnamtType || 'SH').toUpperCase() !== 'SH') continue;
    const value = Number(r.value) || 0;
    const shares = Number(r.shrsOrPrnAmt?.sshPrnamt) || 0;
    if (value > 0 && shares > 0) prices.push((value * stated) / shares);
  }
  if (prices.length < minRows) return { mult: stated, corrected: false, median: null };
  prices.sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)];
  const sane = (p) => p >= SANE_PRICE[0] && p <= SANE_PRICE[1];
  if (sane(median)) return { mult: stated, corrected: false, median };
  for (const factor of [1000, 1 / 1000]) {
    if (sane(median * factor)) {
      return { mult: stated * factor, corrected: true, median, correctedMedian: median * factor };
    }
  }
  return { mult: stated, corrected: false, median };
}

export function aggregatePositions(rows, filingDate) {
  const { mult, corrected } = detectValueScale(rows, filingDate);
  const map = new Map();
  for (const r of rows) {
    const cusip = String(r.cusip || '').toUpperCase().trim();
    const putCall = (r.putCall || '').trim();
    const key = `${cusip}|${putCall}`;
    const value = (Number(r.value) || 0) * mult;
    const shares = Number(r.shrsOrPrnAmt?.sshPrnamt) || 0;
    const cur =
      map.get(key) || {
        cusip,
        putCall,
        issuer: r.nameOfIssuer || '',
        class: r.titleOfClass || '',
        value: 0,
        shares: 0,
      };
    cur.value += value;
    cur.shares += shares;
    map.set(key, cur);
  }
  const positions = [...map.values()].sort((a, b) => b.value - a.value);
  const aum = positions.reduce((s, p) => s + p.value, 0);
  for (const p of positions) p.weight = aum ? (p.value / aum) * 100 : 0;
  // `unitFix` travels with the filing so a page can say the numbers were
  // corrected rather than quietly restating what the filer reported.
  return { aum, positions, ...(corrected ? { unitFix: true } : {}) };
}

// Full holdings for one filing — cached long-term since filings are immutable.
//
// When the historical store is configured and has this filing, it answers;
// otherwise the info table is fetched and parsed as before. The store is off
// by default and returns null on any trouble, so this is a shortcut, never a
// dependency.
export function getHoldings(cik, acc, filingDate) {
  return cached(`hold:${numCik(cik)}:${acc}`, TTL.DAY_7, async () => {
    const stored = await storedHoldings(cik, acc);
    if (stored) return stored;
    const xml = await fetchInfoTableXml(cik, acc);
    const rows = await parse13F(xml);
    let fd = filingDate;
    if (!fd) {
      const sub = await getSubmissions(cik);
      fd = list13FAll(sub).find((f) => f.acc === acc)?.filingDate;
    }
    return aggregatePositions(rows, fd);
  });
}

// The effective snapshot of one period: the filing's base document with its
// amendments applied in filing order (amendments.js). `filing` is an entry
// from list13F — { acc, filingDate, amendments: [{ acc, filingDate }] }.
// This is what every derived number (positions, changes, turnover, time
// held, AUM history, consensus) reads; getHoldings stays the raw read of one
// accession for the audit trail.
//
// An amendment whose table cannot be read is skipped rather than failing the
// quarter: the original alone is the better answer than no answer.
export function getEffectiveHoldings(cik, filing) {
  const amendments = filing?.amendments || [];
  if (!amendments.length) return getHoldings(cik, filing.acc, filing.filingDate);
  const stamp = amendments.map((a) => a.acc).join('+');
  return cached(`ehold:${numCik(cik)}:${filing.acc}:${stamp}`, TTL.DAY_7, async () => {
    const base = await getHoldings(cik, filing.acc, filing.filingDate);
    const read = await Promise.all(
      amendments.map(async (a) => {
        const [holdings, cover] = await Promise.all([
          getHoldings(cik, a.acc, a.filingDate).catch((e) => {
            console.warn(`amendment ${a.acc} for ${filing.acc} could not be read: ${e.message}`);
            return null;
          }),
          fetchCoverPage(cik, a.acc),
        ]);
        return { acc: a.acc, filingDate: a.filingDate, holdings, cover };
      })
    );
    return effectiveSnapshot(base, read);
  });
}

// The filing (from list13F) an accession belongs to: the entry itself or
// the entry whose amendments include it, so a link to an amendment's
// accession lands on the effective snapshot of its period.
export function filingForAcc(filings, acc) {
  return filings.find((f) => f.acc === acc || (f.amendments || []).some((a) => a.acc === acc)) || null;
}

// EDGAR full-text search (the backend behind efts.sec.gov/LATEST/search-index).
export async function ftsSearch(q, forms = '13F-HR') {
  const { data } = await secGet('https://efts.sec.gov/LATEST/search-index', {
    params: { q: `"${q}"`, forms },
  });
  return data;
}

// Classic company search fallback — returns atom XML we walk generically.
export async function companySearchAtom(q) {
  const { data } = await secGet('https://www.sec.gov/cgi-bin/browse-edgar', {
    params: {
      action: 'getcompany',
      company: q,
      type: '13F-HR',
      count: 40,
      output: 'atom',
    },
    responseType: 'text',
    transformResponse: [(d) => d],
  });
  const doc = await parseStringPromise(data, {
    explicitArray: false,
    ignoreAttrs: true,
    tagNameProcessors: [processors.stripPrefix],
  });
  const found = new Map();
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    const cik = node.cik || node.CIK;
    const name = node['conformed-name'] || node.conformedName || node.name;
    if (cik && name && /^\d+$/.test(String(cik))) {
      found.set(padCik(cik), { cik: padCik(cik), name: String(name) });
    }
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (typeof v === 'object') walk(v);
    }
  })(doc);
  return [...found.values()];
}
