import { createRequire } from 'node:module';
import { requirePro } from '../_lib/auth.js';
import { cached, TTL } from '../_lib/cache.js';
import { findClusters, sizeBucket, businessDaysBetween, rowClass, CODES, KEPT_CODES,
  CLUSTER_DENSITY,
  clusterDensity,
  clusterMatches,
  clusterSpanDays,
  winRate,
} from '../_lib/insiderModel.js';
import { isPenny } from '../_lib/insiderTeaser.js';

// GET /api/insider-feed — SEC Form 4 open-market transactions (Pro only).
//
// Query
//   tab      latest | ceo | cfo | cluster | penny | sells
//   q        ticker / company / insider search
//   period   1d | 3d | 1w | 1m | 3m | 1y   (or from=YYYY-MM-DD&to=…)
//   minValue,maxValue      transaction value in dollars
//   minPrice,maxPrice      price per share
//   size     mega|large|mid|small|micro     sector  free text
//   change   new | inc10 | inc50 | inc100   ownership change after the trade
//   lagMin,lagMax          calendar days between trade and filing
//   late     1 = include filings later than the 2-business-day deadline
//   excludePlanned  1 = drop Rule 10b5-1 scheduled trades
//   codes    P,S,M,… restrict to specific Form 4 transaction codes
//   clusterMin      2 | 3 | 5  minimum distinct insiders in the cluster
//   density  blitz | tight | standard | extended  how tightly it is packed
//   cls      comma list of conviction|liquidity|noise (default: conviction,liquidity)
//   sort     date|value|return|shares|lag   dir asc|desc   page, perPage
//
// The dataset ships with the deployment (api/_data/insiders.json), built daily
// by .github/workflows/insiders.yml, so a request never hits SEC directly.
const require = createRequire(import.meta.url);

function load() {
  try {
    return require('../_data/insiders.json');
  } catch {
    return { rows: [], updatedAt: null, lastDay: null };
  }
}
function loadMeta() {
  try {
    return require('../_data/ticker-meta.json');
  } catch {
    return {};
  }
}

const PERIOD_DAYS = { '1d': 1, '3d': 3, '1w': 7, '1m': 31, '3m': 92, '6m': 184, '1y': 366 };
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const numQ = (v) => {
  const s = String(v ?? '').replace(/[, ]/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// Row as the client sees it: short keys expanded, price-derived fields added.
function shape(r, meta, companies) {
  const m = (r.t && meta[r.t]) || {};
  const ret = m.px != null && r.p ? ((m.px - r.p) / r.p) * 100 : null;
  return {
    ticker: r.t,
    company: companies[r.t] || null,
    cik: r.ci,
    insider: r.n,
    role: r.r,
    title: r.ti,
    date: r.d,
    filed: r.f,
    lag: businessDaysBetween(r.d, r.f),
    side: rowClass(r) === 'liquidity' ? 'sell' : 'buy',
    code: r.k,
    kind: CODES[r.k] || 'other',
    cls: rowClass(r),
    planned: Boolean(r.p5),
    shares: r.s,
    price: r.p,
    value: r.v,
    owned: r.o,
    ownChange: r.oc,
    current: m.px ?? null,
    ret: ret != null ? Number(ret.toFixed(1)) : null,
    // dollar volume and distance above the 52-week low — thin liquidity and a
    // price already far off the low are the two ways a penny "gem" bites back
    volume: m.px != null && m.vol > 0 ? Math.round(m.px * m.vol) : null,
    offLow: m.px != null && m.lo > 0 ? Number((((m.px - m.lo) / m.lo) * 100).toFixed(1)) : null,
    sector: m.sector || null,
    size: sizeBucket(m.mcap),
    pe: m.pe ?? null,
    url: r.ci && r.a ? `https://www.sec.gov/Archives/edgar/data/${Number(r.ci)}/${String(r.a).replace(/-/g, '')}/` : null,
  };
}

// Market activity + signal cards for the header, computed over the newest day
// that actually has filings.
function buildStats(all, meta, scope = null) {
  const rows = scope ? all.filter(scope) : all;
  const latestDay = rows.reduce((m, r) => (r.f > m ? r.f : m), '');
  const today = rows.filter((r) => r.f === latestDay);
  const buys = today.filter((r) => r.k === 'P');
  const sells = today.filter((r) => r.k === 'S');
  const sum = (list) => list.reduce((s, r) => s + (r.v || 0), 0);
  const buyValue = sum(buys);
  const sellValue = sum(sells);

  const last24 = rows.filter((r) => r.f === latestDay && r.k === 'P');
  const clusters = findClusters(rows.filter((r) => r.d >= iso(Date.now() - 45 * 86400000)));
  const signals = [];
  for (const r of last24) {
    const m = (r.t && meta[r.t]) || {};
    const ret = m.px != null && r.p ? ((m.px - r.p) / r.p) * 100 : null;
    const cl = clusters.get(r.t);
    let kind = null;
    if (cl) kind = 'cluster';
    else if (r.r === 'ceo') kind = 'ceo';
    else if (r.r === 'cfo') kind = 'cfo';
    else if (r.r === 'director') kind = 'director';
    if (!kind) continue;
    signals.push({
      ticker: r.t,
      kind,
      insiders: cl?.insiders ?? 1,
      price: r.p,
      value: r.v,
      ret: ret != null ? Number(ret.toFixed(1)) : null,
    });
  }
  const rank = { cluster: 0, ceo: 1, cfo: 2, director: 3 };
  signals.sort((a, b) => rank[a.kind] - rank[b.kind] || (b.value || 0) - (a.value || 0));
  const seen = new Set();
  const topSignals = signals.filter((s) => !seen.has(s.ticker) && seen.add(s.ticker)).slice(0, 3);

  const top = (list) =>
    [...list]
      .sort((a, b) => (b.v || 0) - (a.v || 0))
      .slice(0, 3)
      .map((r) => {
        const m = (r.t && meta[r.t]) || {};
        const ret = m.px != null && r.p ? ((m.px - r.p) / r.p) * 100 : null;
        return {
          ticker: r.t,
          insider: r.n,
          value: r.v,
          price: r.p,
          ret: ret != null ? Number(ret.toFixed(1)) : null,
        };
      });

  return {
    day: latestDay || null,
    companies: new Set(today.map((r) => r.t)).size,
    buyCount: buys.length,
    sellCount: sells.length,
    buyValue,
    sellValue,
    sellShare: buyValue + sellValue > 0 ? (sellValue / (buyValue + sellValue)) * 100 : null,
    signals: topSignals,
    topBuys: top(buys),
    topSells: top(sells),
  };
}

export default async function handler(req, res) {
  if (!(await requirePro(req, res))) return;

  const db = load();
  const meta = loadMeta();
  const rows = db.rows || [];
  if (!rows.length) {
    return res.status(200).json({ rows: [], total: 0, stats: null, updatedAt: null, empty: true });
  }

  const q = String(req.query.q || '').trim().toUpperCase();
  const tab = String(req.query.tab || 'latest');
  const period = String(req.query.period || '1y');
  const days = PERIOD_DAYS[period] ?? 366;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : iso(Date.now() - days * 86400000);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : null;
  const minValue = numQ(req.query.minValue);
  const maxValue = numQ(req.query.maxValue);
  const minPrice = numQ(req.query.minPrice);
  const maxPrice = numQ(req.query.maxPrice);
  const lagMin = numQ(req.query.lagMin);
  const lagMax = numQ(req.query.lagMax);
  const size = String(req.query.size || '');
  const sector = String(req.query.sector || '');
  const change = String(req.query.change || '');
  const includeLate = req.query.late === '1';
  // Rule 10b5-1 trades are scheduled months ahead, so they carry no view on
  // today's price. The flag is stored per row; this is the switch that acts
  // on it.
  const excludePlanned = req.query.excludePlanned === '1';
  // Transaction codes, so a reader can ask for exercise-and-hold or tax
  // withholding specifically instead of the three broad classes.
  const codes = new Set(
    String(req.query.codes || '')
      .toUpperCase()
      .split(',')
      .map((c) => c.trim())
      .filter((c) => KEPT_CODES.has(c))
  );
  const clusterMin = Number(req.query.clusterMin) || 0;
  const density = CLUSTER_DENSITY.includes(String(req.query.density)) ? String(req.query.density) : '';
  const classes = new Set(
    String(req.query.cls || 'conviction,liquidity')
      .split(',')
      .filter((c) => ['conviction', 'liquidity', 'noise'].includes(c))
  );
  const sort = ['date', 'value', 'return', 'shares', 'lag'].includes(req.query.sort) ? req.query.sort : 'date';
  const dir = req.query.dir === 'asc' ? 1 : -1;
  const perPage = Math.min(Math.max(Number(req.query.perPage) || 50, 10), 200);
  const page = Math.max(Number(req.query.page) || 1, 1);

  // Clusters are computed over the whole window, not the filtered slice, so a
  // cluster is still recognised when the user narrows by role or value.
  const clusters = cached(`insider:clusters:${db.updatedAt}`, TTL.HOUR_6, async () =>
    findClusters(rows.filter((r) => r.k === 'P'))
  );
  const clusterMap = await clusters;

  // Buy tabs show High-conviction acquisitions (P, C, exercise-and-hold);
  // the sells tab shows Liquidity events (S, D, exercise cash-outs). Noise
  // (grants, tax withholding, gifts…) only appears when cls includes it.
  const wantSells = tab === 'sells';
  let out = [];
  for (const r of rows) {
    const cl = rowClass(r);
    if (!classes.has(cl)) continue;
    if (wantSells ? cl === 'conviction' : cl === 'liquidity') continue;
    if (tab !== 'latest' && tab !== 'sells' && r.k !== 'P') continue;
    if (r.d < from) continue;
    if (to && r.d > to) continue;
    if (tab === 'ceo' && r.r !== 'ceo') continue;
    if (tab === 'cfo' && r.r !== 'cfo') continue;
    if (tab === 'cluster' && !clusterMap.has(r.t)) continue;
    if (excludePlanned && r.p5) continue;
    if (codes.size && !codes.has(String(r.k || '').toUpperCase())) continue;
    if (!clusterMatches(clusterMap.get(r.t), { min: clusterMin, density })) continue;
    if (tab === 'penny' && !isPenny(r)) continue;
    if (minValue != null && !(r.v != null && r.v >= minValue)) continue;
    if (maxValue != null && !(r.v != null && r.v <= maxValue)) continue;
    if (minPrice != null && !(r.p != null && r.p >= minPrice)) continue;
    if (maxPrice != null && !(r.p != null && r.p <= maxPrice)) continue;
    if (change === 'new' && !(r.o != null && r.s != null && r.o === r.s)) continue;
    if (change === 'inc10' && !(r.oc != null && r.oc >= 10)) continue;
    if (change === 'inc50' && !(r.oc != null && r.oc >= 50)) continue;
    if (change === 'inc100' && !(r.oc != null && r.oc >= 100)) continue;
    if (q && !(String(r.t || '').includes(q) || String((db.companies || {})[r.t] || '').toUpperCase().includes(q) || r.n?.toUpperCase().includes(q)))
      continue;

    const m = (r.t && meta[r.t]) || {};
    if (size && sizeBucket(m.mcap) !== size) continue;
    if (sector && m.sector !== sector) continue;

    const lag = businessDaysBetween(r.d, r.f);
    if (!includeLate && lag != null && lag > 2) continue;
    if (lagMin != null && !(lag != null && lag >= lagMin)) continue;
    if (lagMax != null && !(lag != null && lag <= lagMax)) continue;

    out.push(r);
  }

  const keyOf = {
    date: (r) => r.f,
    value: (r) => r.v || 0,
    shares: (r) => r.s || 0,
    lag: (r) => businessDaysBetween(r.d, r.f) ?? 0,
    return: (r) => {
      const m = (r.t && meta[r.t]) || {};
      return m.px != null && r.p ? (m.px - r.p) / r.p : -Infinity;
    },
  }[sort];
  out.sort((a, b) => {
    const x = keyOf(a);
    const y = keyOf(b);
    if (x === y) return a.d < b.d ? 1 : -1;
    return x < y ? -dir : dir;
  });

  const total = out.length;
  const companies = db.companies || {};
  // Per-row cluster context and the ticker's hit rate. Both are computed over
  // the whole dataset rather than the page, and only for the rows actually
  // returned — a hit rate per ticker across a year of rows is not free.
  const byTicker = new Map();
  for (const r of rows) {
    if (!r.t) continue;
    if (!byTicker.has(r.t)) byTicker.set(r.t, []);
    byTicker.get(r.t).push(r);
  }
  const slice = out.slice((page - 1) * perPage, page * perPage).map((r) => {
    const row = shape(r, meta, companies);
    const cl = r.t ? clusterMap.get(r.t) : null;
    if (cl) {
      row.cluster = {
        insiders: cl.insiders,
        value: Math.round(cl.value),
        from: cl.from,
        to: cl.to,
        spanDays: clusterSpanDays(cl),
        density: clusterDensity(cl),
      };
    }
    const px = (r.t && meta[r.t]?.px) ?? null;
    row.winRate = px != null ? winRate(byTicker.get(r.t) || [], px) : null;
    return row;
  });
  const sectors = [...new Set(Object.values(meta).map((m) => m.sector).filter(Boolean))].sort();

  res.status(200).json({
    rows: slice,
    total,
    page,
    perPage,
    updatedAt: db.updatedAt,
    lastDay: db.lastDay,
    stats: page === 1 ? buildStats(rows, meta, tab === 'penny' ? isPenny : null) : null,
    sectors: page === 1 ? sectors : undefined,
    clusterCount: clusterMap.size,
  });
}
