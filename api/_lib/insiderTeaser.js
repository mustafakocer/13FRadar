import { findClusters, isBuy, isSell } from './insiderModel.js';

// Public preview of the insider dataset for the landing page (no paywall):
//   pulse     buy/sell split on the newest filing day
//   highlight the single largest open-market buy filed that day
//   signals   cluster buys (≥2 insiders, 7-day window) · C-suite buys · penny-stock buys (last 30 days)
//   rows      the 20 newest buys
// The full, filterable feed stays Pro (/api/insider-feed).
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
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
    rows: buys.slice(0, 20).map((r) => brief(r, companies, meta)),
  };
}
