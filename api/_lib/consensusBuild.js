import { getSubmissions, list13F, getHoldings } from './sec.js';
import { mapLimit } from './yahooClient.js';
import { mapCusipsToTickers } from './figi.js';
import { CONSENSUS_MANAGERS } from './consensusList.js';

// Superinvestor consensus: merge the latest quarter of each curated manager.
// Used by the /api/consensus handler and the daily precompute script.
export async function build() {
  const per = await mapLimit(CONSENSUS_MANAGERS, 5, async (m) => {
    const sub = await getSubmissions(m.cik);
    const fl = list13F(sub);
    if (!fl.length) return null;
    const cur = await getHoldings(m.cik, fl[0].acc, fl[0].filingDate);
    let prev = null;
    if (fl[1]) {
      try {
        prev = await getHoldings(m.cik, fl[1].acc, fl[1].filingDate);
      } catch {
        /* prev optional */
      }
    }
    return { name: m.name, cik: m.cik, reportDate: fl[0].reportDate, filed: fl[0].filingDate, cur, prev };
  });
  const managers = per.filter(Boolean);

  const agg = new Map();
  const newPositions = [];
  // Per-manager quarter-over-quarter story for the landing page cards:
  // new buys, adds, reduces and full exits (top few of each, by weight).
  const updates = [];
  const blank = (p) => ({
    cusip: p.cusip,
    issuer: p.issuer,
    totalValue: 0,
    holders: [],
    buyValue: 0,
    sellValue: 0,
    buyers: 0,
    sellers: 0,
  });

  for (const m of managers) {
    const curEq = m.cur.positions.filter((p) => !p.putCall);
    const prevEq = (m.prev?.positions || []).filter((p) => !p.putCall);
    const prevMap = new Map(prevEq.map((p) => [p.cusip, p]));
    const curSet = new Set(curEq.map((p) => p.cusip));
    const story = { newBuys: [], adds: [], reduces: [], exits: [] };

    for (const p of curEq) {
      const a = agg.get(p.cusip) || blank(p);
      a.totalValue += p.value;
      a.holders.push({ name: m.name, cik: m.cik, weight: p.weight });
      if (m.prev) {
        const q = prevMap.get(p.cusip);
        if (!q) {
          a.buyers++;
          a.buyValue += p.value;
          story.newBuys.push({ cusip: p.cusip, issuer: p.issuer, weight: p.weight, value: p.value });
          newPositions.push({
            manager: m.name,
            cik: m.cik,
            cusip: p.cusip,
            issuer: p.issuer,
            weight: p.weight,
            value: p.value,
            reportDate: m.reportDate,
          });
        } else {
          const dSh = p.shares - q.shares;
          const px = p.shares > 0 ? p.value / p.shares : 0;
          const chg = q.shares > 0 ? (dSh / q.shares) * 100 : null;
          if (dSh > 0) {
            a.buyers++;
            a.buyValue += dSh * px;
            story.adds.push({ cusip: p.cusip, issuer: p.issuer, weight: p.weight, value: dSh * px, change: chg });
          } else if (dSh < 0) {
            a.sellers++;
            a.sellValue += -dSh * px;
            story.reduces.push({ cusip: p.cusip, issuer: p.issuer, weight: p.weight, value: -dSh * px, change: chg });
          }
        }
      }
      agg.set(p.cusip, a);
    }
    // full exits
    for (const q of prevEq) {
      if (curSet.has(q.cusip)) continue;
      const a = agg.get(q.cusip) || blank(q);
      a.sellers++;
      a.sellValue += q.value;
      story.exits.push({ cusip: q.cusip, issuer: q.issuer, weight: q.weight, value: q.value });
      agg.set(q.cusip, a);
    }
    if (m.prev) {
      const byValue = (x, y) => y.value - x.value;
      const top = (list, n = 3) =>
        list
          .sort(byValue)
          .slice(0, n)
          .map((r) => ({
            cusip: r.cusip,
            issuer: r.issuer,
            weight: Number(r.weight.toFixed(2)),
            value: Math.round(r.value),
            ...(r.change != null ? { change: Number(r.change.toFixed(2)) } : {}),
          }));
      updates.push({
        manager: m.name,
        cik: m.cik,
        reportDate: m.reportDate,
        filed: m.filed,
        newBuys: top(story.newBuys),
        adds: top(story.adds),
        reduces: top(story.reduces),
        exits: top(story.exits),
      });
    }
  }

  const all = [...agg.values()];
  for (const a of all) {
    a.holderCount = a.holders.length;
    a.avgWeight = a.holderCount
      ? a.holders.reduce((s, h) => s + h.weight, 0) / a.holderCount
      : 0;
    a.netValue = a.buyValue - a.sellValue;
    a.holders.sort((x, y) => y.weight - x.weight);
    a.holders = a.holders.slice(0, 6);
  }

  const mostHeld = [...all]
    .sort((x, y) => y.holderCount - x.holderCount || y.totalValue - x.totalValue)
    .slice(0, 30);
  const topBought = all.filter((a) => a.netValue > 0).sort((x, y) => y.netValue - x.netValue).slice(0, 20);
  const topSold = all.filter((a) => a.netValue < 0).sort((x, y) => x.netValue - y.netValue).slice(0, 20);
  newPositions.sort((x, y) => y.weight - x.weight);
  const newTop = newPositions.slice(0, 40);

  // newest filing first, so the landing shows what changed most recently
  updates.sort((x, y) => (y.filed || '').localeCompare(x.filed || ''));

  // Tickers: the main lists first (they get the live OpenFIGI budget), then the
  // per-manager cards — most of those resolve from the static CUSIP map.
  const main = [
    ...new Set(
      [...mostHeld, ...topBought, ...topSold].map((a) => a.cusip).concat(newTop.map((n) => n.cusip))
    ),
  ].slice(0, 60);
  const fromCards = updates.flatMap((u) => [...u.newBuys, ...u.adds, ...u.reduces, ...u.exits].map((r) => r.cusip));
  const cusips = [...new Set([...main, ...fromCards])];
  const tickers = await mapCusipsToTickers(cusips);
  const dress = (a) => ({ ...a, ticker: tickers[a.cusip] ?? null });
  const dressCard = (u) => ({
    ...u,
    newBuys: u.newBuys.map(dress),
    adds: u.adds.map(dress),
    reduces: u.reduces.map(dress),
    exits: u.exits.map(dress),
  });

  return {
    updatedAt: new Date().toISOString(),
    managers: managers.map((m) => ({ name: m.name, cik: m.cik, reportDate: m.reportDate })),
    mostHeld: mostHeld.map(dress),
    topBought: topBought.map(dress),
    topSold: topSold.map(dress),
    newPositions: newTop.map(dress),
    updates: updates.map(dressCard),
  };
}
