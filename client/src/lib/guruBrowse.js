// The guru list as the home page and /gurus browse it: category tabs,
// closed funds hidden until asked for, names cut to a chip. Pure, over the
// registry entries (api/_lib/gurus.js), so the counts are testable.
export const CATS = ['all', 'value', 'activist', 'quant', 'macro', 'growth', 'other'];

// The tab a fund belongs to: the registry's finer categories fold into
// "other" (multi-strategy, family office, uncategorised).
export const catOf = (g) => (['value', 'activist', 'quant', 'macro', 'growth'].includes(g?.category) ? g.category : 'other');

export const isClosed = (g) => Boolean(g?.activeTo);

// { all: n, value: n, … } over the funds still filing — the tabs' counts,
// which therefore add up to the number of active funds.
export function catCounts(gurus) {
  const out = Object.fromEntries(CATS.map((c) => [c, 0]));
  for (const g of gurus) {
    if (isClosed(g)) continue;
    out.all++;
    out[catOf(g)]++;
  }
  return out;
}

export function filterGurus(gurus, { cat = 'all', showClosed = false } = {}) {
  const open = gurus.filter((g) => (showClosed || !isClosed(g)) && (cat === 'all' || catOf(g) === cat));
  // closed funds last, labelled — never dropped from the list
  return [...open.filter((g) => !isClosed(g)), ...open.filter(isClosed)];
}

// A chip carries at most `max` characters; the full name goes in its title.
export function chipName(name, max = 32) {
  const s = String(name || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}
