// "Cash-like" share of a 13F book: the weight of the T-bill and floating-rate
// Treasury ETFs in it. A 13F never carries cash or money-market funds, but a
// manager parking money in SGOV or BIL shows it here, and a share that jumps
// quarter over quarter is a fund stepping back from equities in the one
// place the filing lets us see it.
//
// Only Treasuries of a year or less: no credit (JPST, MINT), no duration
// (SHY, VGSH), no option-box ETFs (BOXX). Keyed by CUSIP, the way the
// filings name them (api/_data/cusip-tickers.json, checked 2026-10-18).
// Option lines never count: their value is the underlying's notional.
export const CASH_LIKE = {
  '46436E718': 'SGOV',
  '78468R663': 'BIL',
  '464288679': 'SHV',
  '97717Y527': 'USFR',
  '46434V860': 'TFLO',
  '78468R523': 'BILS',
  '37960A438': 'CLIP',
  '74933W452': 'TBIL',
  '381430529': 'GBIL',
  '74933W460': 'XBIL',
  '922040845': 'VBIL',
  '09789C788': 'XHLF',
  '74933W478': 'OBIL',
};

export const isCashLike = (p) => !p.putCall && Object.hasOwn(CASH_LIKE, String(p.cusip || '').toUpperCase());

// The cash-like weight of a book, in percent of the shares' value (the
// portfolio figure the page shows: options apart), rounded to 0.01; 0 for a
// book that holds none, null for an empty one.
export function cashLikeWeight(positions) {
  let shares = 0;
  let cash = 0;
  for (const p of positions || []) {
    if (p.putCall) continue;
    const v = Number(p.value) || 0;
    shares += v;
    if (isCashLike(p)) cash += v;
  }
  if (!(shares > 0)) return null;
  return Math.round((cash / shares) * 10000) / 100;
}

// The previous quarter's weight to show beside this one. The universe build
// keeps a filer's entry from run to run: a new period moves the old weight
// to `prev`, the same period carries the old `prev` on. An entry from before
// the weight was kept (no `cashLike` field) gives no previous figure.
//   old: the filer's entry in the last latest-holdings.json, or null
//   → { reportDate, w } or null
export function cashLikePrev(old, reportDate) {
  if (!old || !reportDate) return null;
  if (old.reportDate && old.reportDate < reportDate) {
    return old.cashLike != null ? { reportDate: old.reportDate, w: old.cashLike } : null;
  }
  if (old.reportDate === reportDate) return old.cashLikePrev || null;
  return null;
}
