// @ts-check
// Universe-wide per-stock aggregation used by the stock screener (P1-8).
// Fed by build-universe.mjs with each filer's latest and (optionally) prior
// filing. Everything here is EDGAR-only: sector = SIC code bucket, size =
// SEC-reported public float (dei:EntityPublicFloat), both cached weekly.
import { splitFactor } from './positionDiff.js';

/** @typedef {{ cusip: string, issuer: string, value: number, shares: number, weight: number, putCall?: string }} Pos */

/**
 * Accumulate one filer into the aggregate.
 * @param {Map<string, any>} agg
 * @param {Pos[]} cur latest filing positions
 * @param {Pos[] | null} prev prior filing positions (null = unknown)
 */
export function accumulateFiler(agg, cur, prev) {
  const blank = (/** @type {Pos} */ p) => ({ cusip: p.cusip, issuer: p.issuer, value: 0, funds: 0, adding: 0, reducing: 0, newCount: 0, exitCount: 0, holding: 0, netFlow: 0, diffFunds: 0 });
  const prevMap = prev ? new Map(prev.filter((p) => !p.putCall).map((p) => [p.cusip, p])) : null;
  const curSet = new Set();
  for (const p of cur) {
    if (p.putCall) continue;
    curSet.add(p.cusip);
    const a = agg.get(p.cusip) || blank(p);
    a.value += p.value;
    a.funds++;
    if (prevMap) {
      a.diffFunds++;
      const q = prevMap.get(p.cusip);
      const px = p.shares ? p.value / p.shares : 0;
      if (!q) {
        a.adding++;
        a.newCount++;
        a.netFlow += p.value;
      } else if (p.shares && q.shares) {
        const base = q.shares * splitFactor(q, p);
        const d = p.shares - base;
        if (d > base * 0.005) {
          a.adding++;
          a.netFlow += d * px;
        } else if (d < -base * 0.005) {
          a.reducing++;
          a.netFlow += d * px;
        } else a.holding++;
      } else {
        const d = p.value - q.value;
        if (d > 0) a.adding++;
        else if (d < 0) a.reducing++;
        else a.holding++;
        a.netFlow += d;
      }
    }
    agg.set(p.cusip, a);
  }
  if (prevMap) {
    for (const [c, q] of prevMap) {
      if (curSet.has(c)) continue;
      const a = agg.get(c) || blank(q);
      a.diffFunds++;
      a.reducing++;
      a.exitCount++;
      a.netFlow -= q.value;
      agg.set(c, a);
    }
  }
}

/** Consensus score in [-100, 100]: (adding − reducing) / (adding + reducing). Null when nobody traded. @param {{adding?: number, reducing?: number}} a */
export function consensusScore(a) {
  const n = (a.adding || 0) + (a.reducing || 0);
  return n ? Math.round((((a.adding || 0) - (a.reducing || 0)) / n) * 100) : null;
}

/** Finalise the aggregate into rows (largest total value first). @param {Map<string, any>} agg */
export function finalizeAgg(agg) {
  return [...agg.values()]
    .map((a) => ({ ...a, value: Math.round(a.value), netFlow: Math.round(a.netFlow), consensus: consensusScore(a) }))
    .sort((x, y) => y.value - x.value);
}

// SIC code → coarse sector bucket (SEC "Standard Industrial Classification").
// Specific ranges are listed before broad ones; first match wins.
const SIC_RANGES = [
  [100, 999, 'Agriculture'],
  [1300, 1399, 'Energy'],
  [1000, 1499, 'Mining'],
  [1500, 1799, 'Construction'],
  [2000, 2199, 'Consumer Staples'],
  [2833, 2836, 'Healthcare'],
  [2800, 2899, 'Materials'],
  [2900, 2999, 'Energy'],
  [3570, 3579, 'Technology'],
  [3600, 3699, 'Technology'],
  [3800, 3899, 'Healthcare'],
  [2000, 3999, 'Industrials'],
  [4800, 4899, 'Communication'],
  [4900, 4999, 'Utilities'],
  [4000, 4799, 'Transportation'],
  [5000, 5999, 'Consumer Discretionary'],
  [6500, 6599, 'Real Estate'],
  [6798, 6798, 'Real Estate'],
  [6000, 6999, 'Financials'],
  [7370, 7379, 'Technology'],
  [7000, 7999, 'Services'],
  [8000, 8099, 'Healthcare'],
  [8100, 8999, 'Services'],
  [9000, 9999, 'Other'],
];
/** @param {number|string|null|undefined} sic */
export function sicToSector(sic) {
  const n = Number(sic);
  if (!Number.isFinite(n) || n <= 0) return null;
  for (const [lo, hi, name] of SIC_RANGES) if (n >= Number(lo) && n <= Number(hi)) return String(name);
  return 'Other';
}

/** Latest public float from a companyconcept payload. @param {any} concept */
export function latestPublicFloat(concept) {
  const units = concept?.units?.USD || [];
  let best = null;
  for (const u of units) {
    if (!Number.isFinite(u.val)) continue;
    if (!best || u.end > best.end || (u.end === best.end && u.filed > best.filed)) best = u;
  }
  return best ? { value: best.val, asOf: best.end } : null;
}

/** Float band for filters. @param {number|null} f */
export function floatBand(f) {
  if (f == null) return null;
  if (f >= 200e9) return 'mega';
  if (f >= 10e9) return 'large';
  if (f >= 2e9) return 'mid';
  if (f >= 300e6) return 'small';
  return 'micro';
}
