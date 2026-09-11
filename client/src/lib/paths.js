import { POPULAR_MANAGERS } from '../data/popular.js';
import { slugify } from './slugify.js';

// Canonical link for a filer. Curated gurus get their stored slug (the slug
// table assigns slugify(popular name) to them, so it can be derived here
// without shipping the 8k-entry table); everyone else links to the numeric
// route, which the server 301s to the stored /filer/<slug> URL.
const GURU_SLUG = new Map(POPULAR_MANAGERS.map((m) => [m.cik, slugify(m.name)]));

export function managerPath(cik, hint = null) {
  if (hint) return hint;
  const id = String(cik || '').padStart(10, '0');
  const slug = GURU_SLUG.get(id);
  return slug ? `/guru/${slug}` : `/manager/${id}`;
}
