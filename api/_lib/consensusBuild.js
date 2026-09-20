import { getSubmissions, list13F, getEffectiveHoldings } from './sec.js';
import { mapLimit } from './yahooClient.js';
import { mapCusipsToTickers } from './figi.js';
import { CONSENSUS_MANAGERS } from './consensusList.js';

// How many holders travel with each security in the per-stock table. Twenty
// five covers every name that matters on the stock page; the tail is funds
// with a rounding-error weight, and keeping it would double the file.
const HOLDERS_PER_STOCK = 25;

// Superinvestor consensus: merge the latest quarter of each curated manager.
// Used by the /api/consensus handler and the daily precompute script.
//
//   stocksTickers: how many CUSIPs from the per-stock table may be resolved
//   live against OpenFIGI. Request-time callers leave it at 0 and take what
//   the static map knows; the daily build raises it (it has a key and time).
export async function build({ stocksTickers = 0 } = {}) {
  // CONSENSUS_CIKS narrows the panel — the offline tests run the whole
  // aggregation over the three filers that have fixtures.
  const only = process.env.CONSENSUS_CIKS ? new Set(process.env.CONSENSUS_CIKS.split(',')) : null;
  // A fund that stopped filing (ceased) is off the panel: its last book is a
  // year or more old and would vote on this quarter's consensus as if it were
  // current. Naming it in CONSENSUS_CIKS still includes it — the fixtures do.
  const panel = only ? CONSENSUS_MANAGERS.filter((m) => only.has(m.cik)) : CONSENSUS_MANAGERS.filter((m) => !m.ceased);
  const per = await mapLimit(panel, 5, async (m) => {
    const sub = await getSubmissions(m.cik);
    const fl = list13F(sub);
    if (!fl.length) return null;
    // effective snapshots: the original with its 13F-HR/A amendments applied,
    // never an amendment standing in for a quarter
    const cur = await getEffectiveHoldings(m.cik, fl[0]);
    let prev = null;
    if (fl[1]) {
      try {
        prev = await getEffectiveHoldings(m.cik, fl[1]);
      } catch {
        /* prev optional */
      }
    }
    return { name: m.name, cik: m.cik, reportDate: fl[0].reportDate, filed: fl[0].filingDate, amended: Boolean(cur.amended), cur, prev };
  });
  const managers = per.filter(Boolean);

  const agg = new Map();
  const newPositions = [];
  // Per-manager quarter-over-quarter story for the landing page cards:
  // new buys, adds, reduces and full exits (top few of each, by weight).
  const updates = [];
  // Per-security roll-up across the curated funds. buyers/sellers count funds
  // that moved either way in the quarter; newBuyers/adders/reducers/exiters
  // break that down the way the stock page reports it.
  const blank = (p) => ({
    cusip: p.cusip,
    issuer: p.issuer,
    totalValue: 0,
    totalShares: 0,
    holders: [],
    buyValue: 0,
    sellValue: 0,
    buyers: 0,
    sellers: 0,
    newBuyers: 0,
    adders: 0,
    reducers: 0,
    exiters: 0,
  });
  // PUT/CALL lines are aggregated separately: a put is a bet against the name,
  // so folding it into the equity roll-up would invert the signal.
  const optionAgg = new Map();

  for (const m of managers) {
    const curEq = m.cur.positions.filter((p) => !p.putCall);
    const prevEq = (m.prev?.positions || []).filter((p) => !p.putCall);
    const prevMap = new Map(prevEq.map((p) => [p.cusip, p]));
    const curSet = new Set(curEq.map((p) => p.cusip));
    const story = { newBuys: [], adds: [], reduces: [], exits: [] };

    for (const p of curEq) {
      const a = agg.get(p.cusip) || blank(p);
      a.totalValue += p.value;
      a.totalShares += p.shares;
      // kept by reference so the branches below can stamp the activity
      const holder = {
        name: m.name,
        cik: m.cik,
        weight: p.weight,
        shares: p.shares,
        value: p.value,
        change: null,
        activity: 'hold',
      };
      a.holders.push(holder);
      if (m.prev) {
        const q = prevMap.get(p.cusip);
        if (!q) {
          a.buyers++;
          a.newBuyers++;
          a.buyValue += p.value;
          holder.activity = 'new';
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
          holder.change = chg;
          if (dSh > 0) {
            a.buyers++;
            a.adders++;
            a.buyValue += dSh * px;
            holder.activity = 'add';
            story.adds.push({ cusip: p.cusip, issuer: p.issuer, weight: p.weight, value: dSh * px, change: chg });
          } else if (dSh < 0) {
            a.sellers++;
            a.reducers++;
            a.sellValue += -dSh * px;
            holder.activity = 'reduce';
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
      a.exiters++;
      a.sellValue += q.value;
      story.exits.push({ cusip: q.cusip, issuer: q.issuer, weight: q.weight, value: q.value });
      agg.set(q.cusip, a);
    }

    // Option lines, keyed by security *and* side so PUT and CALL never merge.
    for (const p of m.cur.positions) {
      if (!p.putCall) continue;
      const key = `${p.cusip}|${p.putCall}`;
      const o = optionAgg.get(key) || {
        cusip: p.cusip,
        issuer: p.issuer,
        putCall: p.putCall,
        totalValue: 0,
        totalShares: 0,
        holders: [],
      };
      o.totalValue += p.value;
      o.totalShares += p.shares;
      o.holders.push({ name: m.name, cik: m.cik, weight: p.weight, value: p.value, shares: p.shares });
      optionAgg.set(key, o);
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
    // conviction of the single most committed holder — the number that says
    // "somebody put a fifth of their book in this", which an average hides
    a.maxWeight = a.holderCount ? Math.max(...a.holders.map((h) => h.weight)) : 0;
    a.netValue = a.buyValue - a.sellValue;
    a.holders.sort((x, y) => y.weight - x.weight);
  }

  // Full per-security table: every name at least one curated fund still holds,
  // ranked by how many of them do. This is what the stock page, the ownership
  // rankings and the stock screener read; the lists below stay as they were.
  const stocks = all
    .filter((a) => a.holderCount > 0)
    .sort((x, y) => y.holderCount - x.holderCount || y.totalValue - x.totalValue)
    .map((a, i) => ({
      cusip: a.cusip,
      issuer: a.issuer,
      rank: i + 1,
      holderCount: a.holderCount,
      totalValue: Math.round(a.totalValue),
      totalShares: a.totalShares,
      avgWeight: Number(a.avgWeight.toFixed(2)),
      maxWeight: Number(a.maxWeight.toFixed(2)),
      buyValue: Math.round(a.buyValue),
      sellValue: Math.round(a.sellValue),
      netValue: Math.round(a.netValue),
      buyers: a.buyers,
      sellers: a.sellers,
      newBuyers: a.newBuyers,
      adders: a.adders,
      reducers: a.reducers,
      exiters: a.exiters,
      holders: a.holders.slice(0, HOLDERS_PER_STOCK).map((h) => ({
        cik: h.cik,
        name: h.name,
        weight: Number(h.weight.toFixed(2)),
        shares: h.shares,
        value: Math.round(h.value),
        change: h.change == null ? null : Number(h.change.toFixed(2)),
        activity: h.activity,
      })),
    }));

  const options = [...optionAgg.values()]
    .sort((x, y) => y.totalValue - x.totalValue)
    .map((o) => ({
      cusip: o.cusip,
      issuer: o.issuer,
      putCall: o.putCall,
      holderCount: o.holders.length,
      totalValue: Math.round(o.totalValue),
      totalShares: o.totalShares,
      holders: o.holders
        .sort((x, y) => y.value - x.value)
        .slice(0, HOLDERS_PER_STOCK)
        .map((h) => ({ cik: h.cik, name: h.name, weight: Number(h.weight.toFixed(2)), value: Math.round(h.value) })),
    }));

  // the legacy lists below have always shown a handful of holders inline
  for (const a of all) a.holders = a.holders.slice(0, 6);

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
  // The per-stock table wants a ticker for everything it can get one for: the
  // stock pages, the screener and the ownership rankings are all keyed on it.
  // Request-time callers pass 0 and ride the static map alone.
  const wide = [...new Set([...stocks.map((s) => s.cusip), ...options.map((o) => o.cusip)])].filter(
    (c) => !(c in tickers)
  );
  Object.assign(tickers, await mapCusipsToTickers(wide, { maxLive: stocksTickers }));
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
    managers: managers.map((m) => ({ name: m.name, cik: m.cik, reportDate: m.reportDate, ...(m.amended ? { amended: true } : {}) })),
    mostHeld: mostHeld.map(dress),
    topBought: topBought.map(dress),
    topSold: topSold.map(dress),
    newPositions: newTop.map(dress),
    updates: updates.map(dressCard),
    stocks: stocks.map(dress),
    options: options.map(dress),
  };
}
