import { cached, TTL, remember, recall } from '../_lib/cache.js';
import { dailyCloses } from '../_lib/providers.js';

const RANGES = new Set(['1mo', '3mo', '6mo', '1y', '2y', '5y', 'max']);
const RANGE_DAYS = { '1mo': 32, '3mo': 95, '6mo': 187, '1y': 367, '2y': 732, '5y': 1830, max: 36500 };

// GET /api/chart/:ticker?range=1y — daily closes for the price chart, from
// the same series the backtest reads (the nightly cache, then a live
// provider; dailyCloses). The long ranges are thinned to one bar a week so
// the payload stays small. 404 when nothing has ever priced the symbol.
export default async function handler(req, res) {
  const ticker = String(req.query.ticker || '').trim().toUpperCase();
  const range = RANGES.has(req.query.range) ? req.query.range : '1y';
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' });

  try {
    const data = await cached(`chart:${ticker}:${range}`, TTL.HOUR_1, async () => {
      const all = await dailyCloses(ticker);
      if (!all?.length) return null;
      const cutoff = new Date(Date.now() - RANGE_DAYS[range] * 86400 * 1000).toISOString().slice(0, 10);
      let prices = all.filter((p) => p.date >= cutoff);
      if (range === '5y' || range === 'max') {
        const weekly = prices.filter((_, i) => i % 5 === 0);
        if (weekly[weekly.length - 1] !== prices[prices.length - 1]) weekly.push(prices[prices.length - 1]);
        prices = weekly;
      }
      return { symbol: ticker, range, asOf: all[all.length - 1].date, prices };
    });
    if (!data) return res.status(404).json({ error: 'no-price-series' });
    remember(`chart:${ticker}:${range}`, data);
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=7200');
    res.status(200).json(data);
  } catch (err) {
    const stale = recall(`chart:${ticker}:${range}`);
    if (stale) return res.status(200).json({ ...stale, stale: true });
    res.status(502).json({ error: String(err.message || err) });
  }
}
