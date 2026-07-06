import { getHoldings, getSubmissions, list13F } from '../_lib/sec.js';
import { mapCusipsToTickers } from '../_lib/figi.js';

// GET /api/holdings/:cik/:acc?fd=YYYY-MM-DD&light=1
// light=1 skips CUSIP->ticker resolution (used for comparisons/screener).
export default async function handler(req, res) {
  const cik = String(req.query.cik || '').replace(/\D/g, '');
  const acc = String(req.query.acc || '');
  const light = req.query.light === '1';
  const fd = req.query.fd || null;
  if (!cik || !acc) return res.status(400).json({ error: 'Missing cik/acc' });

  try {
    const { aum, positions } = await getHoldings(cik, acc, fd);

    let meta = { filingDate: fd, reportDate: req.query.rd || null };
    if (!meta.filingDate || !meta.reportDate) {
      try {
        const sub = await getSubmissions(cik);
        const f = list13F(sub).find((x) => x.acc === acc);
        if (f) meta = { filingDate: f.filingDate, reportDate: f.reportDate };
      } catch {
        /* non-fatal */
      }
    }

    let tickers = {};
    if (!light) {
      // Resolve tickers for the largest positions only (rate-limit friendly).
      const top = positions.slice(0, 250).map((p) => p.cusip);
      tickers = await mapCusipsToTickers(top);
    }

    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=604800');
    res.status(200).json({
      cik,
      acc,
      ...meta,
      aum,
      count: positions.length,
      positions: positions.map((p) => ({ ...p, ticker: tickers[p.cusip] ?? null })),
    });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
