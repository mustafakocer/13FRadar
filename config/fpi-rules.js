// The thresholds of the foreign-issuer market check (api/_lib/fpiNormalize.js),
// in one place. Each is a fraction of the trade day's US close.
//
// Changing one changes which Form 4 lines are converted, shown as off-market
// or left unverified: rerun `npm test` (tests/fpi-market-check.test.mjs,
// tests/fpi-regression.test.mjs) and compare the 12-month report before
// merging.
export const FPI_RULES = Object.freeze({
  // The form's price as it stands (US dollars, no ADR ratio), and every
  // conversion the filer did not declare, must land within ±15% of the
  // close. Tighter than the ±25% daily price check: a wider band lets a
  // wrong unit through (Sea's dollar price also fits as Singapore dollars
  // 21% off; a Horizon Quantum dollar price fits as SGD 6% off).
  matchTolerance: 0.15,

  // A conversion in a currency the filer declares ("translated from New
  // Taiwan dollars at NT$32.09 to US$1") with a documented ADR ratio may be
  // ±25% off: an ADS can trade at a premium to its home shares — TSMC's
  // ADS ran 15–21% above five Taipei shares in 2026.
  declaredTolerance: 0.25,

  // "Piyasa dışı fiyat": a dollar price with no other unit in play that no
  // rate or ratio brings within matchTolerance, but that is within ±50% of
  // the close. Private placements and negotiated sales are priced at
  // discounts or premiums of that size (International Tower Hill: Paulson
  // at −22.6%; Wix's ESPP at −32%); the amount is shown and kept out of
  // clusters and day totals. Beyond ±50% the gap is almost always a unit —
  // a split the price series has and the form does not, a currency or its
  // sub-unit (Republic Power −99.8%, Hub Cyber in agorot −99.5%) — and the
  // amount is not verified instead.
  offMarketMax: 0.5,

  // Home currencies tried for a company without an ADS programme even when
  // none of its filings name the currency: Canadian issuers are normally
  // listed on the TSX/TSXV as well as a US exchange (Canopy, Fortis, Lithium
  // Americas). Anywhere else, a company with no ADS and no filing naming
  // its home currency is taken as listed only in the US.
  homeListedCurrencies: Object.freeze(['CAD']),
});
