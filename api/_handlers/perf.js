// GET /api/perf/:ticker — the period-return strip on the stock page:
// 1D · 1W · 1M · 6M · YTD · 1Y · 5Y against the nightly price archive
// (api/_data/prices, split-adjusted provider closes). A period the archive
// cannot cover comes back null and the client prints "—". No live provider
// call: the strip states the archive, like returns.json does.
import { readSeries } from '../_lib/priceStore.js';

const DAY = 86_400_000;

// close on the last trading day at or before `date`, from an already-read
// series (closeOn() in valueUnits.js re-reads the file per call)
function closeAt(prices, date, maxGapDays = 14) {
  if (!prices.length || prices[0].date > date) return null;
  let lo = 0;
  let hi = prices.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (prices[mid].date <= date) lo = mid;
    else hi = mid - 1;
  }
  const hit = prices[lo];
  const gap = (Date.parse(date) - Date.parse(hit.date)) / DAY;
  return gap <= maxGapDays && hit.close > 0 ? hit.close : null;
}

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

export function periodReturns(series) {
  const prices = series?.prices || [];
  const last = prices[prices.length - 1];
  if (!last || !(last.close > 0)) return null;
  const now = Date.parse(last.date);
  const base = {
    d1: prices.length > 1 && prices[prices.length - 2].close > 0 ? prices[prices.length - 2].close : null,
    w1: closeAt(prices, iso(now - 7 * DAY)),
    m1: closeAt(prices, iso(now - 30 * DAY)),
    m6: closeAt(prices, iso(now - 182 * DAY)),
    ytd: closeAt(prices, `${last.date.slice(0, 4) - 1}-12-31`),
    y1: closeAt(prices, iso(now - 365 * DAY)),
    y5: closeAt(prices, iso(now - 5 * 365 * DAY)),
  };
  const out = {};
  for (const [k, b] of Object.entries(base)) {
    out[k] = b ? Number((((last.close - b) / b) * 100).toFixed(2)) : null;
  }
  return { asOf: last.date, price: last.close, periods: out };
}

export default async function handler(req, res) {
  const ticker = String(req.query.ticker || '').trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,10}$/.test(ticker)) return res.status(400).json({ error: 'bad ticker' });
  const series = readSeries(ticker);
  const perf = periodReturns(series);
  if (!perf) return res.status(404).json({ error: 'no-price-series' });
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
  res.status(200).json({ symbol: ticker, ...perf });
}
