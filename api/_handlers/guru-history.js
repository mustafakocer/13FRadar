import { guruHistory, timeHeldLabel } from '../_lib/history.js';

// GET /api/guru-history/:cik            → quarters + timeHeld per CUSIP (public)
// GET /api/guru-history/:cik/:ticker    → one security's quarter-by-quarter series
// Served from the precomputed api/_data/guru-history.json; 404 for filers
// outside the curated set (their history stays behind /api/position-history).
export default function handler(req, res) {
  const cik = String(req.query.cik || '').replace(/\D/g, '').padStart(10, '0');
  const g = guruHistory(cik);
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=604800');
  if (!g) return res.status(404).json({ error: 'No precomputed history for this filer' });

  const ticker = String(req.query.ticker || '').trim().toUpperCase();
  if (ticker) {
    const hit = Object.entries(g.positions).find(([, e]) => e.ticker === ticker);
    if (!hit) return res.status(404).json({ error: 'Security not in this portfolio history' });
    const [cusip, e] = hit;
    const byDate = new Map(e.series.map((r) => [r[0], r]));
    let prev = null;
    const rows = g.quarters.map((q) => {
      const r = byDate.get(q.reportDate);
      const shares = r ? r[1] : 0;
      let activity = 'none';
      if (r && !prev) activity = 'new';
      else if (r && prev) activity = shares > prev ? 'add' : shares < prev ? 'reduce' : 'hold';
      else if (!r && prev) activity = 'exit';
      const row = {
        reportDate: q.reportDate,
        filed: q.filed,
        shares,
        deltaShares: prev != null || r ? shares - (prev || 0) : null,
        deltaPct: prev ? ((shares - prev) / prev) * 100 : null,
        value: r ? r[2] : 0,
        weight: r ? r[3] : 0,
        activity,
      };
      prev = r ? shares : null;
      return row;
    });
    return res.status(200).json({
      cik,
      name: g.name,
      cusip,
      ticker: e.ticker,
      issuer: e.issuer,
      heldQuarters: e.heldQuarters,
      timeHeld: timeHeldLabel(e.heldQuarters),
      firstSeen: e.firstSeen,
      splitAdjusted: Boolean(e.splitAdjusted),
      rows,
    });
  }

  const timeHeld = {};
  for (const [cusip, e] of Object.entries(g.positions)) {
    if (e.heldQuarters > 0) timeHeld[cusip] = { quarters: e.heldQuarters, ticker: e.ticker, firstSeen: e.firstSeen };
  }
  res.status(200).json({ cik, name: g.name, quarters: g.quarters, timeHeld, lookback: g.quarters.length });
}
