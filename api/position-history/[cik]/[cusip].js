import { cached, TTL } from '../../_lib/cache.js';
import { getSubmissions, list13F, getHoldings } from '../../_lib/sec.js';
import { mapLimit } from '../../_lib/yahooClient.js';

// GET /api/position-history/:cik/:cusip
// Weight/value/shares of one security across the manager's recent quarters.
// Holdings are cached long-term (and warmed by aum-history), so this is cheap.
export default async function handler(req, res) {
  const cik = String(req.query.cik || '').replace(/\D/g, '');
  const cusip = String(req.query.cusip || '').toUpperCase().trim();
  if (!cik || !cusip) return res.status(400).json({ error: 'Missing cik/cusip' });

  try {
    const payload = await cached(`poshist:${cik}:${cusip}`, TTL.HOUR_6, async () => {
      const sub = await getSubmissions(cik);
      const filings = list13F(sub).slice(0, 8).reverse(); // oldest -> newest
      const rows = await mapLimit(filings, 4, async (f) => {
        const { positions } = await getHoldings(cik, f.acc, f.filingDate);
        const match = positions.filter((p) => p.cusip === cusip);
        return {
          reportDate: f.reportDate,
          weight: match.reduce((s, p) => s + p.weight, 0),
          value: match.reduce((s, p) => s + p.value, 0),
          shares: match.reduce((s, p) => s + p.shares, 0),
        };
      });
      return { cusip, history: rows.filter(Boolean) };
    });
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=604800');
    res.status(200).json(payload);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
