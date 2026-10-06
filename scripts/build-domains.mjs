// Ticker → company web domain, for the logo CDN (TickerLogo.jsx) and as the
// logo harvest's first source of a company's site (build-logos.mjs).
//
//   node scripts/build-domains.mjs            # top up: tickers without a domain
//   node scripts/build-domains.mjs --refresh  # redo every ticker
//
// Per ticker of client/public/stocks.json (DOMAINS_TOP, default all):
//   1. SEC company_tickers.json → CIK, then the submissions feed's `website`
//      (else `investorWebsite`) — free, no key, SEC_USER_AGENT only
//   2. Finnhub's company profile when SEC has none and FINNHUB_API_KEY is set
//      (paced at LOGO_FINNHUB_PER_MIN, default 25/min)
// Output: client/public/domains.json — { updatedAt, tried, ok, domains:
// { TICKER: "apple.com" } }. A ticker with no domain anywhere is left out and
// every page keeps its two-letter badge for it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import { tickerMap } from '../api/_lib/tickers.js';
import { getSubmissions } from '../api/_lib/sec.js';
import { hostOf } from '../api/_lib/logoScrape.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '..', 'client', 'public');
const outPath = path.join(pub, 'domains.json');
const refresh = process.argv.includes('--refresh');
const TOP = Number(process.env.DOMAINS_TOP) || Infinity;
const PER_MIN = Number(process.env.LOGO_FINNHUB_PER_MIN) || 25;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

async function fromSec(sym, ciks) {
  const cik = ciks.get(sym) || ciks.get(sym.replace(/[.-]/g, '')) || ciks.get(sym.replace(/\./g, '-'));
  if (!cik) return null;
  const sub = await getSubmissions(cik).catch(() => null);
  return hostOf(sub?.website) || hostOf(sub?.investorWebsite);
}
async function fromFinnhub(sym, key) {
  const r = await axios.get('https://finnhub.io/api/v1/stock/profile2', { params: { symbol: sym, token: key }, timeout: 15000, validateStatus: () => true });
  if (r.status === 429) { await sleep(60000); return fromFinnhub(sym, key); }
  return r.status === 200 ? hostOf(r.data?.weburl) : null;
}

async function main() {
  const stocks = readJson(path.join(pub, 'stocks.json'));
  const tickers = [...new Set((stocks?.rows || []).map((s) => String(s.ticker || '').trim().toUpperCase()).filter(Boolean))].slice(0, TOP);
  if (!tickers.length) { console.log('::warning::domains: stocks.json has no tickers'); return; }
  const prior = refresh ? {} : (readJson(outPath)?.domains || {});
  const ciks = await tickerMap();
  const key = process.env.FINNHUB_API_KEY || '';
  const domains = {};
  let kept = 0, sec = 0, fin = 0, none = 0;
  for (const [i, t] of tickers.entries()) {
    if (prior[t]) { domains[t] = prior[t]; kept++; continue; }
    let host = await fromSec(t, ciks);
    if (host) sec++;
    else if (key) {
      const t0 = Date.now();
      host = await fromFinnhub(t, key).catch(() => null);
      if (host) fin++;
      await sleep(Math.max(0, Math.ceil(60000 / PER_MIN) - (Date.now() - t0)));
    }
    if (host) domains[t] = host; else none++;
    if ((i + 1) % 100 === 0) console.log(`domains: ${i + 1}/${tickers.length} · ${sec} SEC, ${fin} Finnhub, ${kept} kept, ${none} none`);
  }
  const ok = Object.keys(domains).length;
  fs.writeFileSync(outPath, JSON.stringify({ updatedAt: new Date().toISOString(), tried: tickers.length, ok, pct: Math.round((ok / tickers.length) * 100), domains }));
  console.log(`domains: ${ok}/${tickers.length} (${Math.round((ok / tickers.length) * 100)}%) · ${sec} from SEC, ${fin} from Finnhub, ${kept} kept, ${none} without a site${key ? '' : ' (FINNHUB_API_KEY not set: SEC only)'}`);
}

// a SEC outage keeps last week's manifest rather than failing the logo job
try { await main(); } catch (e) { console.log(`::warning::domains: ${e.response?.status || e.code || e.message} — manifest left as is`); }
