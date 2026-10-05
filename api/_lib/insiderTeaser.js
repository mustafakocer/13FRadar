import { businessDaysBetween, daySummary, isBuy, isListed, isSell, sizeBucket } from './insiderModel.js';
import { buildClusters } from './insiderCluster.js';
import { categorize, classify } from './insiderClassify.js';
import { filingTotals, signalLevel } from './insiderSignal.js';
import { sinceTrade } from './splitAdjust.js';
import { priceCheck } from './insiderPriceCheck.js';

// Return since the trade, only when the form's price can be compared with
// today's (insiderPriceCheck.js). `opts` carries the raw Form 4 fields
// ({ [accession:line]: {...} }) and a daily-close lookup, when the caller has
// them; without them only the build's flag and the 2× fallback apply.
function retFor(r, meta, opts = {}) {
  const px = (r.t && meta?.[r.t]?.px) ?? null;
  const chk = priceCheck(r, { raw: opts.raw?.[`${r.a}:${r.li}`], series: r.t && opts.seriesFor ? opts.seriesFor(r.t) : null, current: px });
  return chk.ok ? sinceTrade(r, px) : null;
}

// An open-market purchase with a real price (insiderClassify.js). The C-suite
// and penny lists, the highlight and the newest-buys list use this; the
// cluster detector keeps its own input (roadmap item 3).
const openBuy = (r) => categorize(r) === 'open_buy';
// …with a verified dollar amount: a foreign-currency line that could not be
// converted (fpiNormalize.js) never takes a ranked slot
const ranked = (r) => openBuy(r) && !r.fx?.fail && r.fx?.off == null;

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
// Superseded 4/A originals (`sb`) never count.
const listed = (r) => isListed(r) && !r.sb;
const round = (x, d = 1) => (x == null ? null : Number(x.toFixed(d)));

function brief(r, companies, meta, opts) {
  const m = (r.t && meta?.[r.t]) || {};
  const ret = retFor(r, meta, opts);
  return {
    t: r.t,
    c: companies[r.t] || null,
    n: r.n,
    r: r.r,
    d: r.d,
    f: r.f,
    v: r.fx?.fail ? null : Math.round(r.v || 0),
    p: r.p,
    ...fxBrief(r),
    ...(ret != null ? { ret: round(ret) } : {}),
  };
}

// A foreign issuer's line (fpiNormalize.js): the currency it was filed in
// and the ADR ratio used, or — not convertible — the amount in its own
// currency (the page writes "MXN 6.93M · USD karşılığı doğrulanamadı").
export function fxBrief(r) {
  if (r?.fx?.fail) return { fx: { cu: r.fx.cu || null, lv: r.fx.lv, lp: r.fx.lp } };
  if (r?.fx?.off != null) return { fx: { off: r.fx.off } };
  if (r?.fx?.ok && (r.fx.cu !== 'USD' || r.fx.ar !== 1)) return { fx: { cu: r.fx.cu, ar: r.fx.ar, lp: r.fx.lp } };
  return {};
}

// Clusters on the home page and /insiders/cluster (the same list).
export const CLUSTER_ROWS = 20;
const rawOfOpts = (opts) => (opts?.raw ? (r) => opts.raw[`${r.a}:${r.li}`] || null : undefined);
// v / insiders / roles / from / to / last as before, plus the strength facts
// and the people behind it (the detail view)
export function clusterBrief(c, companies = {}) {
  return {
    t: c.t,
    c: companies[c.t] || null,
    insiders: c.insiders,
    v: c.value,
    roles: c.roles,
    from: c.from,
    to: c.to,
    last: c.to,
    ceoCfo: c.ceoCfo,
    own: c.ownIncreaseAvg,
    ...(c.fpi ? { fpi: true } : {}),
    ...(c.newPositions ? { nw: c.newPositions } : {}),
    members: c.members.map((m) => ({ n: m.n, r: m.r, ti: m.ti, d: m.d, v: m.v, own: m.ownIncrease })),
    ...(c.others.length ? { others: c.others.map((o) => ({ n: o.n, r: o.r, d: o.d, v: o.v, why: o.why })) } : {}),
  };
}

// A penny row carries everything the free board renders, so /insiders/penny
// needs no API call. Price-derived fields (px/ret/sz/vol/off) come from the
// optional ticker-meta enrichment and are simply omitted when it is empty.
function pennyRow(r, companies, meta, clusters, opts) {
  const m = (r.t && meta?.[r.t]) || {};
  const ret = retFor(r, meta, opts);
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
export function buildPennyBoard(rows, companies, meta, lastDay, now = Date.now(), opts = {}) {
  const anchor = lastDay ? new Date(`${lastDay}T00:00:00Z`).getTime() : now;
  const since = iso(anchor - PENNY.windowDays * 86400000);
  // Open-market trades only: grants, tax withholding and gifts say nothing
  // about conviction and would inflate every count on the page.
  const window = rows.filter(
    (r) => isPenny(r) && r.d >= since && (r.v || 0) >= PENNY.minValue && (isBuy(r) || isSell(r))
  );
  const buys = window.filter(isBuy);
  const sells = window.filter(isSell);
  // the one cluster definition (insiderCluster.js), over the board's buys
  const clusters = buildClusters(buys, { rawOf: rawOfOpts(opts), toUsd: opts.toUsd }).byTicker;
  const sum = (list) => list.reduce((s, r) => s + (r.v || 0), 0);
  const buyValue = sum(buys);
  const sellValue = sum(sells);
  const byValue = (a, b) => (b.v || 0) - (a.v || 0);
  const shape = (r) => pennyRow(r, companies, meta, clusters, opts);

  // One row per ticker, so every slot on the board is a different company; the
  // biggest buy takes the slot and the cluster count says there were more.
  const dedupe = (list) => {
    const seen = new Set();
    return list.filter((r) => !seen.has(r.t) && seen.add(r.t));
  };

  // "High conviction" ranks the signal, not the size: several insiders buying
  // beats one, and an executive beats a 10% owner (usually a fund).
  const rank = { cluster: 0, ceo: 1, cfo: 2, director: 3 };
  // the higher label first (insiderSignal.js, on the filing total), then the
  // kind of buy, then the amount
  const totals = filingTotals(buys);
  const levelRank = { strong: 0, medium: 1, weak: 2, none: 3 };
  const signals = dedupe([...buys].sort(byValue))
    .map((r) => {
      const kind = clusters.has(r.t) ? 'cluster' : rank[r.r] != null ? r.r : null;
      if (!kind) return null;
      const unverified = retFor(r, meta, opts) == null && r.p > 0 && (r.t && meta?.[r.t]?.px) > 0;
      const classification = unverified ? { ...classify(r), price_unverified: true } : undefined;
      return { ...shape(r), kind, level: signalLevel(r, { filing: totals.get(r.a), classification }).level };
    })
    .filter(Boolean)
    .sort((a, b) => levelRank[a.level] - levelRank[b.level] || rank[a.kind] - rank[b.kind] || byValue(a, b))
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

export function buildTeaser(all, companies = {}, meta = {}, now = Date.now(), opts = {}) {
  const rows = all.filter(listed);
  // the headline numbers come from the one shared definition (daySummary), so
  // the home page and /insiders cannot disagree about the same day again
  const summary = daySummary(rows);
  const lastDay = summary.day || '';
  const today = summary.rows;
  const pulse = {
    day: summary.day,
    buyCount: summary.buyCount,
    sellCount: summary.sellCount,
    buyValue: summary.buyValue,
    sellValue: summary.sellValue,
    sellShare: summary.sellShare,
    ...(summary.fxExcluded ? { fxExcluded: summary.fxExcluded } : {}),
    ...(summary.offMarket ? { offMarket: summary.offMarket } : {}),
  };

  // The signal window trails the newest filing day, not the wall clock, so a
  // dataset that is catching up still shows its freshest signals.
  const anchor = lastDay ? new Date(`${lastDay}T00:00:00Z`).getTime() : now;
  const since = iso(anchor - 30 * 86400000);
  const recentBuys = rows.filter((r) => isBuy(r) && r.d >= since);
  // the one cluster definition (insiderCluster.js): the home table and
  // /insiders/cluster both read this list
  const built = buildClusters(rows, { rawOf: rawOfOpts(opts), toUsd: opts.toUsd, isForeign: opts.isForeign, from: since });
  const cluster = built.clusters.slice(0, CLUSTER_ROWS).map((c) => clusterBrief(c, companies));
  const clusterExcluded = built.excluded.slice(0, CLUSTER_ROWS).map((e) => ({ ...e, c: companies[e.t] || null }));

  const dedupe = (list) => {
    const seen = new Set();
    return list.filter((r) => !seen.has(r.t) && seen.add(r.t));
  };
  const csuite = dedupe(
    recentBuys
      .filter((r) => ranked(r) && (r.r === 'ceo' || r.r === 'cfo'))
      .sort((a, b) => (b.v || 0) - (a.v || 0))
  )
    .slice(0, 8)
    .map((r) => brief(r, companies, meta, opts));
  const penny = dedupe(
    recentBuys
      .filter((r) => ranked(r) && r.p < 5 && (r.v || 0) >= 25000)
      .sort((a, b) => (b.v || 0) - (a.v || 0))
  )
    .slice(0, 8)
    .map((r) => brief(r, companies, meta, opts));

  const buys = rows.filter(openBuy).slice().sort((a, b) => (a.f === b.f ? (a.d < b.d ? 1 : -1) : a.f < b.f ? 1 : -1));
  // Highlight: the largest buy by an executive or director on the newest day;
  // 10% owners are usually funds, so they are only a fallback.
  const dayBuys = today.filter(ranked);
  const pool = dayBuys.length ? dayBuys : buys.filter(ranked).slice(0, 50);
  const people = pool.filter((r) => r.r !== 'owner10');
  const pick = (list) => list.reduce((m, r) => ((r.v || 0) > (m.v || 0) ? r : m));
  const highlight = pool.length ? brief(pick(people.length ? people : pool), companies, meta, opts) : null;

  return {
    updatedAt: new Date(now).toISOString(),
    // the price build the levels and returns were computed on
    // (api/_data/prices/_index.json); updatedAt stays the insider data's
    // own time, so a price rebuild never makes old filings look fresh
    pricedAt: opts.pricedAt || null,
    lastDay: lastDay || null,
    total: buys.length,
    pulse,
    highlight,
    signals: { cluster, csuite, penny, clusterExcluded },
    penny: buildPennyBoard(rows, companies, meta, lastDay, now, opts),
    rows: buys.slice(0, 20).map((r) => brief(r, companies, meta, opts)),
  };
}
