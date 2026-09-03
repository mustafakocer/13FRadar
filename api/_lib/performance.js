// @ts-check
// Hypothetical performance of a 13F portfolio. Shared by the fund
// performance score (P1-7: hold quarter-end weights from quarter end to the
// next quarter end) and the backtester (P2-9: rebalance at the RELEASE date,
// 45 days after quarter end, which is when the public could actually copy it).
//
// Period return = Σ w_i × (P_i(t1) / P_i(t0) − 1) over positions with prices,
// divided by the covered weight (positions without prices are dropped and the
// rest re-normalised). Dividends are excluded; prices are regular closes.
import { nextQuarterEnd } from './positionDiff.js';

/** @typedef {{ date: string, close: number }} Bar */
/** @typedef {{ reportDate: string, filingDate?: string, positions: { ticker: string|null, weight: number }[] }} Snapshot */

/** Close on or before `date` (within `maxGapDays`), binary search on an ascending series.
 * @param {Bar[]} series @param {string} date @param {number} [maxGapDays] */
export function priceAt(series, date, maxGapDays = 10) {
  if (!series?.length) return null;
  let lo = 0;
  let hi = series.length - 1;
  if (series[0].date > date) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (series[mid].date <= date) lo = mid;
    else hi = mid - 1;
  }
  const bar = series[lo];
  const gap = (new Date(date).getTime() - new Date(bar.date).getTime()) / 86400000;
  return gap <= maxGapDays ? bar.close : null;
}

/** @param {string} date @param {number} days */
export function addDays(date, days) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Release date used for the backtester: quarter end + 45 days (46th day is the deadline). @param {string} reportDate */
export const releaseDate = (reportDate) => addDays(reportDate, 45);

/**
 * Return of holding `positions` from t0 to t1.
 * @param {{ ticker: string|null, weight: number }[]} positions weights in %
 * @param {(ticker: string, date: string) => number|null} px
 * @param {string} t0 @param {string} t1 @param {number} [top] use only the largest `top` positions
 */
export function periodReturn(positions, px, t0, t1, top = 100) {
  let covered = 0;
  let acc = 0;
  let total = 0;
  const list = [...positions].sort((a, b) => b.weight - a.weight).slice(0, top);
  for (const p of list) {
    total += p.weight;
    if (!p.ticker) continue;
    const a = px(p.ticker, t0);
    const b = px(p.ticker, t1);
    if (!a || !b) continue;
    covered += p.weight;
    acc += p.weight * (b / a - 1);
  }
  return { ret: covered > 0 ? acc / covered : null, coverage: total > 0 ? covered / total : 0 };
}

/**
 * Quarter-by-quarter series.
 * @param {Snapshot[]} snapshots oldest -> newest
 * @param {(ticker: string, date: string) => number|null} px
 * @param {{ mode?: 'quarterEnd'|'release', top?: number, endDate?: string, benchmark?: string }} [o]
 */
export function quarterlySeries(snapshots, px, o = {}) {
  const mode = o.mode || 'quarterEnd';
  const out = [];
  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i];
    const next = snapshots[i + 1];
    const t0 = mode === 'release' ? releaseDate(s.reportDate) : s.reportDate;
    let t1 = next ? (mode === 'release' ? releaseDate(next.reportDate) : next.reportDate) : mode === 'release' ? releaseDate(nextQuarterEnd(s.reportDate)) : nextQuarterEnd(s.reportDate);
    if (o.endDate && t1 > o.endDate) t1 = o.endDate;
    if (t1 <= t0) continue;
    const r = periodReturn(s.positions, px, t0, t1, o.top);
    const bench = o.benchmark ? (() => {
      const a = px(/** @type {string} */ (o.benchmark), t0);
      const b = px(/** @type {string} */ (o.benchmark), t1);
      return a && b ? b / a - 1 : null;
    })() : null;
    out.push({ reportDate: s.reportDate, from: t0, to: t1, ret: r.ret, coverage: r.coverage, bench });
  }
  return out;
}

/** Compound the last `n` period returns (null if fewer than n usable). @param {{ret: number|null}[]} series @param {number} n */
export function compound(series, n) {
  const last = series.slice(-n);
  if (last.length < n || last.some((q) => q.ret == null)) return null;
  return last.reduce((acc, q) => acc * (1 + /** @type {number} */ (q.ret)), 1) - 1;
}

/** Equity curve starting at 1. @param {{ to: string, ret: number|null, bench: number|null }[]} series */
export function equityCurve(series) {
  let v = 1;
  let b = 1;
  const out = [];
  for (const q of series) {
    if (q.ret == null) break;
    v *= 1 + q.ret;
    if (q.bench != null) b *= 1 + q.bench;
    out.push({ date: q.to, value: v, bench: q.bench != null ? b : null });
  }
  return out;
}

/** @param {{ value: number }[]} curve */
export function maxDrawdown(curve) {
  let peak = -Infinity;
  let mdd = 0;
  for (const p of curve) {
    peak = Math.max(peak, p.value);
    mdd = Math.min(mdd, p.value / peak - 1);
  }
  return mdd;
}

/** @param {number} total total return (0.5 = +50%) @param {number} years */
export function cagr(total, years) {
  return years > 0 ? Math.pow(1 + total, 1 / years) - 1 : null;
}

/** Percentile rank in [0,100] of x among values (higher = better). @param {number} x @param {number[]} values */
export function percentile(x, values) {
  const v = values.filter((y) => Number.isFinite(y));
  if (!v.length) return null;
  const below = v.filter((y) => y < x).length;
  const equal = v.filter((y) => y === x).length;
  return Math.round(((below + 0.5 * equal) / v.length) * 100);
}

/** Composite score: mean of the available percentile ranks of 1Y and 3Y returns.
 * @param {{ ret1y: number|null, ret3y: number|null }} f @param {{ ret1y: number|null, ret3y: number|null }[]} all */
export function scoreFund(f, all) {
  const parts = [];
  if (f.ret1y != null) parts.push(percentile(f.ret1y, all.map((x) => /** @type {number} */ (x.ret1y)).filter((x) => x != null)));
  if (f.ret3y != null) parts.push(percentile(f.ret3y, all.map((x) => /** @type {number} */ (x.ret3y)).filter((x) => x != null)));
  const nums = parts.filter((p) => p != null);
  return nums.length ? Math.round(nums.reduce((s, p) => s + /** @type {number} */ (p), 0) / nums.length) : null;
}
