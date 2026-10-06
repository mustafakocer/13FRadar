// Ticker → company web domain, for the logo CDN (TickerLogo.jsx) and as the
// logo harvest's first source of a company's site (build-logos.mjs).
//
//   node scripts/build-domains.mjs            # top up: the next batch of unresolved tickers
//   node scripts/build-domains.mjs --refresh  # redo every ticker
//
// The universe is every ticker a page can show, most visible first: the top
// 500 (client/public/stocks.json), the superinvestor set's stocks
// (api/_data/guru-stocks.json), the insider feed's companies
// (api/_data/insiders.json), then the rest of SEC's ticker list
// (api/_data/company-names.json). Per ticker not yet resolved:
//   0. an ETF / trust sponsor recognised in the issuer name (no website at
//      the SEC for those; the sponsor's brand is the logo)
//   1. SEC company_tickers.json → CIK, then the submissions feed's `website`
//      (else `investorWebsite`) — free, no key, SEC_USER_AGENT only
//   2. Finnhub's company profile when SEC has none and FINNHUB_API_KEY is set
//      (paced at LOGO_FINNHUB_PER_MIN, default 25/min)
// Hosts are reduced to the brand's registrable domain (ir.kkr.com → kkr.com).
// One run resolves at most DOMAINS_BATCH tickers (default 1200, ~45 min at
// the SEC's pace), so the backlog fills over a few daily runs and a weekly
// top-up after that is seconds. A ticker that resolved nowhere is noted in
// `tried` and not asked again for RETRY_DAYS.
// Output: client/public/domains.json — { updatedAt, universe, ok, pct,
// domains: { TICKER: "apple.com" }, tried: { TICKER: iso } }.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import { tickerMap } from '../api/_lib/tickers.js';
import { getSubmissions } from '../api/_lib/sec.js';
import { hostOf, rootDomain, sponsorDomain } from '../api/_lib/logoScrape.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const pub = path.join(root, 'client', 'public');
const data = path.join(root, 'api', '_data');
const outPath = path.join(pub, 'domains.json');
const refresh = process.argv.includes('--refresh');
const BATCH = Number(process.env.DOMAINS_BATCH) || 1200;
const RETRY_DAYS = 30;
const PER_MIN = Number(process.env.LOGO_FINNHUB_PER_MIN) || 25;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const TICKER = /^[A-Z][A-Z0-9.-]{0,6}$/;

// ---------- the universe: [ticker, issuer name], most visible first ----------
function universe() {
  const seen = new Map();
  const add = (t, name) => { const sym = String(t || '').trim().toUpperCase(); if (TICKER.test(sym) && !seen.has(sym)) seen.set(sym, String(name || '')); };
  for (const r of readJson(path.join(pub, 'stocks.json'))?.rows || []) add(r.ticker, r.issuer);
  for (const r of readJson(path.join(data, 'guru-stocks.json'))?.stocks || []) add(r.ticker, r.issuer);
  for (const [t, name] of Object.entries(readJson(path.join(data, 'insiders.json'))?.companies || {})) add(t, name);
  for (const [t, name] of Object.entries(readJson(path.join(data, 'company-names.json'))?.names || {})) add(t, name);
  return [...seen.entries()];
}

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
  const all = universe();
  if (!all.length) { console.log('::warning::domains: no tickers found in the data files'); return; }
  const prior = refresh ? null : readJson(outPath);
  // prior hosts re-normalised: an older manifest may hold ir./corporate. hosts
  const domains = Object.fromEntries(Object.entries(prior?.domains || {}).map(([t, h]) => [t, rootDomain(h) || h]));
  const tried = { ...(prior?.tried || {}) };
  const stale = (t) => !tried[t] || (Date.now() - Date.parse(tried[t])) / 86400000 >= RETRY_DAYS;
  const todo = all.filter(([t]) => !domains[t] && stale(t)).slice(0, BATCH);
  const ciks = await tickerMap();
  const key = process.env.FINNHUB_API_KEY || '';
  let sponsor = 0, sec = 0, fin = 0, none = 0;
  for (const [i, [t, name]] of todo.entries()) {
    let host = sponsorDomain(name);
    if (host) sponsor++;
    else {
      host = rootDomain(await fromSec(t, ciks));
      if (host) sec++;
      else if (key) {
        const t0 = Date.now();
        host = rootDomain(await fromFinnhub(t, key).catch(() => null));
        if (host) fin++;
        await sleep(Math.max(0, Math.ceil(60000 / PER_MIN) - (Date.now() - t0)));
      }
    }
    if (host) { domains[t] = host; delete tried[t]; } else { none++; tried[t] = new Date().toISOString(); }
    if ((i + 1) % 100 === 0) console.log(`domains: ${i + 1}/${todo.length} · ${sponsor} sponsor, ${sec} SEC, ${fin} Finnhub, ${none} none`);
  }
  const ok = Object.keys(domains).length;
  const left = all.filter(([t]) => !domains[t] && stale(t)).length;
  fs.writeFileSync(outPath, JSON.stringify({ updatedAt: new Date().toISOString(), universe: all.length, ok, pct: Math.round((ok / all.length) * 100), backlog: left, domains, tried }));
  console.log(`domains: ${ok}/${all.length} (${Math.round((ok / all.length) * 100)}%) · this run ${todo.length}: ${sponsor} sponsor, ${sec} SEC, ${fin} Finnhub, ${none} none · ${left} still to try${key ? '' : ' (FINNHUB_API_KEY not set: SEC only)'}`);
}

// a SEC outage keeps the last manifest rather than failing the job
try { await main(); } catch (e) { console.log(`::warning::domains: ${e.response?.status || e.code || e.message} — manifest left as is`); }
