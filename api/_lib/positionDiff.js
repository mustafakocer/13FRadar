// @ts-check
// Position history on a complete quarter grid with NEW / ADD / REDUCE / EXIT /
// HOLD actions derived by diffing consecutive FILED quarters.
//
// Edge cases handled:
//  - quarters with no filing (fund skipped or filed late): present in the grid
//    with filed=false, never counted as EXIT; the diff skips over them
//  - first appearance inside the loaded window: NEW only if an earlier filed
//    quarter exists without the position; otherwise START (unknown history)
//  - disappearance: EXIT row (held=false) on the first filed quarter without it
//  - re-entry after an EXIT: NEW again
//  - stock splits: share ratio ≈ inverse price ratio -> treated as HOLD
//  - zero/missing share counts: fall back to value change

/** @typedef {{ reportDate: string, shares: number, value: number, weight: number }} Snap */
/** @typedef {'START'|'NEW'|'ADD'|'REDUCE'|'HOLD'|'EXIT'|'NONE'} Action */

/** Quarter-end date string for the quarter containing `date`. @param {string} date */
export function quarterEnd(date) {
  const [y, m] = date.split('-').map(Number);
  const q = Math.ceil(m / 3);
  const end = [31, 30, 30, 31][q - 1];
  return `${y}-${String(q * 3).padStart(2, '0')}-${end}`;
}

/** @param {string} qe quarter end -> next quarter end */
export function nextQuarterEnd(qe) {
  const [y, m] = qe.split('-').map(Number);
  return m === 12 ? quarterEnd(`${y + 1}-03-01`) : quarterEnd(`${y}-${String(m + 3).padStart(2, '0')}-01`);
}

/** All quarter-ends from min to max of the given report dates (inclusive).
 * @param {string[]} reportDates */
export function quarterGrid(reportDates) {
  if (!reportDates.length) return [];
  const ends = reportDates.map(quarterEnd).sort();
  const out = [];
  for (let q = ends[0]; q <= ends[ends.length - 1]; q = nextQuarterEnd(q)) out.push(q);
  return out;
}

const NOISE = 0.005; // <0.5% share change is rounding, not a trade

const SPLIT_RATIOS = [2, 3, 4, 5, 6, 7, 8, 10, 15, 20, 25, 30, 40, 50];

/**
 * Detect a stock split between two quarter-end snapshots. A split shows up as
 * the implied price (value / shares) dropping by a common ratio while the
 * share count rises by a similar ratio (reverse split: the opposite). The
 * factor comes from the PRICE ratio, so a split combined with a trade still
 * yields the trade (shares - prevShares x factor). Returns 1 when no split.
 * @param {{shares:number, value:number}} prev @param {{shares:number, value:number}} cur
 */
export function splitFactor(prev, cur) {
  if (!prev.shares || !cur.shares || !prev.value || !cur.value) return 1;
  const sr = cur.shares / prev.shares;
  const pr = prev.value / prev.shares / (cur.value / cur.shares);
  if (!(pr > 0)) return 1;
  const forward = pr >= 1.9 && sr >= 1.9;
  const reverse = pr <= 0.55 && sr <= 0.55;
  if (!forward && !reverse) return 1;
  const ratio = forward ? pr : 1 / pr;
  const near = SPLIT_RATIOS.find((r) => Math.abs(ratio / r - 1) <= 0.1);
  if (!near) return 1;
  return forward ? near : 1 / near;
}

/** @param {Snap} prev @param {Snap} cur */
export function splitAdjustedPrevShares(prev, cur) {
  return (prev.shares || 0) * splitFactor(prev, cur);
}

/**
 * @param {Snap | null} prev  last FILED quarter's snapshot (null = not held)
 * @param {Snap | null} cur   this quarter's snapshot (null = not held)
 * @param {boolean} hasPrevFiled whether any earlier filed quarter exists
 * @returns {{ action: Action, dShares: number | null, dSharesPct: number | null }}
 */
export function classify(prev, cur, hasPrevFiled) {
  if (!cur) {
    return prev ? { action: 'EXIT', dShares: -(prev.shares || 0), dSharesPct: -100 } : { action: 'NONE', dShares: null, dSharesPct: null };
  }
  if (!prev) {
    return hasPrevFiled
      ? { action: 'NEW', dShares: cur.shares || null, dSharesPct: null }
      : { action: 'START', dShares: null, dSharesPct: null };
  }
  if (!cur.shares || !prev.shares) {
    const d = (cur.value || 0) - (prev.value || 0);
    const pct = prev.value ? (d / prev.value) * 100 : null;
    if (Math.abs(pct ?? 0) <= NOISE * 100) return { action: 'HOLD', dShares: 0, dSharesPct: 0 };
    return { action: d > 0 ? 'ADD' : 'REDUCE', dShares: null, dSharesPct: pct };
  }
  const base = splitAdjustedPrevShares(prev, cur);
  const d = cur.shares - base;
  if (Math.abs(d) <= base * NOISE) return { action: 'HOLD', dShares: 0, dSharesPct: 0 };
  return { action: d > 0 ? 'ADD' : 'REDUCE', dShares: d, dSharesPct: base ? (d / base) * 100 : null };
}

/**
 * Build the timeline.
 * @param {{ reportDate: string, snap: Snap | null }[]} filed  one entry per FILED quarter (any order)
 * @returns {{ reportDate: string, filed: boolean, held: boolean, shares: number|null, value: number|null, weight: number|null, action: Action, dShares: number|null, dSharesPct: number|null }[]}
 */
export function buildTimeline(filed) {
  const byQ = new Map();
  for (const f of filed) byQ.set(quarterEnd(f.reportDate), f);
  const grid = quarterGrid(filed.map((f) => f.reportDate));
  /** @type {Snap | null} */
  let prev = null;
  let hasPrevFiled = false;
  return grid.map((q) => {
    const f = byQ.get(q);
    if (!f) {
      return { reportDate: q, filed: false, held: false, shares: null, value: null, weight: null, action: /** @type {Action} */ ('NONE'), dShares: null, dSharesPct: null };
    }
    const cur = f.snap;
    const c = classify(prev, cur, hasPrevFiled);
    prev = cur;
    hasPrevFiled = true;
    return {
      reportDate: q,
      filed: true,
      held: !!cur,
      shares: cur ? cur.shares : null,
      value: cur ? cur.value : null,
      weight: cur ? cur.weight : null,
      action: c.action,
      dShares: c.dShares,
      dSharesPct: c.dSharesPct,
    };
  });
}
