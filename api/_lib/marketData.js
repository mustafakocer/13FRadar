// Sector, market cap, price and returns for the batch builds, from sources
// that need no key and answer from a GitHub runner.
//
// The builds used to lean on Yahoo, FMP and Stooq for this; none is a source
// any more — Yahoo's and FMP's terms do not cover a paid site, and Stooq sits
// behind a JavaScript challenge. The
// result was a screener whose sector and size filters were empty for months.
//
// What each is used for now:
//   · the committed daily closes (priceStore.js, filled nightly by
//     pricesBuild.js from TwelveData and Finnhub): price, 52-week range and
//     the return columns (seriesSnapshot).
//   · SEC submissions: the SIC code every operating company carries, which
//     folds into the eleven sectors the site filters by.
//   · SEC XBRL frames: shares outstanding for every filer in one request,
//     which times the chart price into a market cap.
// Everything here that does not touch the network is pure and tested.
import { secGet, padCik } from './sec.js';
import { readSeries } from './priceStore.js';


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

// ------------------------------------------------------- price snapshots
// Everything the builds want about a symbol's price — the last close and the
// three return columns, the 52-week range, the closes themselves — computed
// from the committed daily closes (api/_data/prices, priceStore.js), which
// the nightly price build keeps current from the licensed-key providers
// (pricesBuild.js). No request leaves the runner here. Yahoo's chart used to
// answer this; it is out of every chain (its terms do not cover a paid site).
// Volume is not in the store: it stays null rather than borrowed.
export function seriesSnapshot(prices, now = Date.now()) {
  const bars = (prices || []).filter((b) => b?.date && Number.isFinite(b.close) && b.close > 0);
  if (!bars.length) return null;
  const last = bars[bars.length - 1];
  const price = last.close;
  const prev = bars.length > 1 ? bars[bars.length - 2] : null;
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
  const year = bars.filter((b) => b.date >= yearAgo).map((b) => b.close);
  return {
    price,
    asOf: last.date,
    // a year of history, or no 1Y figure (a June listing has none)
    ret1y: base1y && bars[0].date <= new Date(now - 358 * 86400 * 1000).toISOString().slice(0, 10) ? pct(base1y) : null,
    retYtd: pct(baseYtd),
    ret1d: pct(prev),
    lo: year.length ? Math.min(...year) : null,
    hi: year.length ? Math.max(...year) : null,
    vol: null,
    etf: false,
    currency: 'USD',
    // the daily closes themselves, for forward returns after insider buys
    // (insiderOutcome.js); callers that store snapshots pick their fields
    closes: bars.slice(-400).map((b) => ({ date: b.date, close: b.close })),
  };
}

// Snapshots for many symbols from the price store: Map symbol → snapshot,
// null for a symbol with no series on file. Same shape the chart
// fetcher returned, so the builds read it unchanged; `failed` and `blocked`
// stay for them and are always 0 / false.
export function priceSnapshots(symbols, { now = Date.now(), read = readSeries } = {}) {
  const out = new Map();
  for (const sym of symbols) {
    const s = read(sym);
    out.set(sym, s?.prices?.length ? seriesSnapshot(s.prices, now) : null);
  }
  return { snapshots: out, failed: 0, blocked: false };
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
