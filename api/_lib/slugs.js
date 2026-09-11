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
export const slugForCik = (cik) => slugTable().byCik[String(cik).padStart(10, '0')] || null;

// Canonical path of a filer: curated gurus live under /guru, everyone else
// under /filer; unknown CIKs fall back to the numeric route.
export function filerPath(cik) {
  const e = slugForCik(cik);
  if (!e) return `/manager/${String(cik).padStart(10, '0')}`;
  return `/${e.kind === 'guru' ? 'guru' : 'filer'}/${e.slug}`;
}
