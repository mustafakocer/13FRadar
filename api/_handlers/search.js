import { cached, TTL } from '../_lib/cache.js';
import { ftsSearch, companySearchAtom, getSubmissions, padCik } from '../_lib/sec.js';

const parseDisplayName = (dn) => {
  const m = /^(.*?)\s*\(CIK\s+(\d+)\)\s*$/.exec(dn);
  return m ? { name: m[1].trim(), cik: padCik(m[2]) } : null;
};

export default async function handler(req, res) {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.status(400).json({ error: 'Query too short' });

  try {
    const results = await cached(`search:${q.toLowerCase()}`, TTL.HOUR_1, async () => {
      // Direct CIK lookup
      if (/^\d{3,10}$/.test(q)) {
        try {
          const sub = await getSubmissions(q);
          return [{ name: sub.name, cik: padCik(q), filings: null }];
        } catch {
          return [];
        }
      }

      // Primary: EDGAR full-text search restricted to 13F-HR filings
      try {
        const data = await ftsSearch(q);
        const hits = data?.hits?.hits || [];
        const byCik = new Map();
        for (const h of hits) {
          for (const dn of h._source?.display_names || []) {
            const p = parseDisplayName(dn);
            if (!p) continue;
            const cur = byCik.get(p.cik) || { ...p, filings: 0 };
            cur.filings++;
            byCik.set(p.cik, cur);
          }
        }
        let list = [...byCik.values()];
        const ql = q.toLowerCase();
        const nameMatch = list.filter((r) => r.name.toLowerCase().includes(ql));
        list = (nameMatch.length ? nameMatch : list).sort((a, b) => b.filings - a.filings);
        if (list.length) return list.slice(0, 25);
      } catch {
        /* fall through to atom search */
      }

      // Fallback: classic EDGAR company search
      const companies = await companySearchAtom(q);
      return companies.slice(0, 25).map((c) => ({ ...c, filings: null }));
    });

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json({ results });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
