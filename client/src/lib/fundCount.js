// The number of funds the site states, one way everywhere: the home page's
// stat band, the pricing page and the menu read the same count
// (client/public/universe-summary.json, written by api/_lib/universeSummary.js)
// through this function, so they cannot disagree ("9,023" on the home page
// and "8,000+" on the pricing page).
export function fundCountLabel(count, { round = false, locale = 'en-US' } = {}) {
  if (!Number.isFinite(count) || count <= 0) return null;
  if (!round) return count.toLocaleString(locale);
  // a count under 100 (the tracked superinvestors) rounds to tens: with a
  // step of 100 it would read "0+"
  const step = count >= 1000 ? 1000 : count >= 100 ? 100 : 10;
  if (count < step) return count.toLocaleString(locale);
  return `${(Math.floor(count / step) * step).toLocaleString(locale)}+`;
}

// The same count, rounded down, for text that is cached or indexed (titles,
// meta descriptions, llms.txt): "9,000+" stays true while the universe grows
// by a few funds a night, where the exact figure would change the snippet
// every day. null when the count is unknown — callers then write the sentence
// without a number rather than a stale one.
export const fundCountRounded = (count, lang = 'en') => fundCountLabel(count, { round: true, locale: lang === 'tr' ? 'tr-TR' : 'en-US' });
