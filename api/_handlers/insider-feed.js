import { requirePro } from '../_lib/auth.js';
import { cached, TTL } from '../_lib/cache.js';
import { daySummary, findClusters, sizeBucket, businessDaysBetween, CODES, KEPT_CODES,
  CLUSTER_DENSITY,
  clusterDensity,
  clusterMatches,
  clusterSpanDays,
} from '../_lib/insiderModel.js';
import { isPenny } from '../_lib/insiderTeaser.js';
import { readServed } from '../_lib/insiderStore.js';
import { classify } from '../_lib/insiderClassify.js';
import { filingTotals, signalLevel } from '../_lib/insiderSignal.js';
import { buysByPerson, hitRate } from '../_lib/insiderOutcome.js';
import { sinceTrade } from '../_lib/splitAdjust.js';
import { priceCheck } from '../_lib/insiderPriceCheck.js';
import { readRawServed } from '../_lib/insiderStore.js';
import { seriesWithFpi } from '../_lib/fpiContext.js';
import { fxBrief } from '../_lib/insiderTeaser.js';
import { createRequire } from 'node:module';

// GET /api/insider-feed — SEC Form 4 open-market transactions.
//
// ?full=1 is the Pro feed: every filter below, every row, paginated, private
// cache. Without it the answer is the free preview the page renders for a
// signed-out reader (and the server renders into the HTML): the same three
// cards, the first FREE_ROWS rows of the tab (FREE_ROWS_TAB on the role and
// cluster tabs), no filter honoured, `preview: true` and the real `total`
// so the lock box can say how much is behind it — cacheable on the CDN.
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
//   types    'all' shows every transaction type; by default only open-market
//            buys (buy tabs) and sales (sells tab) — insiderClassify.js
//   sort     date|value|return|shares|lag   dir asc|desc   page, perPage
//
// The dataset ships with the deployment, built by .github/workflows/insiders.yml
// and read through the insider store, so a request never hits SEC directly.
// `readServed()` returns current rows only: a Form 4 superseded by a 4/A is
// never listed, counted or used for a signal.
const require = createRequire(import.meta.url);
const load = readServed;

// Per dataset (the rows only change with a deploy): each line's category and
// flags, the open-market buy totals per filing, and each person's buys.
let derivedFor = null;
let derived = null;
function derive(db) {
  if (derivedFor === db) return derived;
  const cls = new Map();
  for (const r of db.rows) cls.set(r, classify(r));
  derived = { cls, filings: filingTotals(db.rows), people: buysByPerson(db.rows) };
  derivedFor = db;
  return derived;
}
// Can this line's price be compared with today's? Checked here, at read
// time, for the rows actually shown (insiderPriceCheck.js) — not only by the
// nightly build — so a wrong return never waits for the next crawl.
const checks = new WeakMap();
let seriesOf = null;
function checkOf(r, meta) {
  seriesOf ||= seriesWithFpi();
  if (!checks.has(r))
    checks.set(r, priceCheck(r, { raw: readRawServed()[`${r.a}:${r.li}`], series: r.t ? seriesOf(r.t) : null, current: (r.t && meta[r.t]?.px) ?? null }));
  return checks.get(r);
}
// The classification with the price check folded in.
const clsOf = (r, d, meta) => {
  const c = d.cls.get(r) || classify(r);
  return c.openMarket && !checkOf(r, meta).ok ? { ...c, price_unverified: true } : c;
};
// Signal level on the filing total, with the line's classification reused.
const levelOf = (r, d, meta) => signalLevel(r, { classification: clsOf(r, d, meta), filing: d.filings.get(r.a) });
// Return since the trade: open-market lines whose price passed the check only.
const retOf = (r, meta, d) => {
  const c = clsOf(r, d, meta);
  return c.openMarket && !c.price_unverified ? sinceTrade(r, (r.t && meta[r.t]?.px) ?? null) : null;
};
function loadMeta() {
  try {
    return require('../_data/ticker-meta.json');
  } catch {
    return {};
  }
}

const FREE_ROWS = 10;
const FREE_ROWS_TAB = 5;

const PERIOD_DAYS = { '1d': 1, '3d': 3, '1w': 7, '1m': 31, '3m': 92, '6m': 184, '1y': 366 };
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const numQ = (v) => {
  const s = String(v ?? '').replace(/[, ]/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// Row as the client sees it: short keys expanded, price-derived fields added.
// The return since the trade is only meaningful for an open-market buy or
// sale with a real price; for an exercise at $0.49 or a $0 award it read
// +4,889% and meant nothing, so it is null there.
function shape(r, meta, companies, d) {
  const m = (r.t && meta[r.t]) || {};
  // …and not when the price cannot be checked against the market (CEMEX
  // in pesos showed −43.8%, NCT after a reverse split +1,007.5%): the page
  // says why instead. Both prices in today's shares (splits since the trade).
  const c = clsOf(r, d, meta);
  const chk = c.openMarket ? checkOf(r, meta) : { ok: true, reason: null };
  const ret = retOf(r, meta, d);
  const sig = levelOf(r, d, meta);
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
    side: c.side,
    code: r.k,
    kind: CODES[r.k] || 'other',
    category: c.category,
    planned: c.plan_trade,
    largeHolder: c.ten_pct_owner_only || c.fund_insider,
    holder: sig.holder,
    fund: c.fund_insider,
    priceUnverified: c.price_unverified,
    priceNote: chk.ok ? null : chk.reason,
    signal: { level: sig.level, why: sig.why, role: sig.role, value: sig.value, lines: sig.lines, ownIncrease: Number.isFinite(sig.ownIncrease) ? Number(sig.ownIncrease.toFixed(1)) : sig.ownIncrease === Infinity ? 'new' : null },
    shares: r.s,
    price: r.fx?.fail ? null : r.p,
    value: r.fx?.fail ? null : r.v,
    // a foreign issuer's line: the currency and ADR ratio it was converted
    // with, or — not convertible — its amount in its own currency
    ...fxShape(r),
    owned: r.o,
    ownChange: r.oc,
    current: m.px ?? null,
    ret: ret != null ? Number(ret.toFixed(1)) + 0 : null, // + 0: never "−0"
    // dollar volume and distance above the 52-week low — thin liquidity and a
    // price already far off the low are the two ways a penny "gem" bites back
    volume: m.px != null && m.vol > 0 ? Math.round(m.px * m.vol) : null,
    offLow: m.px != null && m.lo > 0 ? Number((((m.px - m.lo) / m.lo) * 100).toFixed(1)) : null,
    sector: m.sector || null,
    size: sizeBucket(m.mcap),
    url: r.ci && r.a ? `https://www.sec.gov/Archives/edgar/data/${Number(r.ci)}/${String(r.a).replace(/-/g, '')}/` : null,
  };
}

function fxShape(r) {
  const b = fxBrief(r).fx;
  if (!b) return {};
  if (r.fx.fail) return { valueUnverified: true, currency: b.cu, localValue: b.lv, localPrice: b.lp };
  return { currency: b.cu, adrRatio: b.ar, localPrice: b.lp, ratioSource: r.fx.as, fxRate: r.fx.rate };
}

// Market activity + signal cards for the header, computed over the newest day
// that actually has filings.
function buildStats(all, meta, scope = null, d = derive({ rows: all })) {
  // the headline numbers: one definition shared with the home page (daySummary)
  const summary = daySummary(all, scope);
  const rows = scope ? all.filter(scope) : all;
  const latestDay = summary.day || '';
  const buys = summary.buys;
  const sells = summary.sells;
  const buyValue = summary.buyValue;
  const sellValue = summary.sellValue;

  const last24 = buys;
  const clusters = findClusters(rows.filter((r) => r.d >= iso(Date.now() - 45 * 86400000)));
  const signals = [];
  for (const r of last24) {
    if (r.fx?.fail) continue;
    const m = (r.t && meta[r.t]) || {};
    const ret = retOf(r, meta, d);
    const cl = clusters.get(r.t);
    let kind = null;
    if (cl) kind = 'cluster';
    else if (r.r === 'ceo') kind = 'ceo';
    else if (r.r === 'cfo') kind = 'cfo';
    else if (r.r === 'director') kind = 'director';
    if (!kind) continue;
    // a card for a buy that rates no signal (a planned trade, a $5K top-up)
    // would contradict the label beside it; clusters are item 3's business
    const level = levelOf(r, d, meta).level;
    if (level === 'none' && kind !== 'cluster') continue;
    signals.push({
      ticker: r.t,
      kind,
      level,
      insiders: cl?.insiders ?? 1,
      price: r.p,
      value: r.v,
      ret: ret != null ? Number(ret.toFixed(1)) + 0 : null, // + 0: never "−0"
    });
  }
  // the higher level first, then the kind of buy, then the amount
  const rank = { cluster: 0, ceo: 1, cfo: 2, director: 3 };
  const levelRank = { strong: 0, medium: 1, weak: 2, none: 3 };
  signals.sort((a, b) => levelRank[a.level] - levelRank[b.level] || rank[a.kind] - rank[b.kind] || (b.value || 0) - (a.value || 0));
  const seen = new Set();
  const topSignals = signals.filter((s) => !seen.has(s.ticker) && seen.add(s.ticker)).slice(0, 3);

  const top = (list) =>
    list
      .filter((r) => !r.fx?.fail)
      .sort((a, b) => (b.v || 0) - (a.v || 0))
      .slice(0, 3)
      .map((r) => {
        const m = (r.t && meta[r.t]) || {};
        const ret = retOf(r, meta, d);
        return {
          ticker: r.t,
          insider: r.n,
          value: r.v,
          price: r.p,
          ret: ret != null ? Number(ret.toFixed(1)) + 0 : null, // + 0: never "−0"
        };
      });

  return {
    day: latestDay || null,
    companies: summary.companies,
    buyCount: summary.buyCount,
    sellCount: summary.sellCount,
    buyValue,
    sellValue,
    sellShare: summary.sellShare,
    fxExcluded: summary.fxExcluded || 0,
    signals: topSignals,
    topBuys: top(buys),
    topSells: top(sells),
  };
}

export default async function handler(req, res) {
  const wantFull = req.query.full === '1';
  if (wantFull && !(await requirePro(req, res))) return;
  const free = !wantFull;
  const body = await answer(req.query, { free });
  if (free && !body.empty) res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=7200');
  res.status(200).json(body);
}

// The feed itself, once the caller is allowed to see it (`free` = the
// preview). Exported for the tests, which have no Pro session to sign in with.
export async function answer(rawQuery, { free = true } = {}) {
  // the preview knows only the tab: a filter a free reader typed is ignored
  const query = free ? { tab: rawQuery.tab } : rawQuery;

  const db = load();
  const meta = loadMeta();
  const rows = db.rows || [];
  if (!rows.length) {
    return { rows: [], total: 0, stats: null, updatedAt: null, lastFilingDay: null, empty: true };
  }

  const q = String(query.q || '').trim().toUpperCase();
  const tab = String(query.tab || 'latest');
  const period = String(query.period || '1y');
  const days = PERIOD_DAYS[period] ?? 366;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : iso(Date.now() - days * 86400000);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : null;
  const minValue = numQ(query.minValue);
  const maxValue = numQ(query.maxValue);
  const minPrice = numQ(query.minPrice);
  const maxPrice = numQ(query.maxPrice);
  const lagMin = numQ(query.lagMin);
  const lagMax = numQ(query.lagMax);
  const size = String(query.size || '');
  const sector = String(query.sector || '');
  const change = String(query.change || '');
  const includeLate = query.late === '1';
  // Rule 10b5-1 trades are scheduled months ahead, so they carry no view on
  // today's price. The flag is stored per row; this is the switch that acts
  // on it.
  const excludePlanned = query.excludePlanned === '1';
  // Transaction codes, so a reader can ask for exercise-and-hold or tax
  // withholding specifically instead of the three broad classes.
  const codes = new Set(
    String(query.codes || '')
      .toUpperCase()
      .split(',')
      .map((c) => c.trim())
      .filter((c) => KEPT_CODES.has(c))
  );
  const clusterMin = Number(query.clusterMin) || 0;
  const density = CLUSTER_DENSITY.includes(String(query.density)) ? String(query.density) : '';
  // Default: open-market buys and sales only — what the page subtitle says.
  // "Diğer işlem türlerini göster" (types=all) adds exercises, awards, tax
  // withholding, gifts, conversions and the rest, each labelled. The old
  // cls=…noise switch means the same thing.
  const showOther = query.types === 'all' || /noise/.test(String(query.cls || ''));
  const sort = ['date', 'value', 'return', 'shares', 'lag'].includes(query.sort) ? query.sort : 'date';
  const dir = query.dir === 'asc' ? 1 : -1;
  const perPage = free ? (tab === 'latest' || tab === 'sells' ? FREE_ROWS : FREE_ROWS_TAB) : Math.min(Math.max(Number(query.perPage) || 50, 10), 200);
  const page = free ? 1 : Math.max(Number(query.page) || 1, 1);

  // Clusters are computed over the whole window, not the filtered slice, so a
  // cluster is still recognised when the user narrows by role or value.
  const clusters = cached(`insider:clusters:${db.updatedAt}`, TTL.HOUR_6, async () =>
    findClusters(rows.filter((r) => r.k === 'P'))
  );
  const clusterMap = await clusters;

  // The latest tab lists open-market buys, the sells tab open-market sales;
  // with other types shown, each tab takes the other categories on its side
  // (an award or exercise with the buys, tax withholding or a gift with the
  // sells). The role, cluster and penny tabs are about buying: open-market
  // buys only, always.
  const d = derive(db);
  const wantSells = tab === 'sells';
  const listTab = tab === 'latest' || tab === 'sells';
  let out = [];
  for (const r of rows) {
    const c = d.cls.get(r);
    if (listTab) {
      if (c.side !== (wantSells ? 'sell' : 'buy')) continue;
      if (!showOther && !c.openMarket) continue;
    } else if (c.category !== 'open_buy') continue;
    if (r.d < from) continue;
    if (to && r.d > to) continue;
    if (tab === 'ceo' && r.r !== 'ceo') continue;
    if (tab === 'cfo' && r.r !== 'cfo') continue;
    if (tab === 'cluster' && !clusterMap.has(r.t)) continue;
    if (excludePlanned && c.plan_trade) continue;
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
      const x = retOf(r, meta, d);
      return x == null ? -Infinity : x;
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
  // Per-row cluster context and "İsabet": of this person's earlier
  // open-market buys, the share that beat SPY over the next 90 days
  // (insiderOutcome.hitRate; null for funds, `insufficient` under n = 3).
  const slice = out.slice((page - 1) * perPage, page * perPage).map((r) => {
    const row = shape(r, meta, companies, d);
    const cl = r.t ? clusterMap.get(r.t) : null;
    if (cl) {
      row.cluster = {
        insiders: cl.insiders,
        value: Math.round(cl.value),
        from: cl.from,
        to: cl.to,
        spanDays: clusterSpanDays(cl),
        density: clusterDensity(cl),
        ...(cl.fxExcluded ? { fxExcluded: cl.fxExcluded } : {}),
      };
    }
    const c = clsOf(r, d, meta);
    row.hitRate = c.category !== 'open_buy' || c.fund_insider ? null : c.price_unverified ? { unverified: true } : hitRate(r, d.people);
    return row;
  });
  const sectors = [...new Set(Object.values(meta).map((m) => m.sector).filter(Boolean))].sort();

  return {
    rows: slice,
    total,
    page,
    perPage,
    preview: free,
    locked: free && total > slice.length,
    updatedAt: db.updatedAt,
    // the newest filing date in the rows: what "Güncelleme" / "Son veri" shows
    lastDay: db.lastFilingDay,
    lastFilingDay: db.lastFilingDay,
    stats: page === 1 ? buildStats(rows, meta, tab === 'penny' ? isPenny : null, d) : null,
    sectors: page === 1 ? sectors : undefined,
    clusterCount: clusterMap.size,
  };
}
