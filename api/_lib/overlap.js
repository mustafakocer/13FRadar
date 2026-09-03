// @ts-check
// Fund overlap analytics for 2..5 funds. Pure: takes already-loaded holdings.
import { classify } from './positionDiff.js';

/** @typedef {{ cusip: string, issuer: string, value: number, shares: number, weight: number, putCall?: string, ticker?: string|null }} Pos */
/** @typedef {{ cik: string, name: string, reportDate: string, cur: Pos[], prev: Pos[] | null }} FundInput */

/** @param {Pos[]} positions equity only, merged by cusip */
function equityMap(positions) {
  /** @type {Map<string, Pos>} */
  const m = new Map();
  for (const p of positions) {
    if (p.putCall) continue;
    const cur = m.get(p.cusip);
    if (cur) {
      cur.value += p.value;
      cur.shares += p.shares;
      cur.weight += p.weight;
    } else m.set(p.cusip, { ...p });
  }
  return m;
}

/** Jaccard index of two cusip sets. @param {Set<string>} a @param {Set<string>} b */
export function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Σ min(wA, wB) over shared cusips, in % of portfolio. @param {Map<string,Pos>} a @param {Map<string,Pos>} b */
export function weightedOverlap(a, b) {
  let s = 0;
  for (const [c, p] of a) {
    const q = b.get(c);
    if (q) s += Math.min(p.weight, q.weight);
  }
  return s;
}

/**
 * @param {FundInput[]} funds 2..5 funds
 * @param {{ uniqueLimit?: number, sharedLimit?: number }} [opts]
 */
export function computeOverlap(funds, opts = {}) {
  if (!Array.isArray(funds) || funds.length < 2 || funds.length > 5) {
    throw new Error('computeOverlap expects 2..5 funds');
  }
  const uniqueLimit = opts.uniqueLimit ?? 25;
  const sharedLimit = opts.sharedLimit ?? 200;

  const maps = funds.map((f) => equityMap(f.cur));
  const sets = maps.map((m) => new Set(m.keys()));
  const ciks = funds.map((f) => f.cik);

  // ---- shared / unique
  /** @type {Map<string, { cusip: string, issuer: string, ticker: string|null, weights: Record<string, number>, holders: number }>} */
  const byCusip = new Map();
  maps.forEach((m, i) => {
    for (const [c, p] of m) {
      const row = byCusip.get(c) || { cusip: c, issuer: p.issuer, ticker: p.ticker ?? null, weights: {}, holders: 0 };
      row.weights[ciks[i]] = p.weight;
      row.holders++;
      if (!row.ticker && p.ticker) row.ticker = p.ticker;
      byCusip.set(c, row);
    }
  });
  const shared = [...byCusip.values()]
    .filter((r) => r.holders >= 2)
    .map((r) => ({ ...r, all: r.holders === funds.length, sumWeight: Object.values(r.weights).reduce((s, w) => s + w, 0) }))
    .sort((a, b) => b.holders - a.holders || b.sumWeight - a.sumWeight)
    .slice(0, sharedLimit);
  const unique = Object.fromEntries(
    funds.map((f, i) => [
      f.cik,
      [...maps[i].values()]
        .filter((p) => byCusip.get(p.cusip)?.holders === 1)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, uniqueLimit)
        .map((p) => ({ cusip: p.cusip, issuer: p.issuer, ticker: p.ticker ?? null, weight: p.weight, value: p.value })),
    ])
  );

  // ---- similarity
  const pairs = [];
  for (let i = 0; i < funds.length; i++) {
    for (let j = i + 1; j < funds.length; j++) {
      let inter = 0;
      for (const c of sets[i]) if (sets[j].has(c)) inter++;
      pairs.push({
        a: ciks[i],
        b: ciks[j],
        jaccard: jaccard(sets[i], sets[j]),
        weightedOverlap: weightedOverlap(maps[i], maps[j]),
        shared: inter,
      });
    }
  }
  const union = new Set(sets.flatMap((s) => [...s]));
  let interAll = 0;
  for (const c of union) if (sets.every((s) => s.has(c))) interAll++;
  const overall = union.size ? interAll / union.size : 0;

  // ---- shared buys / sells in the latest quarter (needs prev filing)
  /** @type {Map<string, { cusip: string, issuer: string, ticker: string|null, buys: {cik:string, action:string, dSharesPct:number|null}[], sells: {cik:string, action:string, dSharesPct:number|null}[] }>} */
  const acts = new Map();
  funds.forEach((f, i) => {
    if (!f.prev) return;
    const prevMap = equityMap(f.prev);
    const curMap = maps[i];
    const all = new Set([...prevMap.keys(), ...curMap.keys()]);
    for (const c of all) {
      const p = prevMap.get(c) || null;
      const q = curMap.get(c) || null;
      const r = classify(
        p ? { reportDate: '', shares: p.shares, value: p.value, weight: p.weight } : null,
        q ? { reportDate: '', shares: q.shares, value: q.value, weight: q.weight } : null,
        true
      );
      if (r.action === 'HOLD' || r.action === 'NONE' || r.action === 'START') continue;
      const src = q || p;
      const row = acts.get(c) || { cusip: c, issuer: src?.issuer || '', ticker: src?.ticker ?? null, buys: [], sells: [] };
      (r.action === 'NEW' || r.action === 'ADD' ? row.buys : row.sells).push({ cik: f.cik, action: r.action, dSharesPct: r.dSharesPct });
      acts.set(c, row);
    }
  });
  const sharedBuys = [...acts.values()].filter((r) => r.buys.length >= 2).sort((a, b) => b.buys.length - a.buys.length).slice(0, 50);
  const sharedSells = [...acts.values()].filter((r) => r.sells.length >= 2).sort((a, b) => b.sells.length - a.sells.length).slice(0, 50);

  return {
    funds: funds.map((f, i) => ({ cik: f.cik, name: f.name, reportDate: f.reportDate, positions: sets[i].size, hasPrev: !!f.prev })),
    shared,
    sharedAllCount: shared.filter((r) => r.all).length,
    unique,
    pairs,
    overallJaccard: overall,
    sharedBuys,
    sharedSells,
  };
}
