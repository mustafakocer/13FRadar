import { cached, TTL } from '../_lib/cache.js';
import { getSubmissions, list13F, getHoldings } from '../_lib/sec.js';
import { mapLimit } from '../_lib/yahooClient.js';

// Portfolio characteristics over the last 8 quarters (WhaleWisdom-style):
// turnover %, average holding period, new/exited counts.
export default async function handler(req, res) {
  const cik = String(req.query.cik || '').replace(/\D/g, '');
  if (!cik) return res.status(400).json({ error: 'Missing CIK' });

  try {
    const data = await cached(`mstats:${cik}`, TTL.HOUR_6, async () => {
      const sub = await getSubmissions(cik);
      const filings = list13F(sub).slice(0, 8).reverse(); // oldest -> newest
      if (filings.length < 2) return { quarters: filings.length };

      const snaps = (
        await mapLimit(filings, 4, async (f) => {
          const { aum, positions } = await getHoldings(cik, f.acc, f.filingDate);
          return {
            reportDate: f.reportDate,
            aum,
            byCusip: new Map(positions.filter((p) => !p.putCall).map((p) => [p.cusip, p])),
          };
        })
      ).filter(Boolean);

      // per-quarter turnover: (new value + exited value) / avg AUM
      const turnovers = [];
      let lastNew = 0;
      let lastExit = 0;
      for (let i = 1; i < snaps.length; i++) {
        const prev = snaps[i - 1];
        const cur = snaps[i];
        let newVal = 0;
        let newCount = 0;
        let exitVal = 0;
        let exitCount = 0;
        for (const [c, p] of cur.byCusip) {
          if (!prev.byCusip.has(c)) {
            newVal += p.value;
            newCount++;
          }
        }
        for (const [c, p] of prev.byCusip) {
          if (!cur.byCusip.has(c)) {
            exitVal += p.value;
            exitCount++;
          }
        }
        const avgAum = (prev.aum + cur.aum) / 2;
        turnovers.push(avgAum ? ((newVal + exitVal) / avgAum) * 100 : null);
        if (i === snaps.length - 1) {
          lastNew = newCount;
          lastExit = exitCount;
        }
      }
      const tvals = turnovers.filter((x) => x != null);

      // average holding period: consecutive quarters present, over the top 50
      const latest = snaps[snaps.length - 1];
      const top50 = [...latest.byCusip.values()].sort((a, b) => b.value - a.value).slice(0, 50);
      let heldSum = 0;
      for (const p of top50) {
        let held = 1;
        for (let i = snaps.length - 2; i >= 0; i--) {
          if (snaps[i].byCusip.has(p.cusip)) held++;
          else break;
        }
        heldSum += held;
      }

      return {
        quarters: snaps.length,
        turnoverLatest: turnovers[turnovers.length - 1],
        turnoverAvg: tvals.length ? tvals.reduce((s, x) => s + x, 0) / tvals.length : null,
        avgHoldingQuarters: top50.length ? heldSum / top50.length : null,
        newCount: lastNew,
        exitCount: lastExit,
      };
    });
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=604800');
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
