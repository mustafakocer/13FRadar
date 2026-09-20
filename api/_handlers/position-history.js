import { cached, TTL } from '../_lib/cache.js';
import { getSubmissions, list13F, getEffectiveHoldings } from '../_lib/sec.js';
import { mapLimit } from '../_lib/yahooClient.js';
import { requirePro } from '../_lib/auth.js';
import { mapCusipsToTickers } from '../_lib/figi.js';
import { splitAdjust } from '../_lib/history.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Split table built nightly alongside the guru history.
function splitsFor(ticker) {
  if (!ticker) return [];
  try {
    return require('../_data/splits.json')?.byTicker?.[ticker] || [];
  } catch {
    return [];
  }
}

// GET /api/position-history/:cik/:cusip
// Weight/value/shares of one security across the manager's recent quarters.
// Holdings are cached long-term (and warmed by aum-history), so this is cheap.
export default async function handler(req, res) {
  if (!(await requirePro(req, res))) return;
  const cik = String(req.query.cik || '').replace(/\D/g, '');
  const cusip = String(req.query.cusip || '').toUpperCase().trim();
  if (!cik || !cusip) return res.status(400).json({ error: 'Missing cik/cusip' });

  try {
    const payload = await cached(`poshist:${cik}:${cusip}`, TTL.HOUR_6, async () => {
      const sub = await getSubmissions(cik);
      const filings = list13F(sub).slice(0, 8).reverse(); // oldest -> newest
      // A share count is only comparable across quarters once splits are taken
      // out of it: a 4-for-1 turns a flat position into an apparent 300% add.
      // Both numbers ship — as filed, and restated to today's share — because
      // one matches the SEC document and the other matches the chart.
      const ticker = (await mapCusipsToTickers([cusip], { maxLive: 0 }))[cusip] || null;
      const splits = splitsFor(ticker);
      const rows = await mapLimit(filings, 4, async (f) => {
        const { positions } = await getEffectiveHoldings(cik, f);
        const match = positions.filter((p) => p.cusip === cusip);
        const shares = match.reduce((s, p) => s + p.shares, 0);
        return {
          reportDate: f.reportDate,
          weight: match.reduce((s, p) => s + p.weight, 0),
          value: match.reduce((s, p) => s + p.value, 0),
          shares,
          sharesAdj: splits.length ? Math.round(splitAdjust(shares, f.reportDate, splits)) : shares,
        };
      });
      return { cusip, ticker, splitAdjusted: splits.length > 0, history: rows.filter(Boolean) };
    });
    res.status(200).json(payload);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
