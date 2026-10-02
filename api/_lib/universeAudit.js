// Checks on the universe against the filers' own words and against itself
// (scripts/audit-universe.mjs).
//
// compareTotal   our total for a filing vs the "Form 13F Information Table
//                Value Total" on its summary page, the declared figure put
//                through the same unit factor our table was (a filer that
//                wrote thousands wrote them in both places)
// overlapPairs   filers whose books are the same book: more than 90% of each
//                side's lines match the other's by CUSIP, put/call and share
//                count

export const TOTAL_TOLERANCE = 0.01;

export function compareTotal({ ours, declared, factor = 1 }) {
  if (!Number.isFinite(ours) || !Number.isFinite(declared) || declared <= 0) return { declaredAdj: null, diffPct: null, ok: null };
  const declaredAdj = declared * (factor || 1);
  const diffPct = (ours - declaredAdj) / declaredAdj;
  return { declaredAdj, diffPct, ok: Math.abs(diffPct) <= TOTAL_TOLERANCE };
}

export const lineKey = (p) => `${String(p.cusip || '').toUpperCase()}|${p.putCall || ''}|${Math.round(p.shares || 0)}`;

// books: [{ id, keys: string[] }] → [{ a, b, matched, shareA, shareB }]
// A key held by very many filers (a round lot of an index name) says nothing
// about two books being one; those are left out of the pairing and counted
// back as matches only when both books hold them.
export function overlapPairs(books, { min = 0.9, minLines = 10, maxHolders = 200 } = {}) {
  const holders = new Map();
  books.forEach((b, i) => {
    for (const k of new Set(b.keys)) {
      let h = holders.get(k);
      if (!h) holders.set(k, (h = []));
      h.push(i);
    }
  });
  const counts = new Map();
  for (const h of holders.values()) {
    if (h.length < 2 || h.length > maxHolders) continue;
    for (let x = 0; x < h.length; x++) {
      for (let y = x + 1; y < h.length; y++) {
        const key = h[x] * 1e6 + h[y];
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  const out = [];
  for (const [key, c] of counts) {
    const a = Math.floor(key / 1e6);
    const b = key % 1e6;
    const A = new Set(books[a].keys);
    const B = new Set(books[b].keys);
    if (A.size < minLines || B.size < minLines) continue;
    // a quick bound before the exact count
    if (c < min * Math.max(A.size, B.size) * 0.5) continue;
    let matched = 0;
    const [small, large] = A.size <= B.size ? [A, B] : [B, A];
    for (const k of small) if (large.has(k)) matched++;
    const shareA = matched / A.size;
    const shareB = matched / B.size;
    if (shareA > min && shareB > min) out.push({ a: books[a].id, b: books[b].id, matched, shareA, shareB });
  }
  return out;
}

// The declared total of a period whose filing was amended, the way the
// effective snapshot reads the tables: a RESTATEMENT replaces the total, a
// NEW HOLDINGS amendment adds to it. `amendments`: oldest first, each
// { type, total } (type from the latest-holdings record or the cover page).
// Null when a needed total is missing.
export function effectiveDeclared(base, amendments = []) {
  let total = Number.isFinite(base) ? base : null;
  for (const a of amendments) {
    const t = Number.isFinite(a?.total) ? a.total : null;
    if (/^RESTATEMENT$/i.test(a?.type || '')) total = t;
    else if (/^NEW HOLDINGS$/i.test(a?.type || '')) total = total == null || t == null ? null : total + t;
    else total = null;
  }
  return total;
}

// Our stored total against a fresh read of the same filing (full table,
// amendments applied, unit judged on every priced line): a pure unit slip
// the stored copy missed is a factor of 1000 either way.
export function storedUnitSlip(stored, fresh) {
  if (!(stored > 0) || !(fresh > 0)) return null;
  const r = fresh / stored;
  if (Math.abs(r / 1000 - 1) <= 0.001) return 1000;
  if (Math.abs(r * 1000 - 1) <= 0.001) return 0.001;
  return null;
}
