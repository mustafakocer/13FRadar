// Securities that began trading inside the quarter a 13F reports: an IPO or
// a spin-off. A fund that shows such a line for the first time did not buy
// it in the market that quarter — it held the private shares before the
// listing (SpaceX, Cerebras) or received them from the parent (FedEx
// Freight). So the stake is not a purchase: it stays out of net buying
// (api/_lib/netActivity.js) and the fund page tags it "Halka arz öncesinden".
//
// The list (client/public/new-listings.json, written by
// scripts/build-consensus.mjs from the price store) is
//   { updatedAt, rows: [{ t: ticker, c: [cusips], d: first trading day }] }
// and covers names whose price history starts after the store's ten-year
// floor, so an old stock with a full history is never on it.

// The quarter end before `reportDate` (2026-06-30 → 2026-03-31).
export function previousQuarterEnd(reportDate) {
  const d = String(reportDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const y = Number(d.slice(0, 4));
  const ends = [`${y - 1}-03-31`, `${y - 1}-06-30`, `${y - 1}-09-30`, `${y - 1}-12-31`, `${y}-03-31`, `${y}-06-30`, `${y}-09-30`, `${y}-12-31`];
  return ends.filter((q) => q < d).at(-1) || null;
}

// First traded inside the quarter that ends on `reportDate`.
export function listedInQuarter(firstTrade, reportDate) {
  const prev = previousQuarterEnd(reportDate);
  return Boolean(firstTrade && prev && firstTrade > prev && firstTrade <= reportDate);
}

// id (CUSIP or ticker, any case) → first trading day, from the file's rows.
export function listingLookup(file) {
  const m = new Map();
  for (const r of file?.rows || []) {
    if (!r?.d) continue;
    if (r.t) m.set(String(r.t).toUpperCase(), r.d);
    for (const c of r.c || []) m.set(String(c).toUpperCase(), r.d);
  }
  return (id) => (id ? m.get(String(id).toUpperCase()) || null : null);
}

// A position a fund reports for the first time in the quarter its security
// listed: held before the IPO (or received in the spin-off).
export function heldBeforeListing(p, reportDate, listedOn) {
  if (!listedOn || !p) return false;
  const d = listedOn(p.cusip) || listedOn(p.ticker);
  return listedInQuarter(d, reportDate);
}
