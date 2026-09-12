// Builds api/_data/slugs.json — the stored, deterministic URL slug for every
// filer we can link to. Slugs are never regenerated on the fly: an existing
// assignment is kept forever, new names that collide get a CIK suffix.
//
//   node scripts/build-slugs.mjs
//
// Sources: client/public/universe.json (all 13F-HR filers, weekly Action),
// api/_lib/consensusList.js and client/src/data/popular.js (curated gurus:
// friendlier slugs such as berkshire-hathaway-warren-buffett).
import fs from 'node:fs';
import path from 'node:path';
import { CONSENSUS_MANAGERS } from '../api/_lib/consensusList.js';
import { POPULAR_MANAGERS } from '../client/src/data/popular.js';
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
for (const m of POPULAR_MANAGERS) assign(m.cik, m.name, 'guru');
for (const m of CONSENSUS_MANAGERS) assign(m.cik, m.name, 'guru');

const uni = JSON.parse(fs.readFileSync(path.join(root, 'client', 'public', 'universe.json'), 'utf8'));
for (const r of [...uni.rows].sort((a, b) => b.aum - a.aum)) assign(r.cik, r.name, 'filer');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), bySlug, byCik }));
const gurus = Object.values(byCik).filter((x) => x.kind === 'guru').length;
console.log(`slugs.json: ${Object.keys(bySlug).length} slugs (${gurus} gurus), ${Object.keys(byCik).length} CIKs`);
