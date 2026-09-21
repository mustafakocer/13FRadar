// Portfolio turnover — the one definition every page and build uses.
//
//   turnover% = traded / average book × 100
//   traded    = Σ value of positions opened this quarter
//             + Σ value (previous quarter) of positions closed
//             + Σ |Δ shares| × this quarter's implied price, for names held
//               in both quarters
//   average book = (previous AUM + current AUM) / 2
//
// It is a trading measure, not a value-change measure: a name that merely
// went up contributes nothing, a name that was doubled contributes the
// dollar value of the shares bought. Equity lines only (the caller drops
// PUT/CALL rows); a snapshot is an effective one (amendments applied), so
// an amendment never shows up as a quarter of 200% turnover.
//
// The counts travel with the number so a page can never show "0% turnover"
// next to "1 new · 1 exited": a quarter with any opened or closed position
// has a positive turnover, however small.
//
// `idOf(position)` names the security: the ticker from the security master
// when the caller has one, so a CUSIP that changed under a position (a
// reorganisation, a new share class) is the same holding and not an exit
// plus a new position — which would count the whole stake twice.
export function turnover(prev, cur, { idOf = null } = {}) {
  if (!prev || !cur) return { turnover: null, traded: null, newCount: 0, exitCount: 0, addCount: 0, reduceCount: 0 };
  const key = (p) => (idOf && idOf(p)) || `${String(p.cusip || '').toUpperCase()}`;
  const before = new Map();
  for (const p of prev.positions || []) before.set(key(p), p);
  const after = new Map();
  for (const p of cur.positions || []) after.set(key(p), p);

  let traded = 0;
  let newCount = 0;
  let exitCount = 0;
  let addCount = 0;
  let reduceCount = 0;
  for (const [k, p] of after) {
    const q = before.get(k);
    if (!q) {
      traded += p.value || 0;
      newCount++;
      continue;
    }
    const d = (p.shares || 0) - (q.shares || 0);
    if (d === 0) continue;
    const px = p.shares > 0 ? (p.value || 0) / p.shares : q.shares > 0 ? (q.value || 0) / q.shares : 0;
    traded += Math.abs(d) * px;
    if (d > 0) addCount++;
    else reduceCount++;
  }
  for (const [k, q] of before) {
    if (after.has(k)) continue;
    traded += q.value || 0;
    exitCount++;
  }
  const avg = ((prev.aum || 0) + (cur.aum || 0)) / 2;
  return {
    turnover: avg > 0 ? Number(((traded / avg) * 100).toFixed(2)) : null,
    traded: Math.round(traded),
    newCount,
    exitCount,
    addCount,
    reduceCount,
  };
}

// Consecutive quarters a security has been held up to and including the
// latest one, over a series of held-security sets (oldest first). A
// security is identified by the caller's key — a ticker when the CUSIP is
// resolvable, so a CUSIP change (a split, a reorganisation, a ticker
// change) does not read as a sale and a new purchase.
export function heldQuarters(sets, id) {
  let held = 0;
  for (let i = sets.length - 1; i >= 0 && sets[i].has(id); i--) held++;
  return held;
}
