// Every number the insider signal level uses, in one place. Change a
// threshold here and the feed, the home page, the stock page and the
// calibration script (scripts/calibrate-insider-signals.mjs) all follow.
// Run the calibration after any change: a level only means something if
// Güçlü (strong) buys have done better than Orta (medium), and Orta better
// than Zayıf (weak), on the data we have.
export const SIGNAL = {
  // below this, an open-market buy carries no signal at all
  minValue: 10_000,
  // Orta: an officer or director buying at least this much …
  mediumValue: 50_000,
  // … or anyone raising their own holding by at least this percentage
  mediumOwnIncreasePct: 10,
  // Güçlü: CEO, CFO, President/Chair or COO buying at least this much …
  strongTopValue: 100_000,
  // … or any officer/director buying at least this much AND raising
  // their holding by at least this percentage
  strongInsiderValue: 250_000,
  strongOwnIncreasePct: 10,
  // horizons (calendar days) for the forward returns vs SPY: the
  // calibration table and the "İsabet" (hit rate) column
  horizons: [30, 90],
  hitRateHorizon: 90,
  // "İsabet" needs at least this many earlier buys before it is shown
  minHitSample: 3,
};
