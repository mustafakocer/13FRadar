import { getSubmissions, list13F, padCik } from '../_lib/sec.js';

export default async function handler(req, res) {
  const cik = String(req.query.cik || '').replace(/\D/g, '');
  if (!cik) return res.status(400).json({ error: 'Missing CIK' });
  try {
    const sub = await getSubmissions(cik);
    const filings = list13F(sub);
    const biz = sub.addresses?.business || {};
    // Filer profile (SEC submissions JSON). `recent` holds up to ~1000 filings,
    // so firstFiling / filingCount are lower bounds for very old filers.
    const r = sub.filings?.recent || {};
    let firstFiling = null;
    let filingCount = 0;
    for (let i = 0; i < (r.form || []).length; i++) {
      if (!String(r.form[i]).startsWith('13F-HR')) continue;
      filingCount++;
      if (!firstFiling || r.filingDate[i] < firstFiling) firstFiling = r.filingDate[i];
    }
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
    res.status(200).json({
      cik: padCik(cik),
      name: sub.name,
      city: biz.city || null,
      state: biz.stateOrCountry || null,
      address: [biz.street1, biz.street2].filter(Boolean).join(', ') || null,
      zip: biz.zipCode || null,
      phone: sub.phone || null,
      website: sub.website || null,
      formerNames: (sub.formerNames || []).map((f) => f.name).filter(Boolean).slice(0, 3),
      firstFiling,
      filingCount,
      filings,
    });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
