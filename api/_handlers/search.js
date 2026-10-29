import { cached, TTL } from '../_lib/cache.js';
import { ftsSearch, companySearchAtom, getSubmissions, padCik } from '../_lib/sec.js';
import { GURUS } from '../_lib/gurus.js';

// Tracked superinvestors whose name holds every word of the query. EDGAR's
// full-text search ranks by filing count, so "Buffett" used to surface the
// personal filer BUFFETT WARREN E (last 13F in 2007) above Berkshire.
export function guruMatches(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return GURUS.filter((g) => {
    const name = g.name.toLowerCase();
    return words.every((w) => name.includes(w));
  }).map((g) => ({ name: g.name, cik: g.cik, filings: null, guru: true }));
}

// Gurus first, then EDGAR's own list without the CIKs already shown.
export function withGurusFirst(q, list) {
  const gurus = guruMatches(q);
  const seen = new Set(gurus.map((g) => g.cik));
  return [...gurus, ...list.filter((r) => !seen.has(r.cik))].slice(0, 25);
}

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
        if (list.length) return withGurusFirst(q, list);
      } catch {
        /* fall through to atom search */
      }

      // Fallback: classic EDGAR company search
      let companies = [];
      try {
        companies = await companySearchAtom(q);
      } catch (err) {
        // EDGAR down: the tracked list still answers
        if (!guruMatches(q).length) throw err;
      }
      return withGurusFirst(q, companies.map((c) => ({ ...c, filings: null })));
    });

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json({ results });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
