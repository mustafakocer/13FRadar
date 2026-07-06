import { cached, TTL } from '../_lib/cache.js';
import { yahooChart } from '../_lib/yahooClient.js';

const RANGES = new Set(['1mo', '3mo', '6mo', '1y', '2y', '5y', 'max']);

// GET /api/chart/:ticker?range=1y — daily closes for the price chart.
export default async function handler(req, res) {
  const ticker = String(req.query.ticker || '').trim().toUpperCase();
  const range = RANGES.has(req.query.range) ? req.query.range : '1y';
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' });

  try {
    const data = await cached(`chart:${ticker}:${range}`, TTL.HOUR_1, async () => {
      const result = await yahooChart(ticker, {
        range,
        interval: range === '5y' || range === 'max' ? '1wk' : '1d',
      });
      const ts = result.timestamp || [];
      const closes = result.indicators?.quote?.[0]?.close || [];
      const prices = [];
      for (let i = 0; i < ts.length; i++) {
        if (closes[i] == null) continue;
        prices.push({
          date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
          close: Number(closes[i].toFixed(4)),
        });
      }
      return { symbol: ticker, range, prices };
    });
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=7200');
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
