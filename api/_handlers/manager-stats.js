import { cached, TTL } from '../_lib/cache.js';
import { getSubmissions, list13F, getEffectiveHoldings } from '../_lib/sec.js';
import { mapLimit } from '../_lib/yahooClient.js';
import { guruHistory } from '../_lib/history.js';
import { managerStatsFromGuru } from '../_lib/managerHistory.js';
import { turnover as turnoverOf, heldQuarters } from '../_lib/turnover.js';

// Portfolio characteristics over the last 8 quarters (WhaleWisdom-style):
// turnover %, average holding period, new/exited counts. Turnover is the
// definition in _lib/turnover.js; the quarters are effective snapshots.
//
// A curated guru answers from the nightly history file; anyone else is read
// from EDGAR, eight quarters of info tables at a time.
export default async function handler(req, res) {
  const cik = String(req.query.cik || '').replace(/\D/g, '');
  if (!cik) return res.status(400).json({ error: 'Missing CIK' });

  try {
    const data = await cached(`mstats:${cik}`, TTL.HOUR_6, async () => {
      const guru = guruHistory(cik);
      if (guru) return managerStatsFromGuru(guru);
      const sub = await getSubmissions(cik);
      const filings = list13F(sub).slice(0, 8).reverse(); // oldest -> newest
      if (filings.length < 2) return { quarters: filings.length };

      const snaps = (
        await mapLimit(filings, 4, async (f) => {
          const { aum, positions } = await getEffectiveHoldings(cik, f);
          const equity = positions.filter((p) => !p.putCall);
          return { reportDate: f.reportDate, aum, positions: equity, held: new Set(equity.map((p) => p.cusip)) };
        })
      ).filter(Boolean);

      const turnovers = [];
      let last = null;
      for (let i = 1; i < snaps.length; i++) {
        last = turnoverOf(snaps[i - 1], snaps[i]);
        turnovers.push(last.turnover);
      }
      const tvals = turnovers.filter((x) => x != null);

      // average holding period: consecutive quarters present, over the top 50
      const latest = snaps[snaps.length - 1];
      const sets = snaps.map((s) => s.held);
      const top50 = [...latest.positions].sort((a, b) => b.value - a.value).slice(0, 50);
      const heldSum = top50.reduce((s, p) => s + heldQuarters(sets, p.cusip), 0);

      return {
        quarters: snaps.length,
        turnoverLatest: turnovers[turnovers.length - 1] ?? null,
        turnoverAvg: tvals.length ? tvals.reduce((s, x) => s + x, 0) / tvals.length : null,
        avgHoldingQuarters: top50.length ? heldSum / top50.length : null,
        newCount: last?.newCount ?? 0,
        exitCount: last?.exitCount ?? 0,
      };
    });
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=604800');
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
