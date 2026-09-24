import { cached, TTL } from '../_lib/cache.js';
import { getSubmissions, list13F, getEffectiveHoldings } from '../_lib/sec.js';
import { mapLimit } from '../_lib/yahooClient.js';
import { dailyCloses } from '../_lib/providers.js';
import { guruHistory } from '../_lib/history.js';
import { aumHistoryFromGuru, annotateAum, attachFlows } from '../_lib/managerHistory.js';

// Quarterly AUM history + estimated net flows.
// Estimated flow = ΔAUM - (previous AUM × SPY quarterly return)
//
// A curated guru answers from the nightly history file; anyone else is read
// from EDGAR, a quarter at a time.

// SPY closes since a date, for flow estimation: the nightly price cache
// (a file read), a live provider only when the cache has nothing, and a
// short leash either way — the benchmark column is decoration next to the
// AUM series, and the page must not wait on a quote provider for it.
function spyLookup(firstDate) {
  const since = new Date(new Date(firstDate).getTime() - 14 * 86400 * 1000).toISOString().slice(0, 10);
  return cached(`spy-closes:${firstDate}`, TTL.HOUR_6, async () => {
    const budget = new Promise((r) => setTimeout(() => r(null), 4000));
    const fetched = dailyCloses('SPY')
      .then((all) => (all ? all.filter((p) => p.date >= since) : null))
      .catch(() => null);
    const prices = await Promise.race([fetched, budget]);
    if (!prices?.length) throw new Error('SPY closes unavailable');
    return (date) => {
      let best = null;
      for (const p of prices) {
        if (p.date <= date) best = p.close;
        else break;
      }
      return best;
    };
  });
}

export default async function handler(req, res) {
  const cik = String(req.query.cik || '').replace(/\D/g, '');
  const limit = Math.min(Number(req.query.limit) || 12, 16);
  if (!cik) return res.status(400).json({ error: 'Missing CIK' });

  try {
    const payload = await cached(`aumhist:${cik}:${limit}`, TTL.HOUR_6, async () => {
      let history = aumHistoryFromGuru(guruHistory(cik), limit);
      if (!history) {
        const sub = await getSubmissions(cik);
        const filings = list13F(sub).slice(0, limit).reverse(); // oldest -> newest
        if (!filings.length) return { history: [] };
        const sums = await mapLimit(filings, 4, async (f) => {
          const { aum, positions, amended } = await getEffectiveHoldings(cik, f);
          return { acc: f.acc, filingDate: f.filingDate, reportDate: f.reportDate, aum, positions: positions.length, ...(amended ? { amended: true } : {}) };
        });
        history = annotateAum(sums.filter(Boolean));
      }
      if (!history.length) return { history: [] };

      let spyAt = null;
      try {
        spyAt = await spyLookup(history[0].reportDate);
      } catch {
        /* flows become null if SPY data unavailable */
      }
      return { history: attachFlows(history, spyAt) };
    });

    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=604800');
    res.status(200).json(payload);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
