// What a manager bought and sold between two filings — the one computation
// behind the guru page's FAQ, its "Changes" tab and the holdings API.
//
// By share count, not by weight: a position that only moved with its price
// is neither bought nor sold. Keyed by the ticker when one is known (else the
// CUSIP) and put/call, so a call on a stock is a separate line from the
// stock, and a security whose CUSIP changed under the holder — Carnival's
// redomicile (143658300 → G2004J103), Lam's split, TE Connectivity's move to
// Ireland — is one continuous holding, not an exit plus a new position. Two
// lines of one book that land on the same key are added together. Both
// books must be complete: a
// line missing from the current book is an exit, so comparing a full
// previous book with a top-10 extract (the bug this replaced) calls every
// holding outside the top 10 "sold out".
//
//   new      held now, not before
//   added    more shares than before
//   reduced  fewer shares, still held
//   exited   held before, not now
export const keyOf = (p) => `${String(p.ticker || p.cusip || '').toUpperCase()}|${p.putCall || ''}`;

// One line per key: shares, value and weight summed; the identity of the
// largest line wins (the CUSIP the holder files most of it under).
function byKey(book) {
  const out = new Map();
  for (const p of book) {
    const k = keyOf(p);
    const a = out.get(k);
    if (!a) out.set(k, p);
    else {
      const big = (p.value || 0) > (a.value || 0) ? p : a;
      out.set(k, { ...big, shares: (a.shares || 0) + (p.shares || 0), value: (a.value || 0) + (p.value || 0), weight: (a.weight || 0) + (p.weight || 0) });
    }
  }
  return out;
}

const line = (cur, prev) => {
  const shares = cur?.shares ?? 0;
  const prevShares = prev?.shares ?? 0;
  return {
    cusip: (cur || prev).cusip,
    ...((cur || prev).putCall ? { putCall: (cur || prev).putCall } : {}),
    ticker: cur?.ticker ?? prev?.ticker ?? null,
    issuer: cur?.issuer ?? prev?.issuer ?? '',
    shares,
    prevShares,
    value: cur?.value ?? 0,
    prevValue: prev?.value ?? 0,
    weight: cur?.weight ?? 0,
    prevWeight: prev?.weight ?? 0,
    // share change in percent (null for a new line)
    pct: prevShares > 0 ? Number((((shares - prevShares) / prevShares) * 100).toFixed(1)) : null,
  };
};

export function portfolioChanges(current, previous) {
  if (!Array.isArray(current) || !Array.isArray(previous)) return null;
  const prev = byKey(previous);
  const cur = byKey(current);
  const out = { new: [], added: [], reduced: [], exited: [] };
  for (const [k, p] of cur) {
    const q = prev.get(k);
    if (!q) out.new.push(line(p, null));
    else if (p.shares > q.shares) out.added.push(line(p, q));
    else if (p.shares < q.shares) out.reduced.push(line(p, q));
  }
  for (const [k, q] of prev) if (!cur.has(k)) out.exited.push(line(null, q));
  // biggest first: by the money that moved
  const moved = (x) => Math.abs(x.value - (x.prevShares > 0 && x.shares > 0 ? (x.value * x.prevShares) / x.shares : x.prevValue));
  out.new.sort((a, b) => b.value - a.value);
  out.added.sort((a, b) => moved(b) - moved(a));
  out.reduced.sort((a, b) => moved(b) - moved(a));
  out.exited.sort((a, b) => b.prevValue - a.prevValue);
  out.counts = { new: out.new.length, added: out.added.length, reduced: out.reduced.length, exited: out.exited.length };
  return out;
}

// The free view: counts stay true, each list keeps its first `n` lines.
export function trimChanges(ch, n) {
  if (!ch) return ch;
  return { ...ch, new: ch.new.slice(0, n), added: ch.added.slice(0, n), reduced: ch.reduced.slice(0, n), exited: ch.exited.slice(0, n), trimmed: n };
}

export const changeLabel = (p) => p.ticker || p.issuer;
