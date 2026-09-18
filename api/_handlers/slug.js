import { resolveSlug, slugTable } from '../_lib/slugs.js';

// GET /api/slug/:slug          → { cik, name, kind, slug }
// GET /api/slug?kind=guru      → curated guru list (for the /gurus index)
// GET /api/slug?letter=a       → filers whose slug starts with the letter
export default function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  const slug = String(req.query.slug || '').toLowerCase();
  if (slug) {
    // An alias answers with the fund it points at rather than 404ing, so a
    // client-side navigation to a stale link still renders the page. `slug` is
    // the canonical spelling and `aliasOf` records what was asked for; the SSR
    // route turns the same case into a 301, which is what crawlers need.
    const hit = resolveSlug(slug);
    if (!hit) return res.status(404).json({ error: 'Unknown slug' });
    return res.status(200).json({ ...hit.entry, slug: hit.canonical, ...(hit.alias ? { aliasOf: slug } : {}) });
  }
  const t = slugTable();
  if (req.query.kind === 'guru') {
    const rows = Object.entries(t.bySlug)
      .filter(([, v]) => v.kind === 'guru')
      .map(([slug, v]) => ({ slug, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return res.status(200).json({ rows });
  }
  const letter = String(req.query.letter || '').toLowerCase();
  if (/^[a-z0-9]$/.test(letter)) {
    const rows = Object.entries(t.bySlug)
      .filter(([s, v]) => v.kind === 'filer' && (letter === '0' ? /^[0-9]/.test(s) : s.startsWith(letter)))
      .map(([slug, v]) => ({ slug, ...v }))
      .sort((a, b) => a.slug.localeCompare(b.slug));
    return res.status(200).json({ letter, rows });
  }
  return res.status(400).json({ error: 'slug, kind=guru or letter=a-z|0 required' });
}
