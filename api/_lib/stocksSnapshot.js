// @ts-check
// Quarter-over-quarter snapshot rotation for client/public/stocks.json.
// The universe build only sees each filer's LATEST filing, so QoQ change in
// institutional ownership comes from keeping the previous build's file when
// the reporting period advances.

/** Report period implied by a filing date: 13Fs are due 45 days after quarter
 * end, so the period is the quarter containing (filed - 46 days).
 * @param {string} filedDate YYYY-MM-DD */
export function periodForFiling(filedDate) {
  const d = new Date(filedDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 46);
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  const end = [31, 30, 30, 31][q - 1];
  return `${y}-${String(q * 3).padStart(2, '0')}-${end}`;
}

/** Most common period among filers. @param {string[]} filedDates */
export function dominantPeriod(filedDates) {
  /** @type {Map<string, number>} */
  const n = new Map();
  for (const f of filedDates) {
    const p = periodForFiling(f);
    n.set(p, (n.get(p) || 0) + 1);
  }
  let best = '';
  let bestN = -1;
  for (const [p, c] of n) if (c > bestN || (c === bestN && p > best)) [best, bestN] = [p, c];
  return best;
}

/**
 * Decide what the previous-quarter snapshot should be after a new build.
 * @param {{ period?: string } | null} existingCurrent  stocks.json on disk before the build
 * @param {{ period?: string } | null} existingPrev     stocks-prev.json on disk
 * @param {string} newPeriod
 * @returns {{ prev: any, rotated: boolean }}
 */
export function rotateSnapshot(existingCurrent, existingPrev, newPeriod) {
  if (existingCurrent?.period && existingCurrent.period < newPeriod) return { prev: existingCurrent, rotated: true };
  return { prev: existingPrev || null, rotated: false };
}

/** Attach QoQ deltas to current rows using the previous snapshot.
 * @param {{ cusip: string, funds: number, value: number }[]} rows
 * @param {{ rows?: { cusip: string, funds: number, value: number }[] } | null} prev */
export function withDeltas(rows, prev) {
  const m = new Map((prev?.rows || []).map((r) => [r.cusip, r]));
  return rows.map((r) => {
    const p = m.get(r.cusip);
    return { ...r, dFunds: p ? r.funds - p.funds : null, dValue: p ? r.value - p.value : null };
  });
}
