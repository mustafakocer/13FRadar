import { cached, TTL } from '../_lib/cache.js';
import { getSubmissions, list13F, getFilingHoldings } from '../_lib/sec.js';
import { mapLimit } from '../_lib/yahooClient.js';
import { requirePro } from '../_lib/auth.js';
import { splitFactor } from '../_lib/positionDiff.js';

// GET /api/holdings-history/:cik?top=150   (Pro)
// For the manager's largest current equity positions: weight / shares history
// over the last 8 quarters plus an ESTIMATED average buy price.
//
// Average buy price: walk quarters oldest -> newest; every share-count increase
// is a purchase at that quarter-end price (value / shares); decreases sell at
// the running average cost (cost basis unchanged). Splits (share ratio ≈ inverse
// price ratio) rescale the lot instead of counting as a trade. The window is
// limited to what we load, so a position older than 8 quarters starts at its
// first in-window price — hence "estimated".
const QUARTERS = 8;

export function estimateAvgBuy(series) {
  // series: [{shares, value}] oldest -> newest, null where not held
  let lotShares = 0;
  let lotCost = 0;
  let prevShares = 0;
  /** @type {{shares:number, value:number} | null} */
  let prevSnap = null;
  for (const cur of series) {
    if (!cur || !cur.shares || !cur.value) {
      lotShares = 0;
      lotCost = 0;
      prevShares = 0;
      prevSnap = null;
      continue;
    }
    const px = cur.value / cur.shares;
    const f = prevSnap ? splitFactor(prevSnap, cur) : 1;
    if (f !== 1) {
      prevShares *= f;
      lotShares *= f;
    }
    const d = cur.shares - prevShares;
    if (d > prevShares * 0.005) {
      lotCost += d * px;
      lotShares += d;
    } else if (d < -prevShares * 0.005) {
      const avg = lotShares > 0 ? lotCost / lotShares : px;
      lotShares = Math.max(0, lotShares + d);
      lotCost = lotShares * avg;
    }
    prevShares = cur.shares;
    prevSnap = cur;
  }
  return lotShares > 0 ? lotCost / lotShares : null;
}

export default async function handler(req, res) {
  if (!(await requirePro(req, res))) return;
  const cik = String(req.query.cik || '').replace(/\D/g, '');
  const top = Math.min(Math.max(Number(req.query.top) || 150, 10), 300);
  if (!cik) return res.status(400).json({ error: 'Missing CIK' });

  try {
    const payload = await cached(`holdhist:${cik}:${top}`, TTL.HOUR_6, async () => {
      const sub = await getSubmissions(cik);
      const filings = list13F(sub).slice(0, QUARTERS).reverse(); // oldest -> newest
      if (!filings.length) return { quarters: [], items: [] };

      const snaps = await mapLimit(filings, 4, async (f) => {
        const { positions } = await getFilingHoldings(cik, f);
        return {
          reportDate: f.reportDate,
          byCusip: new Map(positions.filter((p) => !p.putCall).map((p) => [p.cusip, p])),
        };
      });

      const latest = snaps[snaps.length - 1];
      const cusips = [...latest.byCusip.values()]
        .sort((a, b) => b.value - a.value)
        .slice(0, top)
        .map((p) => p.cusip);

      const items = cusips.map((cusip) => {
        const series = snaps.map((s) => s.byCusip.get(cusip) || null);
        let held = 0;
        for (let i = series.length - 1; i >= 0 && series[i]; i--) held++;
        const cur = series[series.length - 1];
        return {
          cusip,
          weights: series.map((p) => (p ? +p.weight.toFixed(3) : null)),
          shares: series.map((p) => (p ? p.shares : null)),
          avgBuy: estimateAvgBuy(series),
          lastPx: cur && cur.shares ? cur.value / cur.shares : null,
          quartersHeld: held,
          sinceStart: !!series[0], // held at the oldest quarter we loaded (window-limited)
        };
      });

      return { quarters: snaps.map((s) => s.reportDate), items };
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).json(payload);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
