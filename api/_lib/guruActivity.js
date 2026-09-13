// Pure helpers behind the quarterly guru activity pivot (/report).
//
// The build script owns the I/O; the arithmetic lives here so it can be
// tested without a 5 MB history file or a network call.

// EDGAR issuer strings carry bonds and notes the same way as equities, and a
// position whose CUSIP never resolved to a ticker is nothing a reader can
// click through to. Both are dropped rather than shown as noise.
const BOND = /\b(\d+(\.\d+)?%|note|notes|bond|debent|conv|sr\b|due\s|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/i;
export const isTradeable = (ticker, issuer) =>
  Boolean(ticker) && /^[A-Z][A-Z.\-]{0,6}$/.test(ticker) && !BOND.test(issuer || '');

// One quarter of aggregated activity per ticker.
//
// `cur` and `prev` map ticker -> { shares, value, perGuru: Map(cik -> shares) }.
// Buyers and sellers are counted per guru rather than inferred from how the
// holder count moved: a guru who doubles a position is a buyer even though the
// count did not change, and one who exits is a seller even though someone else
// arriving would hide it.
export function quarterDeltas(cur, prev = null) {
  const out = [];
  for (const [ticker, a] of cur) {
    const b = prev?.get(ticker) || null;
    const price = a.shares > 0 ? a.value / a.shares : 0;
    const dShares = a.shares - (b?.shares || 0);

    let buyers = 0;
    let sellers = 0;
    let fresh = 0;
    for (const [cik, shares] of a.perGuru) {
      const was = b?.perGuru.get(cik) ?? null;
      if (was == null) {
        fresh++;
        buyers++;
      } else if (shares > was) buyers++;
      else if (shares < was) sellers++;
    }
    if (b) for (const cik of b.perGuru.keys()) if (!a.perGuru.has(cik)) sellers++;

    out.push({
      t: ticker,
      g: a.perGuru.size,
      ng: fresh,
      sh: Math.round(a.shares),
      bs: dShares > 0 ? Math.round(dShares) : 0,
      ss: dShares < 0 ? Math.round(-dShares) : 0,
      nv: Math.round(dShares * price),
      tv: Math.round(a.value),
      b: buyers,
      s: sellers,
    });
  }
  return out;
}

// How much the gurus' combined position moved, relative to what they held
// going in. Null when they held none — that is a first entry, not a change.
export function pctChange(r) {
  const before = r.sh - r.bs + r.ss;
  return before > 0 ? ((r.bs - r.ss) / before) * 100 : null;
}
export const isFresh = (r) => r.sh - r.bs + r.ss <= 0 && r.bs > 0;

// Two or more buyers for every seller reads as the group leaning one way.
// The floor of two keeps a single trade from being called a consensus.
export function consensusOf(r) {
  if (r.b >= Math.max(2, r.s * 2)) return 'accumulating';
  if (r.s >= Math.max(2, r.b * 2)) return 'distributing';
  return 'neutral';
}

export const CAPS = [
  { v: 'mega', min: 200e9 },
  { v: 'large', min: 10e9, max: 200e9 },
  { v: 'mid', min: 2e9, max: 10e9 },
  { v: 'small', min: 300e6, max: 2e9 },
  { v: 'micro', max: 300e6 },
];
export function capBucket(marketCap) {
  if (!Number.isFinite(marketCap) || marketCap <= 0) return null;
  return CAPS.find((c) => marketCap >= (c.min ?? 0) && marketCap < (c.max ?? Infinity))?.v ?? null;
}
