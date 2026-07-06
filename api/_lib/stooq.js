import axios from 'axios';
import { cached, TTL } from './cache.js';

// Stooq serves free daily OHLC CSV without auth and doesn't block datacenter
// IPs — used as the fallback when Yahoo rate-limits the serverless region.
const http = axios.create({
  timeout: 15000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; 13FRadar/1.0)' },
});

export function stooqDaily(symbol) {
  const sym = symbol.toLowerCase().replace(/\./g, '-') + '.us';
  return cached(`stooq:${sym}`, TTL.HOUR_1, async () => {
    const { data } = await http.get(`https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`, {
      responseType: 'text',
      transformResponse: [(d) => d],
    });
    if (typeof data !== 'string' || !data.startsWith('Date')) {
      throw new Error('Stooq data unavailable');
    }
    const prices = [];
    for (const line of data.split('\n').slice(1)) {
      const cols = line.trim().split(',');
      if (cols.length < 5) continue;
      const close = Number(cols[4]);
      if (cols[0] && Number.isFinite(close)) prices.push({ date: cols[0], close });
    }
    if (!prices.length) throw new Error('Stooq returned no rows');
    return prices;
  });
}

// {price, ret1y, retYtd, ret1d} from a [{date, close}] series (ascending).
export function returnsFromSeries(symbol, prices) {
  if (!prices?.length) return { symbol, price: null, ret1y: null, retYtd: null, ret1d: null };
  const last = prices[prices.length - 1];
  const price = last.close;

  const yearAgo = new Date(Date.now() - 365 * 86400 * 1000).toISOString().slice(0, 10);
  const base1y = prices.find((p) => p.date >= yearAgo) || prices[0];

  const jan1 = `${new Date().getUTCFullYear()}-01-01`;
  const prevYear = prices.filter((p) => p.date < jan1);
  const baseYtd = prevYear.length ? prevYear[prevYear.length - 1] : null;

  const prevClose = prices.length > 1 ? prices[prices.length - 2].close : null;

  return {
    symbol,
    price,
    ret1y: base1y?.close ? ((price - base1y.close) / base1y.close) * 100 : null,
    retYtd: baseYtd?.close ? ((price - baseYtd.close) / baseYtd.close) * 100 : null,
    ret1d: prevClose ? ((price - prevClose) / prevClose) * 100 : null,
  };
}
