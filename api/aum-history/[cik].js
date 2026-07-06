import { cached, TTL } from '../_lib/cache.js';
import { getSubmissions, list13F, getHoldings } from '../_lib/sec.js';
import { yahooChartPrices, mapLimit } from '../_lib/yahooClient.js';
import { stooqDaily } from '../_lib/stooq.js';

// Quarterly AUM history + estimated net flows.
// Estimated flow = ΔAUM - (previous AUM × SPY quarterly return)
export default async function handler(req, res) {
  const cik = String(req.query.cik || '').replace(/\D/g, '');
  const limit = Math.min(Number(req.query.limit) || 12, 16);
  if (!cik) return res.status(400).json({ error: 'Missing CIK' });

  try {
    const payload = await cached(`aumhist:${cik}:${limit}`, TTL.HOUR_6, async () => {
      const sub = await getSubmissions(cik);
      const filings = list13F(sub).slice(0, limit).reverse(); // oldest -> newest
      if (!filings.length) return { history: [] };

      const sums = await mapLimit(filings, 4, async (f) => {
        const { aum, positions } = await getHoldings(cik, f.acc, f.filingDate);
        return { ...f, aum, positions: positions.length };
      });
      const history = sums.filter(Boolean);

      // SPY closes covering the whole period, for flow estimation
      let spyAt = () => null;
      try {
        const first = new Date(history[0].reportDate).getTime() / 1000 - 14 * 86400;
        const firstDate = new Date(first * 1000).toISOString().slice(0, 10);
        const { prices } = await yahooChartPrices('SPY', first, Date.now() / 1000).catch(() =>
          stooqDaily('SPY').then((all) => ({ prices: all.filter((p) => p.date >= firstDate) }))
        );
        spyAt = (date) => {
          let best = null;
          for (const p of prices) {
            if (p.date <= date) best = p.close;
            else break;
          }
          return best;
        };
      } catch {
        /* flows become null if SPY data unavailable */
      }

      for (let i = 0; i < history.length; i++) {
        const cur = history[i];
        const prev = history[i - 1];
        cur.qoq = prev?.aum ? ((cur.aum - prev.aum) / prev.aum) * 100 : null;
        const yearAgo = history.find(
          (h) => h.reportDate.slice(0, 4) == cur.reportDate.slice(0, 4) - 1 &&
                 h.reportDate.slice(5, 7) === cur.reportDate.slice(5, 7)
        );
        cur.yoy = yearAgo?.aum ? ((cur.aum - yearAgo.aum) / yearAgo.aum) * 100 : null;
        if (prev) {
          const s0 = spyAt(prev.reportDate);
          const s1 = spyAt(cur.reportDate);
          cur.spyRet = s0 && s1 ? ((s1 - s0) / s0) * 100 : null;
          cur.estFlow =
            s0 && s1 ? cur.aum - prev.aum * (1 + (s1 - s0) / s0) : null;
        } else {
          cur.spyRet = null;
          cur.estFlow = null;
        }
      }
      return { history };
    });

    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=604800');
    res.status(200).json(payload);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
