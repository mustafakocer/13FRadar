// @ts-check
// Copy-the-13F backtest (P2-9). Honest assumption: a follower can only trade
// once a filing is public, so each quarter's weights are bought at the
// RELEASE date (quarter end + 45 days) and held until the next release.
import { quarterlySeries, equityCurve, maxDrawdown, cagr, releaseDate } from './performance.js';
import { quarterEnd } from './positionDiff.js';

/** @typedef {{ cik: string, name: string, snaps: { reportDate: string, aum: number, positions: { ticker: string|null, weight: number, value: number }[] }[] }} FundSeries */

/**
 * Align several funds' filings on a common quarter grid and combine them.
 * A fund missing a quarter simply drops out of that quarter's mix.
 * @param {FundSeries[]} funds @param {'aum'|'equal'} weighting @param {number} top positions kept per fund per quarter
 */
export function alignGroupSnapshots(funds, weighting = 'aum', top = 25) {
  /** @type {Map<string, { reportDate: string, members: { cik: string, aum: number, positions: { ticker: string|null, weight: number }[] }[] }>} */
  const byQ = new Map();
  for (const f of funds) {
    for (const s of f.snaps) {
      const q = quarterEnd(s.reportDate);
      const row = byQ.get(q) || { reportDate: q, members: [] };
      row.members.push({ cik: f.cik, aum: s.aum, positions: [...s.positions].sort((a, b) => b.weight - a.weight).slice(0, top).map((p) => ({ ticker: p.ticker, weight: p.weight })) });
      byQ.set(q, row);
    }
  }
  return [...byQ.values()]
    .sort((a, b) => (a.reportDate < b.reportDate ? -1 : 1))
    .map((row) => {
      const total = row.members.reduce((s, m) => s + (m.aum || 0), 0);
      /** @type {Map<string, number>} */
      const w = new Map();
      for (const m of row.members) {
        const share = weighting === 'equal' || !total ? 1 / row.members.length : (m.aum || 0) / total;
        const mTotal = m.positions.reduce((s, p) => s + p.weight, 0) || 1;
        for (const p of m.positions) {
          const key = p.ticker || `?${Math.random()}`;
          // re-normalise each member to 100% of its kept positions so the group sums to 100%
          w.set(key, (w.get(key) || 0) + share * (p.weight / mTotal) * 100);
        }
      }
      return { reportDate: row.reportDate, members: row.members.map((m) => m.cik), positions: [...w.entries()].map(([ticker, weight]) => ({ ticker: ticker.startsWith('?') ? null : ticker, weight })) };
    });
}

/**
 * @param {{ reportDate: string, positions: { ticker: string|null, weight: number }[] }[]} snapshots oldest -> newest
 * @param {(ticker: string, date: string) => number|null} px
 * @param {{ endDate: string, benchmark?: string }} o
 */
export function runBacktest(snapshots, px, o) {
  const series = quarterlySeries(snapshots, px, { mode: 'release', benchmark: o.benchmark || 'SPY', endDate: o.endDate, top: 100 });
  const curve = equityCurve(series);
  const usable = series.filter((q) => q.ret != null);
  const start = snapshots.length ? releaseDate(snapshots[0].reportDate) : null;
  const end = curve.length ? curve[curve.length - 1].date : null;
  const years = start && end ? (new Date(end).getTime() - new Date(start).getTime()) / (365.25 * 86400000) : 0;
  const total = curve.length ? curve[curve.length - 1].value - 1 : null;
  const benchTotal = curve.length && curve[curve.length - 1].bench != null ? /** @type {number} */ (curve[curve.length - 1].bench) - 1 : null;
  const benchCurve = curve.filter((p) => p.bench != null).map((p) => ({ value: /** @type {number} */ (p.bench) }));
  return {
    start,
    end,
    years: Number(years.toFixed(2)),
    quarters: usable.length,
    total,
    cagr: total != null && years > 0 ? cagr(total, years) : null,
    maxDrawdown: curve.length ? maxDrawdown(curve) : null,
    benchTotal,
    benchCagr: benchTotal != null && years > 0 ? cagr(benchTotal, years) : null,
    benchMaxDrawdown: benchCurve.length ? maxDrawdown(benchCurve) : null,
    coverage: usable.length ? usable.reduce((s, q) => s + q.coverage, 0) / usable.length : 0,
    series,
    curve,
  };
}
