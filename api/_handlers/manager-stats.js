import { cached, TTL } from '../_lib/cache.js';
import { getSubmissions, list13F, getFilingHoldings } from '../_lib/sec.js';
import { mapLimit } from '../_lib/yahooClient.js';
import { splitFactor } from '../_lib/positionDiff.js';

// Trading activity over the last 8 quarters, derived from share-count changes
// so that price moves do not masquerade as trades:
//   bought $ = Σ max(Δshares, 0) × quarter-end price   (new positions: full value)
//   sold $   = Σ max(-Δshares, 0) × prior quarter-end price (exits: prior value)
//   activity % = (bought + sold) / average AUM
// Stock splits are neutralised via positionDiff.splitFactor.
const EQUITY = (p) => !p.putCall;

export function quarterTrades(prev, cur) {
  let bought = 0;
  let sold = 0;
  let newCount = 0;
  let exitCount = 0;
  let addCount = 0;
  let trimCount = 0;

  for (const [c, p] of cur.byCusip) {
    const q = prev.byCusip.get(c);
    if (!q) {
      bought += p.value;
      newCount++;
      continue;
    }
    if (!p.shares || !q.shares) {
      // no share data: fall back to value delta
      const d = p.value - q.value;
      if (d > 0) { bought += d; addCount++; }
      else if (d < 0) { sold += -d; trimCount++; }
      continue;
    }
    const pxCur = p.value / p.shares;
    const pxPrev = q.value / q.shares;
    const prevShares = q.shares * splitFactor(q, p); // split-adjusted, not a trade
    const d = p.shares - prevShares;
    // ignore rounding noise below 0.5% of the position
    if (Math.abs(d) <= prevShares * 0.005) continue;
    if (d > 0) { bought += d * pxCur; addCount++; }
    else { sold += -d * pxPrev; trimCount++; }
  }
  for (const [c, q] of prev.byCusip) {
    if (!cur.byCusip.has(c)) {
      sold += q.value;
      exitCount++;
    }
  }
  const avgAum = (prev.aum + cur.aum) / 2;
  return {
    reportDate: cur.reportDate,
    bought,
    sold,
    net: bought - sold,
    activity: avgAum ? ((bought + sold) / avgAum) * 100 : null,
    newCount,
    exitCount,
    addCount,
    trimCount,
  };
}

export default async function handler(req, res) {
  const cik = String(req.query.cik || '').replace(/\D/g, '');
  if (!cik) return res.status(400).json({ error: 'Missing CIK' });

  try {
    const data = await cached(`mstats2:${cik}`, TTL.HOUR_6, async () => {
      const sub = await getSubmissions(cik);
      const filings = list13F(sub).slice(0, 9).reverse(); // oldest -> newest
      if (filings.length < 2) return { quarters: filings.length };

      const snaps = (
        await mapLimit(filings, 4, async (f) => {
          const { aum, positions } = await getFilingHoldings(cik, f);
          return {
            reportDate: f.reportDate,
            aum,
            byCusip: new Map(positions.filter(EQUITY).map((p) => [p.cusip, p])),
          };
        })
      ).filter(Boolean);

      const quarters = [];
      for (let i = 1; i < snaps.length; i++) {
        quarters.push(quarterTrades(snaps[i - 1], snaps[i]));
      }
      const acts = quarters.map((q) => q.activity).filter((x) => x != null);
      const latest = quarters[quarters.length - 1];

      return {
        quarters: snaps.length,
        latest,
        activityAvg: acts.length ? acts.reduce((s, x) => s + x, 0) / acts.length : null,
        history: quarters,
      };
    });
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=604800');
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
