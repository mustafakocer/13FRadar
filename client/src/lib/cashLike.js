// 13F filings never report actual cash. What they DO show is cash parked in
// 13(f)-reportable instruments: T-bill / ultra-short treasury / money-market-
// style ETFs. We surface those as a "cash-like" lower bound.
const CASH_TICKERS = new Set([
  'SGOV', 'BIL', 'SHV', 'USFR', 'TFLO', 'GBIL', 'TBIL', 'CLTL', 'BILS', 'XHLF',
  'BOXX', 'ICSH', 'JPST', 'MINT', 'NEAR', 'GSY', 'PULS', 'ULST', 'VUSB', 'FLOT',
  'SCHO', 'OBIL', 'XBIL', 'TBLL', 'CSHI', 'FLRN', 'JPLD',
]);

const NAME_RE =
  /\bT[- ]?BILLS?\b|TREASURY BILL|\b0-3 ?M|\b1-3 ?M|\b0-1 ?Y|ULTRA ?-?SHORT|SHORT TREAS|FLOATING RATE TREAS|TREASURY FLOATING|MONEY MARKET|GOVT MONEY|CASH RESERVE|CASH MGMT|CASH MANAGEMENT/i;

export function isCashLike(p) {
  if (!p || p.putCall) return false;
  if (p.ticker && CASH_TICKERS.has(String(p.ticker).toUpperCase())) return true;
  return NAME_RE.test(`${p.issuer || ''} ${p.class || ''}`);
}

// { items, value, weight } — weight in % of reported AUM
export function cashLikeSummary(positions = []) {
  const items = positions.filter(isCashLike);
  return {
    items,
    value: items.reduce((s, p) => s + (p.value || 0), 0),
    weight: items.reduce((s, p) => s + (p.weight || 0), 0),
  };
}

// Effective number of positions: 1 / Σ(w²). A 30-stock book with 5 big bets
// has an effective count near 5.
export function effectivePositions(positions = []) {
  const hhi = positions.reduce((s, p) => s + ((p.weight || 0) / 100) ** 2, 0);
  return hhi > 0 ? 1 / hhi : null;
}
