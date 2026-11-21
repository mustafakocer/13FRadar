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
//
// config/slug-aliases.json (the reviewed, pinned list) is read here as well as
// by the build: an address added to it redirects from the next deploy, without
// waiting for the nightly job to copy it into the table.
let pinnedAliases = null;
function pinned() {
  if (!pinnedAliases) {
    try {
      pinnedAliases = require('../../config/slug-aliases.json').aliases || {};
    } catch {
      pinnedAliases = {};
    }
  }
  return pinnedAliases;
}
export function aliasForSlug(slug) {
  const t = slugTable();
  if (!slug || t.bySlug[slug]) return null;
  const target = t.aliases?.[slug] || pinned()[slug] || null;
  return target && t.bySlug[target] ? target : null;
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

// The redirects to serve: the reviewed list of published addresses
// (config/slug-aliases.json), the table's earlier aliases, and a slug derived
// from each curated name and from its EDGAR registrant name — each kept only while its target exists and no
// real page has taken its slug (a live page always outranks a redirect).
// scripts/build-slugs.mjs writes the result; the pinned list is why a run
// that shrank the table (2026-09-23: 113 → 79) is repaired by the next one.
export function mergeAliases({ bySlug, pinned = {}, previous = {}, derived = {} }) {
  const out = {};
  for (const src of [pinned, previous, derived]) {
    for (const [from, to] of Object.entries(src || {})) {
      if (from && to && from !== to && bySlug[to] && !bySlug[from] && !out[from]) out[from] = to;
    }
  }
  return out;
}
