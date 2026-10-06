import { guruHistory, timeHeldLabel } from '../_lib/history.js';
import { resolveQuarters, resolveTimeHeld, findPositionByTicker, tickerOfPosition } from '../_lib/historyResolve.js';
import { readSeries } from '../_lib/priceStore.js';
import { costBasis, gainPct } from '../_lib/costBasis.js';

// GET /api/guru-history/:cik            → quarters + timeHeld + cost per CUSIP (public)
// GET /api/guru-history/:cik/:ticker    → one security's quarter-by-quarter series
// Served from the precomputed api/_data/guru-history.json; 404 for filers
// outside the curated set (their history stays behind /api/position-history).
// Tickers are resolved against the security master on every read
// (_lib/historyResolve.js): a CUSIP the nightly build could not map is
// shown by its issuer name, and picks up its ticker the day the master
// learns it, without waiting for the history to be rebuilt.
//
// `cost` is the estimated average purchase price of every open position
// (_lib/costBasis.js) against the latest close on file — computed on read
// from the stored share counts and the price cache, memoised per process
// because neither changes between deploys.

const costMemo = new Map();

// { [cusip]: { ticker, avgBuy, gainPct, current, asOf, since, openedBeforeData } }
// for the positions held in the latest quarter and priced on file.
export function costTable(cik, g) {
  const key = `${cik}|${g.quarters.at(-1)?.acc || ''}`;
  if (costMemo.has(key)) return costMemo.get(key);
  const out = {};
  for (const [cusip, e] of Object.entries(g.positions || {})) {
    if (!(e.heldQuarters > 0)) continue;
    const ticker = tickerOfPosition(cusip, e);
    const s = ticker ? readSeries(ticker) : null;
    if (!s?.prices?.length) continue;
    const cb = costBasis({ quarters: g.quarters, series: e.series, prices: s.prices });
    if (cb.avgBuy == null) continue;
    const last = s.prices[s.prices.length - 1];
    out[cusip] = {
      ticker,
      avgBuy: cb.avgBuy,
      gainPct: gainPct(cb.avgBuy, last.close),
      current: last.close,
      asOf: last.date,
      since: cb.since,
      ...(cb.openedBeforeData ? { openedBeforeData: true } : {}),
    };
  }
  costMemo.set(key, out);
  return out;
}

export default function handler(req, res) {
  const cik = String(req.query.cik || '').replace(/\D/g, '').padStart(10, '0');
  const g = guruHistory(cik);
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=604800');
  if (!g) return res.status(404).json({ error: 'No precomputed history for this filer' });

  const ticker = String(req.query.ticker || '').trim().toUpperCase();
  if (ticker) {
    const hit = findPositionByTicker(g, ticker);
    if (!hit) return res.status(404).json({ error: 'Security not in this portfolio history' });
    const [cusip, e] = hit;
    const sym = tickerOfPosition(cusip, e);
    const prices = (sym ? readSeries(sym) : null)?.prices || [];
    const cb = costBasis({ quarters: g.quarters, series: e.series, prices });
    const last = prices.length ? prices[prices.length - 1] : null;
    const byDate = new Map(e.series.map((r) => [r[0], r]));
    let prev = null;
    const rows = g.quarters.map((q) => {
      const r = byDate.get(q.reportDate);
      const shares = r ? r[1] : 0;
      let activity = 'none';
      if (r && !prev) activity = 'new';
      else if (r && prev) activity = shares > prev ? 'add' : shares < prev ? 'reduce' : 'hold';
      else if (!r && prev) activity = 'exit';
      const px = cb.byQuarter[q.reportDate] || null;
      const row = {
        reportDate: q.reportDate,
        filed: q.filed,
        shares,
        deltaShares: prev != null || r ? shares - (prev || 0) : null,
        deltaPct: prev ? ((shares - prev) / prev) * 100 : null,
        value: r ? r[2] : 0,
        weight: r ? r[3] : 0,
        activity,
        // the quarter's trading range, the price a change in the count
        // most likely happened at
        avgClose: px?.avg ?? null,
        lo: px?.lo ?? null,
        hi: px?.hi ?? null,
      };
      prev = r ? shares : null;
      return row;
    });
    const dataFrom = e.heldQuarters > 0 && e.heldQuarters >= g.quarters.length ? g.quarters[0].reportDate : null;
    return res.status(200).json({
      cik,
      name: g.name,
      cusip,
      ticker: sym,
      issuer: e.issuer,
      heldQuarters: e.heldQuarters,
      timeHeld: timeHeldLabel(e.heldQuarters, 'en', { dataFrom }),
      firstSeen: e.firstSeen,
      // the streak reaches the first quarter of the data: held at least since
      ...(dataFrom ? { dataFrom } : {}),
      splitAdjusted: Boolean(e.splitAdjusted),
      cost: {
        avgBuy: cb.avgBuy,
        gainPct: last ? gainPct(cb.avgBuy, last.close) : null,
        current: last?.close ?? null,
        asOf: last?.date ?? null,
        lotCost: cb.lotCost,
        since: cb.since,
        openedBeforeData: cb.openedBeforeData,
        unpriced: cb.unpriced,
      },
      rows,
    });
  }

  const { quarters, unresolved } = resolveQuarters(g);
  if (unresolved) console.log(`guru-history ${cik}: ${unresolved} top-10 entries without a ticker (shown by issuer name)`);
  res.status(200).json({ cik, name: g.name, quarters, timeHeld: resolveTimeHeld(g), cost: costTable(cik, g), lookback: g.quarters.length, unresolvedTop10: unresolved });
}
