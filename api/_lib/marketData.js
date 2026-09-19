// Sector, market cap, price and returns for the batch builds, from sources
// that need no key and answer from a GitHub runner.
//
// The builds used to lean on three paid or gated providers for this, and each
// went dark in its own way without failing the workflow: Yahoo's quote and
// quoteSummary endpoints answer 429 from datacenter IPs, FMP's free plan
// stopped taking more than one symbol per call (an empty list or a 402 in
// place of profiles), and Stooq now sits behind a JavaScript challenge. The
// result was a screener whose sector and size filters were empty for months.
//
// What still answers, and what each is used for:
//   · Yahoo's chart endpoint (no cookie, no crumb): price, 52-week range,
//     volume, instrument type and a year of closes for the return columns.
//   · SEC submissions: the SIC code every operating company carries, which
//     folds into the eleven sectors the site filters by.
//   · SEC XBRL frames: shares outstanding for every filer in one request,
//     which times the chart price into a market cap.
// Everything here that does not touch the network is pure and tested.
import axios from 'axios';
import { secGet, padCik } from './sec.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- sectors
// The sector names the screener and the report already speak.
export const SECTORS = [
  'Technology',
  'Healthcare',
  'Financial Services',
  'Consumer Cyclical',
  'Consumer Defensive',
  'Industrials',
  'Energy',
  'Basic Materials',
  'Real Estate',
  'Utilities',
  'Communication Services',
];

// SIC → sector, most specific range first. SIC is a 1987 taxonomy and the
// sectors are a 2000s one, so this is a best fit, not a lookup: a bank is a
// bank, but "services-misc business" holds payment networks next to
// staffing agencies. The ranges below follow where the large names in each
// code actually sit on the quote pages the site used to read.
const SIC_RANGES = [
  // agriculture, mining
  [100, 999, 'Consumer Defensive'],
  [1000, 1099, 'Basic Materials'],
  [1200, 1299, 'Energy'],
  [1300, 1399, 'Energy'],
  [1400, 1499, 'Basic Materials'],
  // construction: homebuilders are a consumer name, contractors industrial
  [1500, 1549, 'Consumer Cyclical'],
  [1600, 1799, 'Industrials'],
  // manufacturing
  [2000, 2199, 'Consumer Defensive'],
  [2200, 2399, 'Consumer Cyclical'],
  [2400, 2449, 'Basic Materials'],
  [2450, 2459, 'Consumer Cyclical'],
  [2500, 2599, 'Consumer Cyclical'],
  [2600, 2699, 'Basic Materials'],
  [2700, 2799, 'Communication Services'],
  [2830, 2839, 'Healthcare'],
  [2840, 2849, 'Consumer Defensive'],
  [2800, 2899, 'Basic Materials'],
  [2900, 2999, 'Energy'],
  [3000, 3199, 'Consumer Cyclical'],
  [3200, 3399, 'Basic Materials'],
  [3400, 3499, 'Industrials'],
  [3570, 3579, 'Technology'],
  [3500, 3599, 'Industrials'],
  [3630, 3639, 'Consumer Cyclical'],
  [3600, 3699, 'Technology'],
  [3710, 3719, 'Consumer Cyclical'],
  [3750, 3759, 'Consumer Cyclical'],
  [3700, 3799, 'Industrials'],
  [3812, 3812, 'Industrials'],
  [3826, 3826, 'Healthcare'],
  [3840, 3859, 'Healthcare'],
  [3873, 3873, 'Consumer Cyclical'],
  [3800, 3899, 'Technology'],
  [3900, 3999, 'Consumer Cyclical'],
  // transport, communications, utilities
  [4000, 4799, 'Industrials'],
  [4800, 4899, 'Communication Services'],
  [4950, 4959, 'Industrials'],
  [4900, 4999, 'Utilities'],
  // wholesale
  [5045, 5045, 'Technology'],
  [5065, 5065, 'Technology'],
  [5122, 5122, 'Healthcare'],
  [5140, 5149, 'Consumer Defensive'],
  [5170, 5179, 'Energy'],
  [5000, 5199, 'Industrials'],
  // retail
  [5331, 5331, 'Consumer Defensive'],
  [5399, 5399, 'Consumer Defensive'],
  [5400, 5499, 'Consumer Defensive'],
  [5912, 5912, 'Consumer Defensive'],
  [5200, 5999, 'Consumer Cyclical'],
  // finance, insurance, real estate
  [6500, 6599, 'Real Estate'],
  [6792, 6792, 'Energy'],
  [6795, 6795, 'Basic Materials'],
  [6798, 6798, 'Real Estate'],
  [6000, 6799, 'Financial Services'],
  // services
  [7000, 7099, 'Consumer Cyclical'],
  [7200, 7299, 'Consumer Cyclical'],
  [7310, 7319, 'Communication Services'],
  [7370, 7379, 'Technology'],
  [7300, 7399, 'Industrials'],
  [7500, 7509, 'Consumer Cyclical'],
  [7510, 7519, 'Industrials'],
  [7520, 7699, 'Consumer Cyclical'],
  [7800, 7899, 'Communication Services'],
  [7900, 7949, 'Communication Services'],
  [7950, 7999, 'Consumer Cyclical'],
  [8000, 8099, 'Healthcare'],
  [8200, 8299, 'Consumer Defensive'],
  [8731, 8731, 'Healthcare'],
  [8100, 8999, 'Industrials'],
];

export function sicToSector(sic) {
  const code = Number(String(sic ?? '').trim());
  if (!Number.isFinite(code) || code <= 0) return null;
  for (const [from, to, sector] of SIC_RANGES) if (code >= from && code <= to) return sector;
  return null;
}

// ---------------------------------------------------------------- shares
// The instantaneous XBRL frames that could still hold a filer's latest cover
// page share count: this quarter's and the few before it. A 10-Q's cover
// date lands a few weeks after quarter end, so the newest frame is thin
// until mid-quarter and the one before carries most names.
export function frameNames(now = new Date(), count = 4) {
  const d = new Date(now);
  let y = d.getUTCFullYear();
  let q = Math.floor(d.getUTCMonth() / 3) + 1;
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(`CY${y}Q${q}I`);
    q--;
    if (q === 0) {
      q = 4;
      y--;
    }
  }
  return out;
}

// One share count per CIK from several frames: the most recently dated wins.
// Frames are as the API returns them ({data: [{cik, val, end}]}) or null for
// one that could not be fetched.
export function latestShares(frames) {
  const out = new Map();
  for (const frame of frames) {
    for (const row of frame?.data || []) {
      const cik = padCik(row.cik);
      const val = Number(row.val);
      if (!Number.isFinite(val) || val <= 0 || !row.end) continue;
      const have = out.get(cik);
      if (!have || row.end > have.end) out.set(cik, { shares: val, end: row.end });
    }
  }
  return out;
}

export const marketCap = (shares, price) =>
  Number.isFinite(shares) && shares > 0 && Number.isFinite(price) && price > 0 ? Math.round(shares * price) : null;

// ---------------------------------------------------------------- chart
const iso = (secs) => new Date(secs * 1000).toISOString().slice(0, 10);

// Everything the builds want from one Yahoo chart result (a year of daily
// bars): price and the three return columns, the 52-week range, average
// volume, and whether the symbol is a fund rather than a company. Pure over
// the parsed response so the arithmetic is testable without the network.
export function chartSnapshot(result, now = Date.now()) {
  const meta = result?.meta || {};
  const ts = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const volumes = quote.volume || [];
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close)) continue;
    bars.push({ date: iso(ts[i]), close, volume: Number.isFinite(volumes[i]) ? volumes[i] : null });
  }
  if (!bars.length) return null;
  const last = bars[bars.length - 1];
  const price = Number.isFinite(meta.regularMarketPrice) ? meta.regularMarketPrice : last.close;
  // The last bar is the live session while the market is open and yesterday
  // once it has closed; the previous close is the last bar dated before the
  // session the price belongs to, whichever of the two that is.
  const marketDate = Number.isFinite(meta.regularMarketTime) ? iso(meta.regularMarketTime) : last.date;
  let prev = null;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].date < marketDate) {
      prev = bars[i];
      break;
    }
  }
  const yearAgo = new Date(now - 365 * 86400 * 1000).toISOString().slice(0, 10);
  const base1y = bars.find((b) => b.date >= yearAgo) || null;
  const jan1 = `${new Date(now).getUTCFullYear()}-01-01`;
  let baseYtd = null;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].date < jan1) {
      baseYtd = bars[i];
      break;
    }
  }
  const pct = (base) => (base && base.close > 0 ? ((price - base.close) / base.close) * 100 : null);
  const recent = bars.slice(-20).map((b) => b.volume).filter((v) => v != null && v > 0);
  const vol = recent.length ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : null;
  const closesOnly = bars.map((b) => b.close);
  const type = String(meta.instrumentType || '').toUpperCase();
  return {
    price,
    asOf: marketDate,
    ret1y: pct(base1y),
    retYtd: pct(baseYtd),
    ret1d: pct(prev),
    lo: Number.isFinite(meta.fiftyTwoWeekLow) ? meta.fiftyTwoWeekLow : Math.min(...closesOnly),
    hi: Number.isFinite(meta.fiftyTwoWeekHigh) ? meta.fiftyTwoWeekHigh : Math.max(...closesOnly),
    vol,
    etf: type === 'ETF' || type === 'MUTUALFUND',
    currency: meta.currency || null,
  };
}

// ---------------------------------------------------------------- fetchers
const yahoo = axios.create({
  timeout: 15000,
  headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
  validateStatus: () => true,
});

// A year and a little of daily bars, so the 1Y base is a real bar and not
// the first one in range. A symbol Yahoo does not know answers 404 and is
// returned as null; a throttle is retried once after a pause.
export async function fetchChart(symbol, { now = Date.now() } = {}) {
  const period2 = Math.floor(now / 1000);
  const period1 = period2 - 400 * 86400;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await yahoo.get(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`, {
      params: { period1, period2, interval: '1d', events: 'div' },
    });
    if (r.status === 200) return chartSnapshot(r.data?.chart?.result?.[0], now);
    if (r.status === 404 || r.status === 400) return null;
    if (attempt === 0) await sleep(r.status === 429 ? 3000 : 800);
  }
  throw new Error(`Yahoo chart ${symbol}: throttled`);
}

// Charts for many symbols with a few in flight. Returns Map symbol → snapshot,
// null for a symbol the provider does not know; a symbol that failed for any
// other reason is absent, so the caller can keep what it had for it. Stops
// early when the first requests all fail: the provider is blocked, and four
// thousand more attempts would only make the log longer.
export async function fetchCharts(symbols, { concurrency = 4, onProgress = null, now = Date.now() } = {}) {
  const out = new Map();
  let i = 0;
  let failed = 0;
  let done = 0;
  let blocked = false;
  const workers = Array.from({ length: Math.min(concurrency, symbols.length) }, async () => {
    while (i < symbols.length && !blocked) {
      const sym = symbols[i++];
      try {
        out.set(sym, await fetchChart(sym, { now }));
      } catch {
        failed++;
        if (failed >= 12 && out.size === 0) blocked = true;
      }
      done++;
      if (onProgress && done % 250 === 0) onProgress(done, symbols.length);
    }
  });
  await Promise.all(workers);
  return { snapshots: out, failed, blocked };
}

// SEC's ticker index: symbol → { cik, name, exchange }. One request.
export async function fetchSecTickers() {
  const { data } = await secGet('https://www.sec.gov/files/company_tickers_exchange.json');
  const fields = data?.fields || [];
  const ix = Object.fromEntries(fields.map((f, i) => [f, i]));
  const byTicker = new Map();
  for (const row of data?.data || []) {
    const ticker = String(row[ix.ticker] || '').toUpperCase();
    if (!ticker || byTicker.has(ticker)) continue;
    byTicker.set(ticker, { cik: padCik(row[ix.cik]), name: row[ix.name] || null, exchange: row[ix.exchange] || null });
  }
  return byTicker;
}

// The SIC code and its sector for one filer, from the submissions feed. A
// fund or trust has no SIC and comes back with sector null.
export async function fetchSector(cik) {
  const { data } = await secGet(`https://data.sec.gov/submissions/CIK${padCik(cik)}.json`);
  const sic = data?.sic ? String(data.sic) : null;
  return { cik: padCik(cik), sic, sicDescription: data?.sicDescription || null, sector: sicToSector(sic), name: data?.name || null };
}

// Shares outstanding for every filer: Map cik → { shares, end }.
export async function fetchSharesOutstanding({ now = new Date() } = {}) {
  const frames = [];
  for (const name of frameNames(now)) {
    try {
      const { data } = await secGet(`https://data.sec.gov/api/xbrl/frames/dei/EntityCommonStockSharesOutstanding/shares/${name}.json`);
      frames.push(data);
    } catch (e) {
      console.warn(`  SEC frame ${name}: ${e.message}`);
      frames.push(null);
    }
  }
  return latestShares(frames);
}

// Sectors for many CIKs, a few in flight, through the EDGAR rate clock.
export async function fetchSectors(ciks, { concurrency = 4 } = {}) {
  const out = new Map();
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, ciks.length) }, async () => {
    while (i < ciks.length) {
      const cik = ciks[i++];
      try {
        out.set(padCik(cik), await fetchSector(cik));
      } catch (e) {
        console.warn(`  SEC submissions ${cik}: ${e.message}`);
      }
    }
  });
  await Promise.all(workers);
  return out;
}
