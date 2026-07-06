import { cached, TTL } from '../_lib/cache.js';
import { getSubmissions, numCik } from '../_lib/sec.js';
import { tickerToCik } from '../_lib/tickers.js';

const FORMS = new Set(['SC 13D', 'SC 13D/A', 'SC 13G', 'SC 13G/A', 'SCHEDULE 13D', 'SCHEDULE 13D/A', 'SCHEDULE 13G', 'SCHEDULE 13G/A']);

// GET /api/filings13dg/:ticker — recent activist / large-holder schedules
// (13D = activist intent, 13G = passive >5% stake) filed against the issuer.
export default async function handler(req, res) {
  const ticker = String(req.query.ticker || '').trim().toUpperCase();
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' });

  try {
    const data = await cached(`13dg:${ticker}`, TTL.HOUR_6, async () => {
      const cik = await tickerToCik(ticker);
      if (!cik) return { filings: [] };
      const sub = await getSubmissions(cik);
      const r = sub?.filings?.recent || {};
      const filings = [];
      for (let i = 0; i < (r.form || []).length && filings.length < 15; i++) {
        if (!FORMS.has(String(r.form[i]).toUpperCase())) continue;
        const acc = r.accessionNumber[i];
        filings.push({
          form: r.form[i],
          filingDate: r.filingDate[i],
          acc,
          url: `https://www.sec.gov/Archives/edgar/data/${numCik(cik)}/${acc.replace(/-/g, '')}/`,
        });
      }
      return { cik, filings };
    });
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
