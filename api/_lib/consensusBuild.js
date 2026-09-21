import { getSubmissions, list13F, getEffectiveHoldings } from './sec.js';
import { mapLimit } from './yahooClient.js';
import { mapCusipsToTickers } from './figi.js';
import { GURUS, consensusPanel, coverage as coverageOf } from './gurus.js';
import { netActivity, storiesByManager } from './netActivity.js';
import { reportDatesByCik } from './guruStatus.js';

// How many holders travel with each security in the per-stock table. Twenty
// five covers every name that matters on the stock page; the tail is funds
// with a rounding-error weight, and keeping it would double the file.
const HOLDERS_PER_STOCK = 25;
// The public teaser of the quarter's activity (landing page): five each way.
const PUBLIC_ACTIVITY = 5;

// Superinvestor consensus: merge the latest quarter of each fund on the
// consensus panel (api/_lib/gurus.js). Used by the /api/consensus handler and
// the daily precompute script.
//
// Every number here comes out of netActivity() — the same function the
// /report pivot uses — so the landing page, the rankings, the stock page and
// the report cannot disagree about a security's net buying.
//
//   stocksTickers: how many CUSIPs from the per-stock table may be resolved
//   live against OpenFIGI. Request-time callers leave it at 0 and take what
//   the static map knows; the daily build raises it (it has a key and time).
export async function build({ stocksTickers = 0 } = {}) {
  // CONSENSUS_CIKS narrows the panel — the offline tests run the whole
  // aggregation over the three filers that have fixtures. Naming a closed
  // fund there still includes it; the registry alone never does.
  const only = process.env.CONSENSUS_CIKS ? new Set(process.env.CONSENSUS_CIKS.split(',')) : null;
  const panel = only ? GURUS.filter((m) => only.has(m.cik)) : consensusPanel();
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

  // the one roll-up
  const rows = netActivity(managers);
  const stories = storiesByManager(rows);

  // PUT/CALL lines are aggregated separately: a put is a bet against the name,
  // so folding it into the equity roll-up would invert the signal.
  const optionAgg = new Map();
  for (const m of managers) {
    for (const p of m.cur.positions) {
      if (!p.putCall) continue;
      const key = `${p.cusip}|${p.putCall}`;
      const o = optionAgg.get(key) || { cusip: p.cusip, issuer: p.issuer, putCall: p.putCall, totalValue: 0, totalShares: 0, holders: [] };
      o.totalValue += p.value;
      o.totalShares += p.shares;
      o.holders.push({ name: m.name, cik: m.cik, weight: p.weight, value: p.value, shares: p.shares });
      optionAgg.set(key, o);
    }
  }

  // Per-manager quarter-over-quarter story for the landing page cards:
  // new buys, adds, reduces and full exits (top few of each, by value).
  const updates = [];
  const newPositions = [];
  const byValue = (x, y) => y.value - x.value;
  const top = (list, n = 3) =>
    [...list]
      .sort(byValue)
      .slice(0, n)
      .map((r) => ({
        cusip: r.cusip,
        issuer: r.issuer,
        weight: Number(r.weight.toFixed(2)),
        value: Math.round(r.value),
        ...(r.change != null ? { change: Number(r.change.toFixed(2)) } : {}),
      }));
  for (const m of managers) {
    if (!m.prev) continue;
    const s = stories.get(m.cik) || { newBuys: [], adds: [], reduces: [], exits: [] };
    for (const r of s.newBuys) newPositions.push({ manager: m.name, cik: m.cik, cusip: r.cusip, issuer: r.issuer, weight: r.weight, value: r.value, reportDate: m.reportDate });
    updates.push({ manager: m.name, cik: m.cik, reportDate: m.reportDate, filed: m.filed, newBuys: top(s.newBuys), adds: top(s.adds), reduces: top(s.reduces), exits: top(s.exits) });
  }

  const all = [...rows.values()];
  const dressRow = (a) => ({
    cusip: a.cusip,
    issuer: a.issuer,
    holderCount: a.holderCount,
    totalValue: Math.round(a.totalValue),
    totalShares: a.totalShares,
    avgWeight: Number(a.avgWeight.toFixed(2)),
    maxWeight: Number(a.maxWeight.toFixed(2)),
    buyValue: Math.round(a.buyValue),
    sellValue: Math.round(a.sellValue),
    netValue: Math.round(a.netValue),
    buyShares: Math.round(a.buyShares),
    sellShares: Math.round(a.sellShares),
    buyers: a.buyers,
    sellers: a.sellers,
    newBuyers: a.newBuyers,
    adders: a.adders,
    reducers: a.reducers,
    exiters: a.exiters,
  });
  const holdersOf = (a, n) =>
    a.holders.slice(0, n).map((h) => ({
      cik: h.cik,
      name: h.name,
      weight: Number(h.weight.toFixed(2)),
      shares: h.shares,
      value: Math.round(h.value),
      change: h.change == null ? null : Number(h.change.toFixed(2)),
      activity: h.activity,
    }));

  // Full per-security table: every name at least one fund still holds,
  // ranked by how many of them do. This is what the stock page, the ownership
  // rankings and the stock screener read.
  const stocks = all
    .filter((a) => a.holderCount > 0)
    .sort((x, y) => y.holderCount - x.holderCount || y.totalValue - x.totalValue)
    .map((a, i) => ({ ...dressRow(a), rank: i + 1, holders: holdersOf(a, HOLDERS_PER_STOCK) }));
  // Names the whole panel walked out of: no holder left, but their selling
  // is part of the quarter and of "most sold" — the report pivot reads them.
  const exited = all
    .filter((a) => a.holderCount === 0 && a.sellValue > 0)
    .sort((x, y) => x.netValue - y.netValue)
    .map((a) => ({ ...dressRow(a), holders: [] }));

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

  // the legacy lists have always shown a handful of holders inline
  const legacy = (a) => ({ ...dressRow(a), holders: holdersOf(a, 6) });
  const mostHeld = [...all]
    .sort((x, y) => y.holderCount - x.holderCount || y.totalValue - x.totalValue)
    .slice(0, 30)
    .map(legacy);
  const topBought = all.filter((a) => a.netValue > 0).sort((x, y) => y.netValue - x.netValue).slice(0, 20).map(legacy);
  const topSold = all.filter((a) => a.netValue < 0).sort((x, y) => x.netValue - y.netValue).slice(0, 20).map(legacy);
  newPositions.sort((x, y) => y.weight - x.weight);
  const newTop = newPositions.slice(0, 40).map((n) => ({ ...n, weight: Number(n.weight.toFixed(2)), value: Math.round(n.value) }));

  // newest filing first, so the landing shows what changed most recently
  updates.sort((x, y) => (y.filed || '').localeCompare(x.filed || ''));

  // Tickers: the main lists first (they get the live OpenFIGI budget), then the
  // per-manager cards — most of those resolve from the static CUSIP map.
  const main = [
    ...new Set([...mostHeld, ...topBought, ...topSold].map((a) => a.cusip).concat(newTop.map((n) => n.cusip))),
  ].slice(0, 60);
  const fromCards = updates.flatMap((u) => [...u.newBuys, ...u.adds, ...u.reduces, ...u.exits].map((r) => r.cusip));
  const cusips = [...new Set([...main, ...fromCards])];
  const tickers = await mapCusipsToTickers(cusips);
  // The per-stock table wants a ticker for everything it can get one for: the
  // stock pages, the screener and the ownership rankings are all keyed on it.
  // Request-time callers pass 0 and ride the static map alone.
  const wide = [...new Set([...stocks, ...exited, ...options].map((s) => s.cusip))].filter((c) => !(c in tickers));
  Object.assign(tickers, await mapCusipsToTickers(wide, { maxLive: stocksTickers }));
  const dress = (a) => ({ ...a, ticker: tickers[a.cusip] ?? null });
  const dressCard = (u) => ({ ...u, newBuys: u.newBuys.map(dress), adds: u.adds.map(dress), reduces: u.reduces.map(dress), exits: u.exits.map(dress) });

  // The quarter the panel reports on, and how the tracked bench maps onto
  // it: tracked → filed for it → counted. The same object ships in every
  // file so every page explains the same numbers the same way.
  const quarter = managers.reduce((m, x) => (x.reportDate > m ? x.reportDate : m), '');
  const cov = coverageOf(quarter, reportDatesByCik(managers));
  if (only) Object.assign(cov, { tracked: managers.length, filed: managers.filter((m) => m.reportDate === quarter).length, included: managers.filter((m) => m.reportDate === quarter).length, excluded: {} });

  return {
    updatedAt: new Date().toISOString(),
    quarter,
    coverage: cov,
    managers: managers.map((m) => ({ name: m.name, cik: m.cik, reportDate: m.reportDate, ...(m.amended ? { amended: true } : {}) })),
    mostHeld: mostHeld.map(dress),
    topBought: topBought.map(dress),
    topSold: topSold.map(dress),
    // the public teaser: the same rows as the rankings, five each way
    activity: { buys: topBought.slice(0, PUBLIC_ACTIVITY).map(dress), sells: topSold.slice(0, PUBLIC_ACTIVITY).map(dress) },
    newPositions: newTop.map(dress),
    updates: updates.map(dressCard),
    stocks: stocks.map(dress),
    exited: exited.map(dress),
    options: options.map(dress),
  };
}
