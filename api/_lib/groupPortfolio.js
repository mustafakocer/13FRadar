// @ts-check
// Combined "super fund" portfolio for a group of managers.
//   weighting = 'aum'   -> each fund contributes in proportion to its reported AUM
//   weighting = 'equal' -> each fund contributes 1/n regardless of size
// Also aggregates this-quarter trades (NEW/ADD/REDUCE/EXIT per fund).
import { diffFilings } from './alerts.js';

/** @typedef {{ cusip: string, issuer: string, ticker?: string|null, value: number, shares: number, weight: number, putCall?: string }} Pos */
/** @typedef {{ cik: string, name: string, reportDate: string, aum: number, positions: Pos[], prev: Pos[] | null }} FundIn */

/**
 * @param {FundIn[]} funds
 * @param {'aum'|'equal'} weighting
 * @param {{ top?: number }} [opts]
 */
export function combinePortfolio(funds, weighting = 'aum', opts = {}) {
  if (!funds.length) return { weighting, funds: [], positions: [], totalAum: 0, trades: { NEW: [], ADD: [], REDUCE: [], EXIT: [] } };
  const top = opts.top ?? 100;
  const totalAum = funds.reduce((s, f) => s + (f.aum || 0), 0);
  const share = (/** @type {FundIn} */ f) =>
    weighting === 'equal' ? 1 / funds.length : totalAum ? (f.aum || 0) / totalAum : 1 / funds.length;

  /** @type {Map<string, { cusip: string, issuer: string, ticker: string|null, weight: number, value: number, holders: { cik: string, name: string, weight: number }[] }>} */
  const agg = new Map();
  for (const f of funds) {
    const s = share(f);
    for (const p of f.positions) {
      if (p.putCall) continue;
      const row = agg.get(p.cusip) || { cusip: p.cusip, issuer: p.issuer, ticker: p.ticker ?? null, weight: 0, value: 0, holders: [] };
      row.weight += s * p.weight;
      // equal weighting re-scales dollars so each fund counts as totalAum / n
      row.value += weighting === 'equal' ? (p.weight / 100) * (totalAum / funds.length) : p.value;
      row.holders.push({ cik: f.cik, name: f.name, weight: p.weight });
      if (!row.ticker && p.ticker) row.ticker = p.ticker;
      agg.set(p.cusip, row);
    }
  }
  const positions = [...agg.values()]
    .map((r) => ({ ...r, holders: r.holders.sort((a, b) => b.weight - a.weight), holderCount: r.holders.length }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, top);

  /** @type {Record<'NEW'|'ADD'|'REDUCE'|'EXIT', { cusip: string, issuer: string, ticker: string|null, funds: { cik: string, name: string, dSharesPct: number|null, value: number }[] }[]>} */
  const trades = { NEW: [], ADD: [], REDUCE: [], EXIT: [] };
  /** @type {Map<string, any>} */
  const tradeMap = new Map();
  for (const f of funds) {
    if (!f.prev) continue;
    const d = diffFilings(f.prev, f.positions);
    for (const k of /** @type {const} */ (['NEW', 'ADD', 'REDUCE', 'EXIT'])) {
      for (const c of d[k]) {
        const key = `${k}|${c.cusip}`;
        const row = tradeMap.get(key) || { cusip: c.cusip, issuer: c.issuer, ticker: c.ticker ?? null, funds: [] };
        row.funds.push({ cik: f.cik, name: f.name, dSharesPct: c.dSharesPct, value: c.value });
        tradeMap.set(key, row);
        if (!trades[k].includes(row)) trades[k].push(row);
      }
    }
  }
  for (const k of /** @type {const} */ (['NEW', 'ADD', 'REDUCE', 'EXIT'])) {
    trades[k].sort((a, b) => b.funds.length - a.funds.length || b.funds.reduce((s, x) => s + x.value, 0) - a.funds.reduce((s, x) => s + x.value, 0));
    trades[k] = trades[k].slice(0, 30);
  }

  return {
    weighting,
    totalAum,
    funds: funds.map((f) => ({ cik: f.cik, name: f.name, reportDate: f.reportDate, aum: f.aum, share: share(f), positions: f.positions.filter((p) => !p.putCall).length, hasPrev: !!f.prev })),
    positions,
    trades,
  };
}
