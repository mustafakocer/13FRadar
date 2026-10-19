// The values inside the files, not just their size.
//
// dataAudit.js asks whether a dataset is whole and whether it moved more than
// a rebuild plausibly moves it. That catches a truncated feed; it does not
// catch a file of the right size full of the wrong numbers — a benchmark
// series with a decimal slip, an exchange rate stored upside down, a fund
// "returning" 3,000% in a quarter because one holding's price lost a split.
// These are the rules for those, one function per dataset, each taking the
// parsed JSON and returning findings { severity, rule, message }.
//
// A finding marked `overridable` is a value that can, very rarely, be real (a
// currency devalued by a third overnight): AUDIT_ALLOW_DRIFT=1 turns it into
// a warning, the same way it waves through an intended collapse in counts.
// Everything else is arithmetic that cannot be wrong and still be data.
import { MIN_COVERAGE } from './performance.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fin = Number.isFinite;

// The first few names, so a finding says where to look without becoming a
// thousand-line log.
const LIST = 8;
export const listOf = (items, n = LIST) =>
  items.length <= n ? items.join(', ') : `${items.slice(0, n).join(', ')} … (+${items.length - n})`;

const median = (xs) => {
  const s = xs.filter(fin).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const dayMs = (iso) => Date.parse(`${iso}T00:00:00Z`);

// ---------------------------------------------------------------------------
// guru-performance.json — the 1/3/5/10-year figures against SPY
// ---------------------------------------------------------------------------

// No long-only 13F book triples in a quarter or loses nine-tenths of itself;
// a figure like that is a price that lost a split or a unit. Past 100% the
// quarter is possible (Fairholme's St. Joe quarter was +91%) but worth a look.
export const PERF_QUARTER_MAX = 300;
export const PERF_QUARTER_MIN = -90;
export const PERF_QUARTER_WARN = 100;
// SPY's worst quarter on record is about −22% (Q4 2008), its best about +20%
// (Q2 2020); a stub to today runs at most 200 days.
export const SPY_PERIOD_MAX = 40;

export function guruPerformanceChecks(d) {
  const out = [];
  const gurus = isObj(d?.byCik) ? Object.entries(d.byCik) : [];
  const arith = [];
  const outliers = [];
  const warnOutliers = [];
  const coverage = [];
  const sequence = [];
  const spyBad = [];
  // every guru reads SPY at the same two dates for the same window, so one
  // window answering two different SPY returns means the benchmark series
  // changed under the build, or one guru read a different benchmark
  const spyByWindow = new Map();

  for (const [cik, g] of gurus) {
    const name = g?.name || cik;
    const periods = Array.isArray(g?.periods) ? g.periods : [];
    for (const p of periods) {
      if (!(String(p.from) < String(p.to))) sequence.push(`${name} ${p.from}→${p.to}`);
      if (p.coverage != null && !(p.coverage >= 0 && p.coverage <= 1.0005)) coverage.push(`${name} ${p.from} coverage ${p.coverage}`);
      if (p.port != null && p.coverage != null && p.coverage < MIN_COVERAGE - 1e-9) coverage.push(`${name} ${p.from} priced ${p.coverage} but answered ${p.port}%`);
      if (p.port != null) {
        if (!fin(p.port)) outliers.push(`${name} ${p.from} ${p.port}`);
        else if (p.port > PERF_QUARTER_MAX || p.port < PERF_QUARTER_MIN) outliers.push(`${name} ${p.from}→${p.to} ${p.port}%`);
        else if (Math.abs(p.port) > PERF_QUARTER_WARN) warnOutliers.push(`${name} ${p.from}→${p.to} ${p.port}%`);
      }
      if (p.spy != null) {
        if (!fin(p.spy) || Math.abs(p.spy) > SPY_PERIOD_MAX) spyBad.push(`${p.from}→${p.to} SPY ${p.spy}%`);
        const key = `${p.from}>${p.to}`;
        if (!spyByWindow.has(key)) spyByWindow.set(key, new Set());
        spyByWindow.get(key).add(p.spy);
      }
    }
    for (const [h, x] of Object.entries(g?.horizons || {})) {
      if (x?.port == null) continue;
      if (x.spy == null || x.diff == null || Math.abs(x.port - x.spy - x.diff) > 0.15) {
        arith.push(`${name} ${h}: ${x.port} − ${x.spy} ≠ ${x.diff}`);
        continue;
      }
      // the horizon is the product of the periods inside its window; the
      // stored figures are rounded (periods to 0.01, horizons to 0.1)
      const win = periods.filter((p) => p.from >= x.from && p.to <= x.to);
      if (!win.length || win.some((p) => p.port == null || p.spy == null)) {
        arith.push(`${name} ${h}: no complete periods behind ${x.port}%`);
        continue;
      }
      const port = (win.reduce((a, p) => a * (1 + p.port / 100), 1) - 1) * 100;
      const spy = (win.reduce((a, p) => a * (1 + p.spy / 100), 1) - 1) * 100;
      if (Math.abs(port - x.port) > 0.6 || Math.abs(spy - x.spy) > 0.6) {
        arith.push(`${name} ${h}: stored ${x.port}/${x.spy}, periods chain to ${port.toFixed(1)}/${spy.toFixed(1)}`);
      }
    }
  }
  const spySplit = [...spyByWindow].filter(([, s]) => s.size > 1).map(([k, s]) => `${k.replace('>', '→')}: ${[...s].join(' / ')}`);

  if (arith.length) out.push({ severity: 'error', rule: 'perf-arith', message: `horizon figures that do not follow from their periods: ${listOf(arith)}` });
  if (sequence.length) out.push({ severity: 'error', rule: 'perf-sequence', message: `periods that end before they start: ${listOf(sequence)}` });
  if (coverage.length) out.push({ severity: 'error', rule: 'perf-coverage', message: `coverage out of range or below the ${MIN_COVERAGE} floor: ${listOf(coverage)}` });
  if (spySplit.length) out.push({ severity: 'error', rule: 'perf-benchmark', message: `the same window carries different SPY returns: ${listOf(spySplit)}` });
  if (spyBad.length) out.push({ severity: 'error', rule: 'perf-benchmark', overridable: true, message: `SPY returns no market has produced: ${listOf([...new Set(spyBad)])}` });
  if (outliers.length) out.push({ severity: 'error', rule: 'perf-outlier', overridable: true, message: `quarter returns outside ${PERF_QUARTER_MIN}%…+${PERF_QUARTER_MAX}%: ${listOf(outliers)}` });
  if (warnOutliers.length) out.push({ severity: 'warn', rule: 'perf-outlier', message: `quarter returns past ±${PERF_QUARTER_WARN}%: ${listOf(warnOutliers)}` });
  return out;
}

// ---------------------------------------------------------------------------
// fpi.json — exchange rates (US dollars per unit) and ADR ratios
// ---------------------------------------------------------------------------

// The widest one-day move in a year of these 31 currencies is under 5%. A
// quarter in a day is a devaluation or a bad print; past it the rate is
// rejected unless the override says it is real.
export const FX_DAY_MAX = 0.25;
export const FX_DAY_WARN = 0.08;
// The last few observations are what a night's build adds; older ones were
// audited on the night they arrived.
export const FX_RECENT = 10;
// A rate stored upside down (yen per dollar instead of dollars per yen) is
// off its own year by a factor of thousands; a real move is not off by two.
export const FX_LEVEL_BAND = 2;
export const FX_STALE_DAYS = 7;

export function fxChecks(d) {
  const out = [];
  const rates = isObj(d?.rates) ? d.rates : {};
  const shape = [];
  const jumps = [];
  const warnJumps = [];
  const level = [];
  const stale = [];
  let newest = null;
  for (const s of Object.values(rates)) {
    const last = Array.isArray(s) && s.length ? s[s.length - 1]?.[0] : null;
    if (last && (!newest || last > newest)) newest = last;
  }
  for (const [cur, s] of Object.entries(rates)) {
    if (!Array.isArray(s) || !s.length) {
      shape.push(`${cur} empty`);
      continue;
    }
    let ok = true;
    for (let i = 0; i < s.length; i++) {
      const [date, v] = Array.isArray(s[i]) ? s[i] : [];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !(fin(v) && v > 0)) {
        shape.push(`${cur} ${date} ${v}`);
        ok = false;
        break;
      }
      if (i > 0 && !(date > s[i - 1][0])) {
        shape.push(`${cur} ${date} out of order`);
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    for (let i = Math.max(1, s.length - FX_RECENT); i < s.length; i++) {
      const move = s[i][1] / s[i - 1][1] - 1;
      const line = `${cur} ${s[i - 1][0]}→${s[i][0]} ${(move * 100).toFixed(1)}%`;
      if (Math.abs(move) > FX_DAY_MAX) jumps.push(line);
      else if (Math.abs(move) > FX_DAY_WARN) warnJumps.push(line);
    }
    const med = median(s.slice(-250).map((r) => r[1]));
    const last = s[s.length - 1];
    if (med && (last[1] / med > FX_LEVEL_BAND || med / last[1] > FX_LEVEL_BAND)) level.push(`${cur} ${last[1]} vs its year's median ${med}`);
    if (newest && (dayMs(newest) - dayMs(last[0])) / 86400000 > FX_STALE_DAYS) stale.push(`${cur} (${last[0]})`);
  }

  const missing = new Set();
  const ratios = [];
  for (const [cik, e] of Object.entries(isObj(d?.issuers) ? d.issuers : {})) {
    if (e?.cur && !rates[e.cur]) missing.add(e.cur);
    if (e?.ads && e.ratio != null && !(fin(e.ratio) && e.ratio > 0)) ratios.push(`${e.t || cik} ${e.ratio}`);
  }

  if (shape.length) out.push({ severity: 'error', rule: 'fx-shape', message: `rates that are not a positive number on an ascending date: ${listOf(shape)}` });
  if (level.length) out.push({ severity: 'error', rule: 'fx-level', overridable: true, message: `rates off their own year by more than ×${FX_LEVEL_BAND} (stored upside down?): ${listOf(level)}` });
  if (jumps.length) out.push({ severity: 'error', rule: 'fx-jump', overridable: true, message: `one-day moves past ±${FX_DAY_MAX * 100}%: ${listOf(jumps)}` });
  if (warnJumps.length) out.push({ severity: 'warn', rule: 'fx-jump', message: `one-day moves past ±${FX_DAY_WARN * 100}%: ${listOf(warnJumps)}` });
  if (stale.length) out.push({ severity: 'warn', rule: 'fx-stale', message: `rates more than ${FX_STALE_DAYS} days behind ${newest}: ${listOf(stale)}` });
  if (ratios.length) out.push({ severity: 'error', rule: 'adr-ratio', message: `ADR ratios that are not a positive number: ${listOf(ratios)}` });
  // known and handled — the site shows those trades in their own currency
  if (missing.size) out.push({ severity: 'info', rule: 'fx-missing', message: `issuer currencies with no rate series: ${[...missing].sort().join(', ')}` });
  return out;
}

// ---------------------------------------------------------------------------
// returns.json — 1-day, YTD and 1-year returns per ticker
// ---------------------------------------------------------------------------

// What one ticker can do is wide (a biotech doubles, a SPAC goes to zero);
// what the whole list does on one day is not. Names past these are listed
// for a human; a share of the list past them is a broken build.
export const RET_1D_EXTREME = 75;
export const RET_LONG_EXTREME = 1000;
export const RET_FLOOR_EXTREME = -99.5;
export const RET_EXTREME_SHARE = 0.02;
export const RET_MEDIAN_1D_MAX = 10;
export const RET_STALE_DAYS = 5;
export const RET_STALE_SHARE = 0.1;

const extremeReturn = (x) =>
  (fin(x?.ret1d) && Math.abs(x.ret1d) > RET_1D_EXTREME) ||
  (fin(x?.ret1y) && (x.ret1y > RET_LONG_EXTREME || x.ret1y <= RET_FLOOR_EXTREME)) ||
  (fin(x?.retYtd) && (x.retYtd > RET_LONG_EXTREME || x.retYtd <= RET_FLOOR_EXTREME));

export function returnsMetrics(d) {
  const rows = isObj(d?.returns) ? Object.values(d.returns) : [];
  return {
    tickers: rows.length,
    extreme: rows.filter(extremeReturn).length,
    // a NaN or Infinity serialises as null, so a non-number that is not null
    // is a string or an object where a return should be
    nonNumeric: rows.filter((x) => ['ret1d', 'retYtd', 'ret1y'].some((k) => x?.[k] != null && !fin(x[k]))).length,
  };
}

export function returnsChecks(d) {
  const out = [];
  const entries = isObj(d?.returns) ? Object.entries(d.returns) : [];
  if (!entries.length) return out;
  // the furthest out first: a 600,000% year is a broken series, a −99.6%
  // year may well be a company that failed
  const reach = (x) => Math.max(...['ret1d', 'retYtd', 'ret1y'].map((k) => (fin(x?.[k]) ? Math.abs(x[k]) : 0)));
  const extreme = entries.filter(([, x]) => extremeReturn(x)).sort((a, b) => reach(b[1]) - reach(a[1]));
  if (extreme.length) {
    const named = extreme.map(([t, x]) => `${t} (1d ${x.ret1d ?? '—'}%, YTD ${x.retYtd ?? '—'}%, 1y ${x.ret1y ?? '—'}%)`);
    out.push({ severity: 'warn', rule: 'returns-extreme', message: `returns to check against the chart (a missed split or a ticker that changed hands): ${listOf(named)}` });
  }
  if (extreme.length / entries.length > RET_EXTREME_SHARE) {
    out.push({
      severity: 'error',
      rule: 'returns-systemic',
      overridable: true,
      message: `${extreme.length} of ${entries.length} tickers carry an extreme return — more than ${RET_EXTREME_SHARE * 100}% is the price cache, not the market`,
    });
  }
  const med = median(entries.map(([, x]) => x?.ret1d));
  if (med != null && Math.abs(med) > RET_MEDIAN_1D_MAX) {
    out.push({ severity: 'error', rule: 'returns-systemic', overridable: true, message: `the median ticker moved ${med.toFixed(1)}% in a day` });
  }
  const dates = entries.map(([, x]) => x?.asOf).filter(Boolean);
  const newest = dates.reduce((a, b) => (b > a ? b : a), '');
  if (newest) {
    const behind = dates.filter((a) => (dayMs(newest) - dayMs(a)) / 86400000 > RET_STALE_DAYS).length;
    if (behind / entries.length > RET_STALE_SHARE) {
      out.push({ severity: 'warn', rule: 'returns-stale', message: `${behind} of ${entries.length} tickers are more than ${RET_STALE_DAYS} days behind ${newest}` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// prices/<SPY|QQQ|IWM>.json — the benchmarks every comparison is made against
// ---------------------------------------------------------------------------

// The worst day these three have had since 2008 is about 15% (QQQ, IWM in
// March 2020 and October 2008 sit under that). A benchmark that moves a
// fifth in a day has a bad print, and every guru's "vs SPY" inherits it.
export const BENCH_DAY_MAX = 0.2;

export function benchmarkMetrics(d) {
  return { rows: Array.isArray(d?.c) ? d.c.length : null };
}

export function benchmarkChecks(d) {
  const out = [];
  const c = Array.isArray(d?.c) ? d.c : [];
  const gaps = Array.isArray(d?.d) ? d.d : [];
  if (c.length !== gaps.length) {
    out.push({ severity: 'error', rule: 'bench-shape', message: `${c.length} closes against ${gaps.length} dates` });
    return out;
  }
  const bad = c.findIndex((x) => !(fin(x) && x > 0));
  if (bad >= 0) {
    out.push({ severity: 'error', rule: 'bench-shape', message: `close #${bad} is ${c[bad]}` });
    return out;
  }
  const badGap = gaps.findIndex((g, i) => (i === 0 ? g !== 0 : !(Number.isInteger(g) && g > 0)));
  if (badGap >= 0) out.push({ severity: 'error', rule: 'bench-shape', message: `date gap #${badGap} is ${gaps[badGap]}` });
  // day numbers only for the message; the gaps are cumulative from `from`
  const jumps = [];
  let t = d?.from ? dayMs(d.from) : NaN;
  for (let i = 0; i < c.length; i++) {
    if (i > 0) t += gaps[i] * 86400000;
    if (i > 0 && Math.abs(c[i] / c[i - 1] - 1) > BENCH_DAY_MAX) {
      const day = fin(t) ? new Date(t).toISOString().slice(0, 10) : `#${i}`;
      jumps.push(`${day} ${c[i - 1]}→${c[i]}`);
    }
  }
  if (jumps.length) {
    out.push({ severity: 'error', rule: 'bench-jump', overridable: true, message: `${d?.symbol || 'benchmark'} moved more than ${BENCH_DAY_MAX * 100}% in a day: ${listOf(jumps)}` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// ticker-meta.json — last price, 52-week range, sector, market cap
// ---------------------------------------------------------------------------

export function tickerMetaMetrics(d) {
  const rows = isObj(d) ? Object.values(d) : [];
  return {
    symbols: rows.length,
    priced: rows.filter((x) => fin(x?.px) && x.px > 0).length,
    // a 52-week low above its high is two fields swapped, never a market
    invertedRange: rows.filter((x) => fin(x?.lo) && fin(x?.hi) && x.lo > x.hi).length,
    negativeCap: rows.filter((x) => x?.mcap != null && !(fin(x.mcap) && x.mcap > 0)).length,
  };
}
