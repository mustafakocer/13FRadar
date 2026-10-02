// The number of funds the site states, one way everywhere: the home page's
// stat band, the pricing page and the menu read the same count
// (client/public/universe-summary.json, written by api/_lib/universeSummary.js)
// through this function, so they cannot disagree ("9,023" on the home page
// and "8,000+" on the pricing page).
export function fundCountLabel(count, { round = false, locale = 'en-US' } = {}) {
  if (!Number.isFinite(count) || count <= 0) return null;
  if (!round) return count.toLocaleString(locale);
  const step = count >= 1000 ? 1000 : 100;
  return `${(Math.floor(count / step) * step).toLocaleString(locale)}+`;
}
