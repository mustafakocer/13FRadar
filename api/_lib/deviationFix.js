// What the nightly check (scripts/check-universe-audit.mjs) does by itself
// about a total that does not match the filer's own cover page, before a
// person looks at it. Pure: no files, no EDGAR.
//
// 1. Lines written ×10 (findLineSlips). Advisors Preferred's 2026-Q3 table
//    gives ProShares Ultra QQQ at $981 a share and Voya at $966 (closes $91
//    and $94; the same lines were at $91 and $90 last quarter): four lines
//    ten times too large, $200M on a $706M book. A line is a candidate when
//    its implied price is 8–12.5× the period-end close, or, with no close,
//    8–12.5× its own implied price in the filer's previous filing. The
//    candidates are divided by ten only when that is what reconciles the
//    table with the filer's cover: before, the gap is outside ±1%; after,
//    within ±2% and at least 80% of it closed. The cover alone never
//    rescales a line, and a line alone never does either. Each correction is
//    kept (api/_data/line-corrections.json) and applied wherever the filing
//    is read (sec.js getHoldings), marked `lineFix` on the position so it is
//    applied once.
//
// 2. A deviation closed without a person (autoReview), on the same evidence
//    a person uses (config/filing-notes.json, config/reviewed-deviations.json):
//    - 'cover-total': the table carries exactly the lines the cover counts,
//      at least 95% of its priced lines (at least 5) sit within ±10% of the
//      period-end close, and the total is within ×0.5–×2 of the filer's
//      previous filing: the table is right, the cover's figure is not
//      (Greenwich Wealth: $3.09B over 305 lines, the cover says $309,444);
//    - 'small-gap': the gap is within ±2%, the lines match the cover's count
//      and at least 90% of the priced lines are at the close.
//    Anything else stays on the list for a person. An amended filing, or one
//    whose table cannot be read, is never closed here.

export const SLIP_BAND = [8, 12.5];
export const SLIP_AFTER = 0.02;
export const SLIP_CLOSED = 0.8;
export const SLIP_MAX_LINES = 10;
export const AUTO_SMALL_GAP = 0.02;
export const AUTO_PRICED_MIN = 5;

const inBand = (x) => Number.isFinite(x) && x >= SLIP_BAND[0] && x <= SLIP_BAND[1];
export const lineKey = (p) => `${String(p.cusip || '').toUpperCase()}|${p.putCall || ''}`;

// The reading of the cover closest to `aum` (a NEW HOLDINGS amendment's
// cover can carry the cumulative total or the added lines' alone).
const gapTo = (aum, declared) => {
  const ds = (Array.isArray(declared) ? declared : [declared]).filter((d) => d > 0);
  if (!ds.length || !(aum > 0)) return null;
  return ds.map((d) => aum / d - 1).reduce((best, g) => (Math.abs(g) < Math.abs(best) ? g : best));
};

// positions: [{ cusip, putCall, value, shares, prn?, close?, prevPx? }]
// (close: the period-end close; prevPx: the line's implied price in the
// filer's previous filing). → { fixes, before, after } or null.
export function findLineSlips(positions, { declared, tolerance = 0.01 } = {}) {
  const aum = positions.reduce((s, p) => s + (p.value || 0), 0);
  const before = gapTo(aum, declared);
  if (before == null || Math.abs(before) <= tolerance || before < 0) return null;
  const fixes = [];
  for (const p of positions) {
    if (p.putCall || p.prn || p.lineFix || !(p.shares > 0) || !(p.value > 0)) continue;
    const px = p.value / p.shares;
    const vsClose = p.close > 0 ? px / p.close : null;
    const vsPrev = p.prevPx > 0 ? px / p.prevPx : null;
    // a priced line is judged on its close only: a close near 1 says the
    // line is right, whatever last quarter's figure was
    const ratio = vsClose != null ? vsClose : vsPrev;
    if (!inBand(ratio)) continue;
    fixes.push({ cusip: p.cusip, putCall: p.putCall || '', value: p.value, shares: p.shares, factor: 0.1, by: vsClose != null ? 'close' : 'previous-filing', ratio: Number(ratio.toFixed(3)) });
  }
  if (!fixes.length || fixes.length > SLIP_MAX_LINES) return null;
  const after = gapTo(aum - fixes.reduce((s, f) => s + f.value * (1 - f.factor), 0), declared);
  if (after == null || Math.abs(after) > SLIP_AFTER || Math.abs(after) > Math.abs(before) * (1 - SLIP_CLOSED)) return null;
  return { fixes, before, after };
}

// Apply the kept corrections of one filing to a read of it ({ aum, positions }).
// A correction applies only to the line it was made on: the same CUSIP and
// put/call, and the value it was found at (±0.5%), so an amendment that
// changed the line leaves it alone. Returns a new object; never mutates.
export function applyLineFixes(agg, fixes) {
  if (!agg?.positions?.length || !fixes?.length) return agg;
  const byKey = new Map(fixes.map((f) => [lineKey(f), f]));
  let changed = false;
  const positions = agg.positions.map((p) => {
    const f = byKey.get(lineKey(p));
    if (!f || p.lineFix || !(f.value > 0) || Math.abs(p.value / f.value - 1) > 0.005) return p;
    changed = true;
    return { ...p, value: p.value * f.factor, lineFix: { factor: f.factor, by: f.by } };
  });
  if (!changed) return agg;
  positions.sort((a, b) => b.value - a.value);
  const aum = positions.reduce((s, p) => s + p.value, 0);
  for (const p of positions) p.weight = aum ? (p.value / aum) * 100 : 0;
  return { ...agg, aum, positions };
}

// → { kind: 'cover-total' | 'small-gap', reason } or null (a person decides).
//   aum, putCallValue, declared: the filing's totals; rows: the table's line
//   count as read; entries: the cover's count; priced/atClose: priced lines
//   and those within ±10% of the close; prevAum: the previous filing's total.
export function autoReview({ aum, putCallValue = 0, declared, rows, entries, priced, atClose, prevAum, amended = false, period = '' }) {
  if (amended || !(aum > 0) || !(declared > 0) || !(rows > 0) || rows !== entries || !(priced >= AUTO_PRICED_MIN)) return null;
  const gap = aum / declared - 1;
  const share = atClose / priced;
  const pct = (x) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
  const money = (v) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : `$${(v / 1e6).toFixed(2)}M`);
  const lines = `${rows} rows = ${entries} cover lines; ${atClose} of ${priced} priced lines within ±10% of the period-end close`;
  if (Math.abs(gap) <= AUTO_SMALL_GAP) {
    if (share < 0.9) return null;
    const exOptions = putCallValue > 0 && Math.abs((aum - putCallValue) / declared - 1) <= 0.002 ? '; the cover matches the table without its options lines' : '';
    return { kind: 'small-gap', reason: `${period}: table ${money(aum)} vs cover ${money(declared)} (${pct(gap)}); ${lines}${exOptions}. Closed automatically.` };
  }
  if (share < 0.95 || !(prevAum > 0) || aum / prevAum < 0.5 || aum / prevAum > 2) return null;
  return { kind: 'cover-total', reason: `${period}: the cover declares ${money(declared)}; the table sums to ${money(aum)} (${lines}; previous filing ${money(prevAum)}): the cover total is the filer's error. Closed automatically.` };
}
