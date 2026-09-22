// The arithmetic behind the compare page, pure so it runs in node tests.
//
// A "book" is what /api/holdings answers: { positions: [{ cusip, ticker,
// issuer, weight (% of the book), shares, value }], aum, count }. The free
// tier's book is the top ten rows, so every number here says what it was
// computed over rather than pretending to be the whole portfolio.
const num = (v) => (Number.isFinite(v) ? v : Number(v) || 0);

// Which way a position moved since the previous quarter: 'new' (not held
// before), 'up' / 'down' (shares), 'flat', or null when the previous
// quarter is unknown for it (the free tier only sees ten rows of it).
export function direction(prevShares, shares) {
  if (prevShares === undefined) return null;
  if (prevShares === null || prevShares === 0) return 'new';
  if (!Number.isFinite(shares)) return null;
  if (shares > prevShares) return 'up';
  if (shares < prevShares) return 'down';
  return 'flat';
}

// prev: a previous-quarter book (light rows are fine), possibly filtered to
// a few CUSIPs. Returns cusip → shares for what it carries; a CUSIP it does
// not carry is `null` when the book is complete (an exit or a new name)
// and `undefined` when the book was filtered (unknown).
export function previousShares(prev, { complete = true } = {}) {
  const m = new Map();
  for (const p of prev?.positions || []) m.set(p.cusip, num(p.shares));
  return (cusip) => (m.has(cusip) ? m.get(cusip) : complete ? null : undefined);
}

export function compareBooks(A, B, { prevA = null, prevB = null, prevComplete = true } = {}) {
  const pa = A?.positions || [];
  const pb = B?.positions || [];
  const mapB = new Map(pb.map((p) => [p.cusip, p]));
  const psA = previousShares(prevA, { complete: prevComplete });
  const psB = previousShares(prevB, { complete: prevComplete });
  const common = [];
  const onlyA = [];
  const seen = new Set();
  for (const p of pa) {
    const q = mapB.get(p.cusip);
    const row = { key: p.cusip, cusip: p.cusip, ticker: p.ticker || q?.ticker || null, issuer: p.issuer || q?.issuer || null };
    if (q) {
      seen.add(p.cusip);
      const wA = num(p.weight);
      const wB = num(q.weight);
      common.push({
        ...row,
        wA,
        wB,
        delta: wA - wB,
        dirA: prevA ? direction(psA(p.cusip), num(p.shares)) : null,
        dirB: prevB ? direction(psB(q.cusip), num(q.shares)) : null,
      });
    } else onlyA.push({ ...row, wA: num(p.weight) });
  }
  const onlyB = pb.filter((p) => !seen.has(p.cusip)).map((p) => ({ key: p.cusip, cusip: p.cusip, ticker: p.ticker || null, issuer: p.issuer || null, wB: num(p.weight) }));
  common.sort((x, y) => y.wA + y.wB - (x.wA + x.wB));
  onlyA.sort((x, y) => y.wA - x.wA);
  onlyB.sort((x, y) => y.wB - x.wB);
  const union = pa.length + pb.length - common.length;
  const top10 = (rows) => rows.slice(0, 10).reduce((s, p) => s + num(p.weight), 0);
  return {
    common,
    onlyA,
    onlyB,
    // share of the names either book holds that both hold
    jaccard: union ? (common.length / union) * 100 : 0,
    // the weight the two books have in the same names: Σ min(wA, wB)
    weightedOverlap: common.reduce((s, r) => s + Math.min(r.wA, r.wB), 0),
    sizeA: A?.aum ?? null,
    sizeB: B?.aum ?? null,
    countA: A?.count ?? pa.length,
    countB: B?.count ?? pb.length,
    top10A: top10(pa),
    top10B: top10(pb),
  };
}

// Two sector mixes side by side: one row per sector either book has, the
// larger share first. `mixA`/`mixB` are sectorSlices(...).data.
export function sectorPairs(mixA, mixB) {
  const rows = new Map();
  for (const d of mixA || []) rows.set(d.name, { name: d.name, a: d.value, b: 0, unclassified: Boolean(d.unclassified) });
  for (const d of mixB || []) {
    const r = rows.get(d.name) || { name: d.name, a: 0, b: 0, unclassified: Boolean(d.unclassified) };
    r.b = d.value;
    rows.set(d.name, r);
  }
  return [...rows.values()].sort((x, y) => (x.unclassified ? 1 : y.unclassified ? -1 : Math.max(y.a, y.b) - Math.max(x.a, x.b)));
}
