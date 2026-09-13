import { businessDaysBetween, findClusters, isBuy, isSell, sizeBucket } from './insiderModel.js';

// Public preview of the insider dataset for the landing page (no paywall):
//   pulse     buy/sell split on the newest filing day
//   highlight the single largest open-market buy filed that day
//   signals   cluster buys (≥2 insiders, 7-day window) · C-suite buys · penny-stock buys (last 30 days)
//   penny     the full free board behind /insiders/penny (see buildPennyBoard)
//   rows      the 20 newest buys
// The full, filterable feed stays Pro (/api/insider-feed).
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// "Penny" is the transaction price, not the current quote: it is what the
// insider actually paid and it is present on every Form 4 row, while the
// current quote depends on the optional ticker-meta enrichment.
export const PENNY = { maxPrice: 5, minValue: 10000, windowDays: 30, rows: 50 };
export const isPenny = (r) => r.p > 0 && r.p < PENNY.maxPrice;
// "NONE" is what EDGAR reports for issuers without a listed ticker (private
// funds, debt vehicles) — nothing a reader can act on.
const listed = (r) => r?.t && r.t !== 'NONE' && r?.d;
const round = (x, d = 1) => (x == null ? null : Number(x.toFixed(d)));

function brief(r, companies, meta) {
  const m = (r.t && meta?.[r.t]) || {};
  const ret = m.px != null && r.p ? ((m.px - r.p) / r.p) * 100 : null;
  return {
    t: r.t,
    c: companies[r.t] || null,
    n: r.n,
    r: r.r,
    d: r.d,
    f: r.f,
    v: Math.round(r.v || 0),
    p: r.p,
    ...(ret != null ? { ret: round(ret) } : {}),
  };
}

// A penny row carries everything the free board renders, so /insiders/penny
// needs no API call. Price-derived fields (px/ret/sz/vol/off) come from the
// optional ticker-meta enrichment and are simply omitted when it is empty.
function pennyRow(r, companies, meta, clusters) {
  const m = (r.t && meta?.[r.t]) || {};
  const ret = m.px != null && r.p ? ((m.px - r.p) / r.p) * 100 : null;
  const off = m.px != null && m.lo > 0 ? ((m.px - m.lo) / m.lo) * 100 : null;
  const vol = m.px != null && m.vol > 0 ? m.px * m.vol : null;
  const cl = clusters?.get(r.t);
  return {
    t: r.t,
    c: companies[r.t] || m.name || null,
    n: r.n,
    r: r.r,
    ti: r.ti || null,
    d: r.d,
    f: r.f,
    lag: businessDaysBetween(r.d, r.f),
    s: r.s ?? null,
    p: r.p,
    v: Math.round(r.v || 0),
    o: r.o ?? null,
    oc: round(r.oc),
    side: isSell(r) ? 'sell' : 'buy',
    ...(r.o != null && r.s != null && r.o === r.s ? { nw: true } : {}),
    ...(r.p5 ? { plan: true } : {}),
    ...(m.px != null ? { px: round(m.px, 4) } : {}),
    ...(ret != null ? { ret: round(ret) } : {}),
    ...(off != null ? { off: round(off) } : {}),
    ...(vol != null ? { vol: Math.round(vol) } : {}),
    ...(sizeBucket(m.mcap) ? { sz: sizeBucket(m.mcap) } : {}),
    ...(m.sector ? { sec: m.sector } : {}),
    ...(cl ? { ins: cl.insiders } : {}),
  };
}

// The free board behind /insiders/penny: sub-$5 open-market activity over the
// trailing window, ranked by transaction value. Buys are the "gems"; the sell
// side ships too so the page can show both without a second dataset.
export function buildPennyBoard(rows, companies, meta, lastDay, now = Date.now()) {
  const anchor = lastDay ? new Date(`${lastDay}T00:00:00Z`).getTime() : now;
  const since = iso(anchor - PENNY.windowDays * 86400000);
  // Open-market trades only: grants, tax withholding and gifts say nothing
  // about conviction and would inflate every count on the page.
  const window = rows.filter(
    (r) => isPenny(r) && r.d >= since && (r.v || 0) >= PENNY.minValue && (isBuy(r) || isSell(r))
  );
  const buys = window.filter(isBuy);
  const sells = window.filter(isSell);
  const clusters = findClusters(buys, 7);
  const sum = (list) => list.reduce((s, r) => s + (r.v || 0), 0);
  const buyValue = sum(buys);
  const sellValue = sum(sells);
  const byValue = (a, b) => (b.v || 0) - (a.v || 0);
  const shape = (r) => pennyRow(r, companies, meta, clusters);

  // One row per ticker, so every slot on the board is a different company; the
  // biggest buy takes the slot and the cluster count says there were more.
  const dedupe = (list) => {
    const seen = new Set();
    return list.filter((r) => !seen.has(r.t) && seen.add(r.t));
  };

  // "High conviction" ranks the signal, not the size: several insiders buying
  // beats one, and an executive beats a 10% owner (usually a fund).
  const rank = { cluster: 0, ceo: 1, cfo: 2, director: 3 };
  const signals = dedupe([...buys].sort(byValue))
    .map((r) => {
      const kind = clusters.has(r.t) ? 'cluster' : rank[r.r] != null ? r.r : null;
      return kind ? { ...shape(r), kind } : null;
    })
    .filter(Boolean)
    .sort((a, b) => rank[a.kind] - rank[b.kind] || byValue(a, b))
    .slice(0, 3);

  return {
    since,
    through: lastDay || null,
    maxPrice: PENNY.maxPrice,
    minValue: PENNY.minValue,
    windowDays: PENNY.windowDays,
    stats: {
      companies: new Set(window.map((r) => r.t)).size,
      insiders: new Set(buys.map((r) => r.n)).size,
      buyCount: buys.length,
      sellCount: sells.length,
      buyValue: Math.round(buyValue),
      sellValue: Math.round(sellValue),
      sellShare: buyValue + sellValue > 0 ? round((sellValue / (buyValue + sellValue)) * 100) : null,
      clusterCount: clusters.size,
    },
    signals,
    top: {
      buys: dedupe([...buys].sort(byValue)).slice(0, 3).map(shape),
      sells: dedupe([...sells].sort(byValue)).slice(0, 3).map(shape),
    },
    rows: dedupe([...buys].sort(byValue)).slice(0, PENNY.rows).map(shape),
  };
}

export function buildTeaser(all, companies = {}, meta = {}, now = Date.now()) {
  const rows = all.filter(listed);
  const lastDay = rows.reduce((m, r) => (r.f > m ? r.f : m), '');
  const today = rows.filter((r) => r.f === lastDay);
  const sum = (list) => list.reduce((s, r) => s + (r.v || 0), 0);
  const buyValue = sum(today.filter(isBuy));
  const sellValue = sum(today.filter(isSell));
  const pulse = {
    day: lastDay || null,
    buyCount: today.filter(isBuy).length,
    sellCount: today.filter(isSell).length,
    buyValue: Math.round(buyValue),
    sellValue: Math.round(sellValue),
    sellShare: buyValue + sellValue > 0 ? round((sellValue / (buyValue + sellValue)) * 100) : null,
  };

  // The signal window trails the newest filing day, not the wall clock, so a
  // dataset that is catching up still shows its freshest signals.
  const anchor = lastDay ? new Date(`${lastDay}T00:00:00Z`).getTime() : now;
  const since = iso(anchor - 30 * 86400000);
  const recentBuys = rows.filter((r) => isBuy(r) && r.d >= since);
  const clusters = findClusters(recentBuys, 7);

  const cluster = [...clusters.entries()]
    .map(([t, c]) => {
      const trades = recentBuys.filter((r) => r.t === t);
      const roles = [...new Set(trades.map((r) => r.r).filter((x) => x === 'ceo' || x === 'cfo'))];
      const last = trades.reduce((m, r) => (r.d > m ? r.d : m), '');
      return { t, c: companies[t] || null, insiders: c.insiders, v: Math.round(c.value), roles, from: c.from, to: c.to, last };
    })
    .sort((a, b) => b.insiders - a.insiders || b.v - a.v)
    .slice(0, 8);

  const dedupe = (list) => {
    const seen = new Set();
    return list.filter((r) => !seen.has(r.t) && seen.add(r.t));
  };
  const csuite = dedupe(
    recentBuys
      .filter((r) => r.r === 'ceo' || r.r === 'cfo')
      .sort((a, b) => (b.v || 0) - (a.v || 0))
  )
    .slice(0, 8)
    .map((r) => brief(r, companies, meta));
  const penny = dedupe(
    recentBuys
      .filter((r) => r.p > 0 && r.p < 5 && (r.v || 0) >= 25000)
      .sort((a, b) => (b.v || 0) - (a.v || 0))
  )
    .slice(0, 8)
    .map((r) => brief(r, companies, meta));

  const buys = rows.filter(isBuy).slice().sort((a, b) => (a.f === b.f ? (a.d < b.d ? 1 : -1) : a.f < b.f ? 1 : -1));
  // Highlight: the largest buy by an executive or director on the newest day;
  // 10% owners are usually funds, so they are only a fallback.
  const dayBuys = today.filter(isBuy);
  const pool = dayBuys.length ? dayBuys : buys.slice(0, 50);
  const people = pool.filter((r) => r.r !== 'owner10');
  const pick = (list) => list.reduce((m, r) => ((r.v || 0) > (m.v || 0) ? r : m));
  const highlight = pool.length ? brief(pick(people.length ? people : pool), companies, meta) : null;

  return {
    updatedAt: new Date(now).toISOString(),
    lastDay: lastDay || null,
    total: buys.length,
    pulse,
    highlight,
    signals: { cluster, csuite, penny },
    penny: buildPennyBoard(rows, companies, meta, lastDay, now),
    rows: buys.slice(0, 20).map((r) => brief(r, companies, meta)),
  };
}
