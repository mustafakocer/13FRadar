import { getSubmissions, list13F, padCik } from '../_lib/sec.js';
import { slugForCik, filerPath } from '../_lib/slugs.js';

export default async function handler(req, res) {
  const cik = String(req.query.cik || '').replace(/\D/g, '');
  if (!cik) return res.status(400).json({ error: 'Missing CIK' });
  try {
    const sub = await getSubmissions(cik);
    const filings = list13F(sub);
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
    const entry = slugForCik(cik);
    res.status(200).json({
      cik: padCik(cik),
      name: sub.name,
      displayName: entry?.kind === 'guru' ? entry.name : sub.name,
      slug: entry?.slug || null,
      kind: entry?.kind || 'filer',
      path: filerPath(cik),
      city: sub.addresses?.business?.city || null,
      state: sub.addresses?.business?.stateOrCountry || null,
      filings,
    });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
