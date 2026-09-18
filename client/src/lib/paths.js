import { GURU_SLUGS } from '../data/guru-slugs.js';

// Canonical link for a filer.
//
// Curated gurus get their stored slug, read from a map that scripts/
// build-slugs.mjs generates out of the slug table itself. This used to be
// derived here by slugifying the curated name, which quietly assumed the table
// had been built from that same name. It had not: a fund first seen in the
// universe scan keeps the slug made from its EDGAR name, and later promotion
// to a guru renames it without re-slugging. 86 of 99 curated funds disagreed,
// so every link built here — the home page chips, search, the watchlist, the
// filings feed, the screener — pointed at a page that does not exist.
//
// Everyone else links to the numeric route, which the server 301s to the
// stored /filer/<slug> URL.
export function managerPath(cik, hint = null) {
  if (hint) return hint;
  const id = String(cik || '').padStart(10, '0');
  const slug = GURU_SLUGS[id];
  return slug ? `/guru/${slug}` : `/manager/${id}`;
}
