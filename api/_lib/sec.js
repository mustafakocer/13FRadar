import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import { parseStringPromise, processors } from 'xml2js';
import { cached, TTL } from './cache.js';

// SEC requires a descriptive User-Agent with contact info.
const UA = process.env.SEC_USER_AGENT || '13FRadar/1.0 (kocergpt@gmail.com)';

const http = axios.create({
  timeout: 25000,
  headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' },
});

// EDGAR fair-access policy: at most 10 requests per second per IP, and a
// temporary block (429 or 403 "Request Rate Threshold Exceeded") once it is
// exceeded. Every EDGAR call goes through one process-wide token clock, and
// rate-limit / transient failures are retried with backoff. The batch
// scripts (GitHub Actions) wait long enough to outlast a ten-minute block;
// on Vercel a request can only afford a couple of short retries.
//   SEC_RPS            requests per second (default 8)
//   SEC_RETRY_BACKOFF  comma-separated seconds between retries
const RPS = Math.max(1, Number(process.env.SEC_RPS) || 8);
const BACKOFF = (
  process.env.SEC_RETRY_BACKOFF ||
  (process.env.VERCEL ? '1,2' : '5,15,30,60,120,300')
)
  .split(',')
  .map(Number)
  .filter((n) => n >= 0);
let nextSlot = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function slot() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + 1000 / RPS;
  if (at > now) await sleep(at - now);
}
function retriable(e) {
  const st = e.response?.status;
  if (st === 429 || st === 403) return true;
  if (st >= 500 && st < 600) return true;
  return !st && /ECONNRESET|ETIMEDOUT|ECONNABORTED|EAI_AGAIN|timeout|socket hang up/i.test(e.message || '');
}
export async function secGet(url, opts) {
  for (let attempt = 0; ; attempt++) {
    await slot();
    try {
      return await http.get(url, opts);
    } catch (e) {
      if (!retriable(e) || attempt >= BACKOFF.length) throw e;
      const ra = Number(e.response?.headers?.['retry-after']);
      const wait = (ra > 0 ? ra : BACKOFF[attempt]) * 1000;
      console.warn(
        `EDGAR ${e.response?.status || e.code || 'error'} for ${url} — retry ${attempt + 1}/${BACKOFF.length} in ${wait / 1000}s`
      );
      await sleep(wait);
    }
  }
}
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

// Extract the list of 13F-HR filings (deduped by report period; the most
// recently filed document per quarter wins, so amendments replace originals).
export function list13F(sub) {
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
    });
  }
  out.sort((a, b) => (a.filingDate < b.filingDate ? 1 : -1));
  const seen = new Set();
  return out.filter((f) => {
    if (seen.has(f.reportDate)) return false;
    seen.add(f.reportDate);
    return true;
  });
}

export async function fetchInfoTableXml(cik, acc) {
  const cikN = numCik(cik);
  const accNo = acc.replace(/-/g, '');
  const fx = fixture(`filings/${cikN}/${accNo}/infotable.xml`);
  if (fx) return fx;
  const base = `https://www.sec.gov/Archives/edgar/data/${cikN}/${accNo}`;
  const { data: idx } = await secGet(`${base}/index.json`);
  let items = idx?.directory?.item || [];
  if (!Array.isArray(items)) items = [items];
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
  return xml;
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

export function aggregatePositions(rows, filingDate) {
  const mult = valueMultiplier(filingDate);
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
  return { aum, positions };
}

// Full holdings for one filing — cached long-term since filings are immutable.
export function getHoldings(cik, acc, filingDate) {
  return cached(`hold:${numCik(cik)}:${acc}`, TTL.DAY_7, async () => {
    const xml = await fetchInfoTableXml(cik, acc);
    const rows = await parse13F(xml);
    let fd = filingDate;
    if (!fd) {
      const sub = await getSubmissions(cik);
      fd = list13F(sub).find((f) => f.acc === acc)?.filingDate;
    }
    return aggregatePositions(rows, fd);
  });
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
