// Builds api/_data/slugs.json — the stored, deterministic URL slug for every
// filer we can link to. Slugs are never regenerated on the fly: an existing
// assignment is kept forever, new names that collide get a CIK suffix.
//
//   node scripts/build-slugs.mjs
//
// Sources: client/public/universe.json (all 13F-HR filers, weekly Action)
// and api/_lib/gurus.js (the curated gurus:
// friendlier slugs such as berkshire-hathaway-warren-buffett).
//
// Two things are written besides the table itself.
//
// client/src/data/guru-slugs.js is the curated CIK → slug map the browser
// needs to build a fund link. It used to be derived in the client by
// slugifying the curated name, on the assumption that this is what the table
// holds. It is not: a fund first seen in the universe scan keeps the slug made
// from its EDGAR name, and being promoted to a guru later renames it but never
// re-slugs it. 86 of 99 curated funds had a name that no longer derived their
// slug, so nearly every fund link outside a page that already carried the
// stored path led to "no fund matches this address". Generating the map from
// the table is the only way it cannot drift again.
//
// `aliases` maps a slug that was plausibly linked to the one that exists, so
// the URLs that were wrong for months — indexed, bookmarked, pasted — redirect
// instead of dying.
import fs from 'node:fs';
import path from 'node:path';
import { GURUS } from '../api/_lib/gurus.js';
import { slugify } from '../api/_lib/slugs.js';

const root = process.cwd();
const OUT = path.join(root, 'api', '_data', 'slugs.json');
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { bySlug: {}, byCik: {} };

const bySlug = { ...prev.bySlug };
const byCik = { ...prev.byCik };
const assign = (cik, name, kind) => {
  cik = String(cik).padStart(10, '0');
  if (byCik[cik]) {
    // keep the stored slug and a curated (guru) name; a filer's EDGAR name
    // may refresh, and a filer can be promoted to guru
    const cur = byCik[cik];
    const next = {
      slug: cur.slug,
      name: cur.kind === 'guru' ? cur.name : name,
      kind: cur.kind === 'guru' || kind === 'guru' ? 'guru' : 'filer',
    };
    byCik[cik] = next;
    bySlug[cur.slug] = { cik, name: next.name, kind: next.kind };
    return;
  }
  let slug = slugify(name);
  if (!slug) slug = `filer-${Number(cik)}`;
  if (bySlug[slug] && bySlug[slug].cik !== cik) slug = `${slug}-${Number(cik)}`;
  bySlug[slug] = { cik, name, kind };
  byCik[cik] = { slug, name, kind };
};

// curated first so they win the plain slug
for (const m of GURUS) assign(m.cik, m.name, 'guru');

const uni = JSON.parse(fs.readFileSync(path.join(root, 'client', 'public', 'universe.json'), 'utf8'));
for (const r of [...uni.rows].sort((a, b) => b.aum - a.aum)) assign(r.cik, r.name, 'filer');

// Every slug a reader could reasonably have been sent to, pointing at the one
// that exists. A derived slug that is itself a real filer's slug is left
// alone: a live page always outranks a redirect.
//
// Two sources. First, every alias already published: an address that once
// redirected keeps redirecting (the nightly build of 2026-09-23 derived the
// list from the registry's current names alone and dropped the 34 short
// names — berkshire-hathaway, pershing-square, … — the registry had carried
// before the gurus were renamed, and those URLs died). Second, the names a
// fund is or was known by: the registry name, the name without its
// parenthetical ("Berkshire Hathaway (Warren Buffett)" → berkshire-hathaway)
// and the name without a trailing corporate suffix (… Management LLC), so a
// future rename never loses reachability either.
const SUFFIX = /[\s,.]+(inc|incorporated|llc|l\.l\.c|lp|l\.p|llp|ltd|limited|plc|ag|sa|nv|co|corp|corporation|company|management|advisors|advisers|partners|group|capital management|asset management|investment management|investors)\.?$/i;
const variants = (name) => {
  const out = new Set();
  const base = String(name).replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  for (const n of [name, base]) {
    let cur = n;
    for (let i = 0; i < 3; i++) {
      out.add(slugify(cur));
      const next = cur.replace(SUFFIX, '').trim();
      if (next === cur || !next) break;
      cur = next;
    }
  }
  out.delete('');
  return [...out];
};
const aliases = {};
const alias = (from, to) => {
  if (!from || from === to || bySlug[from] || !bySlug[to]) return;
  aliases[from] = to;
};
for (const [from, to] of Object.entries(prev.aliases || {})) alias(from, to);
for (const m of GURUS) {
  const cik = String(m.cik).padStart(10, '0');
  const stored = byCik[cik];
  if (!stored) continue;
  for (const v of variants(m.name)) alias(v, stored.slug);
}

// The guard. A redirect that is published is a URL someone holds; the
// table may gain aliases, never lose one. Fewer than the committed file
// carries, or any alias it carries missing from the new table, means this
// run would kill URLs — the nightly of 2026-09-23 did exactly that, 34 of
// them — so nothing is written and the process fails,
// which fails the workflow before its commit step. Set
// SLUGS_ALLOW_FEWER_ALIASES=1 to override after checking the list, when
// an alias has legitimately become a live filer's slug.
const before = Object.keys(prev.aliases || {});
const after = Object.keys(aliases);
const dropped = before.filter((k) => !aliases[k]);
// the count may not fall, and no individual alias may vanish either — a
// build that adds ninety derived variants while losing two published ones
// still kills two URLs
if ((after.length < before.length || dropped.length) && process.env.SLUGS_ALLOW_FEWER_ALIASES !== '1') {
  console.error(`::error::slugs.json: ${after.length} aliases would replace ${before.length} — ${dropped.length} redirect(s) would die: ${dropped.join(', ')}`);
  console.error('Nothing written. Fix the derivation or, if every dropped alias is now a live slug, re-run with SLUGS_ALLOW_FEWER_ALIASES=1.');
  process.exit(1);
}
if (dropped.length) console.log(`::warning::slugs.json: ${dropped.length} alias(es) dropped (allowed): ${dropped.join(', ')}`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), bySlug, byCik, aliases }));

// The browser gets the curated names only: 99 entries rather than 7832, small
// enough to ship and the single source of truth for a fund link.
const guruMap = {};
for (const [cik, v] of Object.entries(byCik)) if (v.kind === 'guru') guruMap[cik] = v.slug;
const GURU_OUT = path.join(root, 'client', 'src', 'data', 'guru-slugs.js');
const lines = Object.keys(guruMap)
  .sort()
  .map((cik) => `  '${cik}': '${guruMap[cik]}',`)
  .join('\n');
fs.writeFileSync(
  GURU_OUT,
  `// Generated by scripts/build-slugs.mjs — do not edit.\n` +
    `// The stored slug of every curated fund, so a link is never guessed from\n` +
    `// a name the slug was not made from.\n` +
    `export const GURU_SLUGS = {\n${lines}\n};\n`
);

const gurus = Object.keys(guruMap).length;
console.log(`slugs.json: ${Object.keys(bySlug).length} slugs (${gurus} gurus), ${Object.keys(byCik).length} CIKs, ${Object.keys(aliases).length} aliases (${before.length} before, +${after.length - before.length})`);
console.log(`guru-slugs.js: ${gurus} curated slugs for the client`);
