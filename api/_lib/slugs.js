import { createRequire } from 'node:module';
import { slugify } from '../../client/src/lib/slugify.js';

export { slugify };

const require = createRequire(import.meta.url);
let table = null;
export function slugTable() {
  if (!table) {
    try {
      table = require('../_data/slugs.json');
    } catch {
      table = { bySlug: {}, byCik: {} };
    }
  }
  return table;
}

export const cikForSlug = (slug) => slugTable().bySlug[slug] || null;

// A slug that does not exist but that a reader could plausibly have been sent
// to — the site itself built fund links by slugifying a curated name for
// months, and those URLs are indexed and bookmarked. Returns the slug that
// does exist, so the caller can redirect rather than show "no fund matches
// this address". Null when the slug is simply not ours.
//
// A real slug is never an alias: resolveSlug answers with the live page first
// and only then looks for a rename.
export function aliasForSlug(slug) {
  if (!slug || slugTable().bySlug[slug]) return null;
  return slugTable().aliases?.[slug] || null;
}

// The entry for a slug, and the slug it should be read under. `canonical`
// differs from the slug asked for exactly when an alias was followed.
export function resolveSlug(slug) {
  const direct = cikForSlug(slug);
  if (direct) return { entry: direct, canonical: slug, alias: false };
  const target = aliasForSlug(slug);
  if (!target) return null;
  const entry = cikForSlug(target);
  return entry ? { entry, canonical: target, alias: true } : null;
}
export const slugForCik = (cik) => slugTable().byCik[String(cik).padStart(10, '0')] || null;

// Canonical path of a filer: curated gurus live under /guru, everyone else
// under /filer; unknown CIKs fall back to the numeric route.
export function filerPath(cik) {
  const e = slugForCik(cik);
  if (!e) return `/manager/${String(cik).padStart(10, '0')}`;
  return `/${e.kind === 'guru' ? 'guru' : 'filer'}/${e.slug}`;
}
